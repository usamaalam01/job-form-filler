import type {
  FillSession, DetectedField, MappingResult, WriteResult,
  ApplicationRecord, QAEntry,
} from '@shared/types'
import { onMessage } from '@shared/messaging'
import { applyRules } from '@shared/mapper-rules'
import { parseProfile } from '@shared/profile-parser'
import { parseQABank, appendQAEntry } from '@shared/qa-parser'
import { HistoryService, normalizeUrl } from '@shared/history'
import { FileStore } from '../panel/filestore'
import { settingsService } from '@shared/settings'
import { FallbackChain, makeProvider } from './llm/fallback'
import { mapFieldsWithLLM } from './mapper-llm'
import { matchQuestion } from './qa-matcher'
import { structureProfileText } from './profile-builder'
import { FallbackExhaustedError, LLMProviderError } from './llm/provider'
import { debugLog } from './debug-log'

// ─── Session store (in-memory + persisted for EC-22) ─────────────────────────

const sessions = new Map<number, FillSession>()

function sessionKey(tabId: number): string { return `session_${tabId}` }

async function persistSession(session: FillSession): Promise<void> {
  await chrome.storage.local.set({ [sessionKey(session.tabId)]: session })
}

async function restoreSession(tabId: number): Promise<FillSession | null> {
  const result = await chrome.storage.local.get(sessionKey(tabId))
  return (result[sessionKey(tabId)] as FillSession | undefined) ?? null
}

async function clearSession(tabId: number): Promise<void> {
  sessions.delete(tabId)
  await chrome.storage.local.remove(sessionKey(tabId))
}

const fileStore = new FileStore()

// ─── Idempotency cache (EC-22) ────────────────────────────────────────────────
// Tracks completed requestIds to prevent duplicate history writes on SW restart

const COMPLETED_KEY = 'completed_requests'

async function isCompleted(requestId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(COMPLETED_KEY)
  const set: string[] = stored[COMPLETED_KEY] ?? []
  return set.includes(requestId)
}

async function markCompleted(requestId: string): Promise<void> {
  const stored = await chrome.storage.local.get(COMPLETED_KEY)
  const set: string[] = stored[COMPLETED_KEY] ?? []
  set.push(requestId)
  // Keep last 50 request IDs to avoid unbounded growth
  const trimmed = set.slice(-50)
  await chrome.storage.local.set({ [COMPLETED_KEY]: trimmed })
}

// ─── FallbackChain factory ────────────────────────────────────────────────────

async function makeFallbackChain(): Promise<FallbackChain | null> {
  const rawSettings = await fileStore.readSettings()
  const settings = settingsService.parse(rawSettings)
  if (!settings.fallbackChain.length) return null
  return new FallbackChain(settings.fallbackChain, settingsService, settings)
}

/**
 * Reads LLM-relevant settings without requiring a folder connection.
 * Reads from chrome.storage.local cache written by the panel on every save.
 * Falls back to SETTINGS_DEFAULTS if nothing is cached yet.
 */
async function loadSettingsNoFolder() {
  return settingsService.loadCachedLLMSettings()
}

// ─── Orchestrator init ────────────────────────────────────────────────────────

export function initOrchestrator(): void {
  // DETECT_FIELDS — inject content script, detect, run rules + LLM mapper
  onMessage<{ tabId: number; profileSlug: string }, { session: FillSession; duplicate: ApplicationRecord | null; llmError?: string }>(
    'DETECT_FIELDS',
    async ({ tabId, profileSlug }) => {
      await fileStore.reconnectFolder()

      const rawSettings = await fileStore.readSettings()
      const settings = settingsService.parse(rawSettings)

      // Load profile and Q&A bank
      const profileMd = await fileStore.readProfile(profileSlug)
      if (!profileMd) throw new Error(`Profile not found: ${profileSlug}`)
      const profile = parseProfile(profileMd)
      const qaBankMd = await fileStore.readQABank() ?? ''
      const qaBank = parseQABank(qaBankMd)

      // Content script is declared in manifest.json and auto-injected by Chrome.
      // Detect fields across ALL frames (Greenhouse/Lever forms are often in iframes)
      // and merge the results. A null result means the content script isn't present
      // in that frame (e.g. page was open before the extension loaded).
      const frameResults = await chrome.scripting.executeScript<[], DetectedField[] | null>({
        target: { tabId, allFrames: true },
        func: () => {
          // @ts-expect-error runtime injection
          if (typeof window.__jff_detectFields !== 'function') return null
          // @ts-expect-error runtime injection
          return window.__jff_detectFields()
        },
      })

      // If every frame returned null, the content script is not injected anywhere.
      const anyInjected = frameResults.some(r => r.result !== null)
      if (!anyInjected) {
        throw new Error('Content script not active on this page. Please reload the job page (F5) and try again.')
      }

      // Merge fields from all frames that returned an array
      const fields = frameResults.flatMap(r => r.result ?? [])

      // ── Hybrid mapping ────────────────────────────────────────────────────

      // Step 1: rules pass
      const rulesResults = applyRules(fields, profile)
      const resolved = rulesResults.filter(r => r.source !== 'blank')
      const unresolved = rulesResults.filter(r => r.source === 'blank' && !r.field.isUpload)

      let llmError: string | undefined
      let llmResults: MappingResult[] = []
      let qaResults: MappingResult[] = []

      // Step 2: LLM pass (if configured)
      const chain = await makeFallbackChain()
      if (chain && unresolved.length > 0) {
        // Separate custom questions from structural fields
        const CUSTOM_Q_PATTERNS = /why|motivation|tell us|describe|explain|how many|years of|experience with|what do you|strength|weakness/i
        const customQFields = unresolved.filter(r => CUSTOM_Q_PATTERNS.test(r.field.label))
        const structuralFields = unresolved.filter(r => !CUSTOM_Q_PATTERNS.test(r.field.label))

        try {
          llmResults = await mapFieldsWithLLM(
            structuralFields.map(r => r.field),
            profile, qaBank, chain, settings.maxFieldBatchSize,
          )
        } catch (err) {
          if (err instanceof FallbackExhaustedError) {
            llmError = 'All LLM providers failed — showing rules-only results.'
            llmResults = structuralFields // pass through as-is (blank)
          } else throw err
        }

        for (const r of customQFields) {
          try {
            const result = await matchQuestion(r.field, qaBank, profile, chain, settings.aiDrafting)
            qaResults.push(result)
          } catch {
            qaResults.push(r) // keep as blank on error
          }
        }
      } else {
        // No LLM — keep unresolved fields as blank
        llmResults = unresolved
      }

      // ── Repeatable section auto-add (P3-T7) ─────────────────────────────────
      if (settings.autoAddRepeatableBlocks) {
        // Count detected group blocks and compare to profile entry counts
        const groupCounts = new Map<string, number>()
        for (const r of rulesResults) {
          if (r.field.group) groupCounts.set(r.field.group, (groupCounts.get(r.field.group) ?? 0) + 1)
        }

        // For experience groups: compare to profile.experience.length
        const expGroupKey = [...groupCounts.keys()].find(k => /experience|work|employment/i.test(k))
        if (expGroupKey) {
          const existing = groupCounts.get(expGroupKey) ?? 1
          const needed = Math.max(0, profile.experience.length - existing)
          // Find the "Add another" button selector from any field in that group
          const addButtonSel = fields.find(f => f.group === expGroupKey)?.addAnotherButtonSelector
          if (addButtonSel && needed > 0) {
            for (let i = 0; i < needed; i++) {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: (sel: string) => {
                  // @ts-expect-error runtime
                  return window.__jff_addRepeatableBlock?.(sel) ?? false
                },
                args: [addButtonSel],
              })
              await new Promise(r => setTimeout(r, 600))
            }
            // Re-detect after adding blocks
            const [{ result: newFields }] = await chrome.scripting.executeScript<[], DetectedField[]>({
              target: { tabId },
              func: () => {
                // @ts-expect-error runtime
                return window.__jff_detectFields?.() ?? []
              },
            })
            if (newFields?.length) fields.splice(0, fields.length, ...newFields)
          }
        }
      }

      // Merge: resolved (rules) + LLM structural + Q&A + upload flags
      const uploadResults = rulesResults.filter(r => r.field.isUpload)
      const mappingResults: MappingResult[] = [
        ...resolved,
        ...llmResults,
        ...qaResults,
        ...uploadResults,
      ]

      debugLog.info('orchestrator', `Detected ${fields.length} fields, mapped ${resolved.length} via rules, ${llmResults.length + qaResults.length} via LLM`, { tabId, profileSlug, llmError })

      const session: FillSession = {
        tabId, profileSlug,
        detectedFields: fields,
        mappingResults,
        requestId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
      }
      sessions.set(tabId, session)
      await persistSession(session)

      // Duplicate check
      const histSvc = new HistoryService(fileStore)
      const [firstTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabUrl = firstTab?.url ?? ''
      const duplicate = await histSvc.checkDuplicate(tabUrl, null, null, settings.dedupeWindow)

      return { session, duplicate, llmError }
    }
  )

  // MAP_FIELDS — return cached mapping results
  onMessage<{ tabId: number }, MappingResult[]>(
    'MAP_FIELDS',
    async ({ tabId }) => {
      const session = sessions.get(tabId) ?? await restoreSession(tabId)
      if (!session) throw new Error('No active session for tab. Please re-detect.')
      return session.mappingResults
    }
  )

  // APPLY_VALUES — write approved values, record history (idempotent via requestId)
  onMessage<{ tabId: number; results: MappingResult[]; url: string; company: string | null; role: string | null }, WriteResult[]>(
    'APPLY_VALUES',
    async ({ tabId, results, url, company, role }) => {
      const session = sessions.get(tabId) ?? await restoreSession(tabId)
      if (!session || session.tabId !== tabId) throw new Error('Tab changed — please re-detect.')

      // EC-22: idempotency — if this requestId was already completed, skip history write
      const alreadyDone = await isCompleted(session.requestId)

      await persistSession(session)

      // Write into all frames (fields may live in an iframe). Each frame writes
      // the fields it owns; fields not present in a frame are reported as failed
      // there but may succeed in another frame. Merge by fieldId, preferring ok.
      const frameWrites = await chrome.scripting.executeScript<[MappingResult[]], WriteResult[]>({
        target: { tabId, allFrames: true },
        func: (mappings) => {
          // @ts-expect-error runtime injection
          if (typeof window.__jff_writeValues !== 'function') return []
          // @ts-expect-error runtime injection
          return window.__jff_writeValues(mappings)
        },
        args: [results],
      })

      const mergedWrites = new Map<string, WriteResult>()
      for (const frame of frameWrites) {
        for (const wr of frame.result ?? []) {
          const existing = mergedWrites.get(wr.fieldId)
          // Prefer a successful write over a failed one from another frame
          if (!existing || (!existing.ok && wr.ok)) mergedWrites.set(wr.fieldId, wr)
        }
      }
      const writeResults = [...mergedWrites.values()]

      const rawSettings = await fileStore.readSettings()
      const settings = settingsService.parse(rawSettings)
      void settings

      if (!alreadyDone) {
        const histSvc = new HistoryService(fileStore)
        const filled = writeResults?.filter(r => r.ok && r.note !== 'skipped').length ?? 0
        const flagged = results.filter(r => !r.include || r.needsReview).length
        await histSvc.add({
          url, url_normalized: normalizeUrl(url),
          company, role,
          profile_used: session.profileSlug,
          filled_at: new Date().toISOString(),
          status: 'filled',
          fields_filled: filled,
          fields_flagged: flagged,
        })
        await markCompleted(session.requestId)
      }

      debugLog.info('orchestrator', `Applied values`, { tabId, filled: writeResults?.filter(r => r.ok).length, failed: writeResults?.filter(r => !r.ok).length })
      await clearSession(tabId)
      return writeResults ?? []
    }
  )

  // DUPLICATE_CHECK
  onMessage<{ url: string; company: string | null; role: string | null }, ApplicationRecord | null>(
    'DUPLICATE_CHECK',
    async ({ url, company, role }) => {
      await fileStore.reconnectFolder()
      const rawSettings = await fileStore.readSettings()
      const settings = settingsService.parse(rawSettings)
      const histSvc = new HistoryService(fileStore)
      return histSvc.checkDuplicate(url, company, role, settings.dedupeWindow)
    }
  )

  // HISTORY_ADD
  onMessage<Omit<ApplicationRecord, 'id'>, ApplicationRecord>(
    'HISTORY_ADD',
    async (record) => {
      await fileStore.reconnectFolder()
      const histSvc = new HistoryService(fileStore)
      return histSvc.add(record)
    }
  )

  // HISTORY_UPDATE_STATUS
  onMessage<{ id: string; status: ApplicationRecord['status'] }, void>(
    'HISTORY_UPDATE_STATUS',
    async ({ id, status }) => {
      await fileStore.reconnectFolder()
      const histSvc = new HistoryService(fileStore)
      await histSvc.updateStatus(id, status)
    }
  )

  // SAVE_QA_ENTRY — panel sends a new Q&A entry to save to the bank
  onMessage<QAEntry, void>(
    'SAVE_QA_ENTRY',
    async (entry) => {
      await fileStore.reconnectFolder()
      const existing = await fileStore.readQABank() ?? ''
      const updated = appendQAEntry(existing, entry)
      await fileStore.writeQABank(updated)
    }
  )

  // LOAD_PROFILE (reused as "structure profile text" message)
  onMessage<{ rawText: string; targetRole: string }, string>(
    'LOAD_PROFILE',
    async ({ rawText, targetRole }) => {
      const settings = await loadSettingsNoFolder()
      if (!settings.fallbackChain.length) throw new Error('No LLM provider configured. Please add one in Settings.')
      const chain = new FallbackChain(settings.fallbackChain, settingsService, settings)
      return structureProfileText(rawText, targetRole, chain)
    }
  )

  // TEST_PROVIDER — test a provider's connectivity
  // Accepts model + baseUrl from the UI so the test always uses live values,
  // not stale stored ones. Bypasses fileStore entirely.
  onMessage<{ providerId: string; model: string; baseUrl: string; apiKey: string }, { ok: boolean; latencyMs?: number; error?: string }>(
    'TEST_PROVIDER',
    async ({ providerId, model, baseUrl, apiKey }) => {
      debugLog.info('orchestrator', `Testing provider: ${providerId}`, { model })

      if (!apiKey) return { ok: false, error: 'No API key set. Paste your key and try again.' }
      if (!model) return { ok: false, error: 'No model set. Enter a model name first.' }

      const settings = await loadSettingsNoFolder()
      const provider = makeProvider({ id: providerId, name: providerId, model, baseUrl })
      const start = Date.now()
      try {
        await provider.complete(
          { systemPrompt: 'Reply with the single word: ok', userPrompt: 'ok', maxTokens: 5 },
          apiKey,
          settings.llmTimeoutMs,
        )
        const result = { ok: true, latencyMs: Date.now() - start }
        debugLog.info('orchestrator', `Provider test OK`, result)
        return result
      } catch (err) {
        const error = err instanceof LLMProviderError ? err.llmError.message : (err instanceof Error ? err.message : String(err))
        debugLog.error('orchestrator', `Provider test failed`, { error })
        return { ok: false, error }
      }
    }
  )

  // TEST_ALL_PROVIDERS — check health of all chain providers at once
  onMessage<void, { results: Record<string, { ok: boolean; latencyMs?: number; error?: string }>; allFailed: boolean; anyConfigured: boolean }>(
    'TEST_ALL_PROVIDERS',
    async () => {
      const chain = await makeFallbackChain()
      if (!chain) return { results: {}, allFailed: false, anyConfigured: false }
      return chain.testAllProviders()
    }
  )

  // GET_DEBUG_LOG — return current log entries to panel
  onMessage<void, import('./debug-log').LogEntry[]>(
    'GET_DEBUG_LOG',
    () => debugLog.getEntries()
  )

  // Restore orphaned sessions on SW startup (EC-22)
  chrome.tabs.query({}, async (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue
      const session = await restoreSession(tab.id)
      if (session) sessions.set(tab.id, session)
    }
  })
}
