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
import { FallbackChain } from './llm/fallback'
import { mapFieldsWithLLM } from './mapper-llm'
import { matchQuestion } from './qa-matcher'
import { structureProfileText } from './profile-builder'
import { FallbackExhaustedError } from './llm/provider'

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

// ─── FallbackChain factory ────────────────────────────────────────────────────

async function makeFallbackChain(): Promise<FallbackChain | null> {
  const rawSettings = await fileStore.readSettings()
  const settings = settingsService.parse(rawSettings)
  if (!settings.fallbackChain.length) return null
  return new FallbackChain(settings.fallbackChain, settingsService, settings)
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

      // Inject content script and detect fields
      const [{ result: detectedFields }] = await chrome.scripting.executeScript<[], DetectedField[]>({
        target: { tabId },
        func: () => {
          // @ts-expect-error runtime injection
          return window.__jff_detectFields?.() ?? []
        },
      })

      const fields = detectedFields ?? []

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

      // Merge: resolved (rules) + LLM structural + Q&A + upload flags
      const uploadResults = rulesResults.filter(r => r.field.isUpload)
      const mappingResults: MappingResult[] = [
        ...resolved,
        ...llmResults,
        ...qaResults,
        ...uploadResults,
      ]

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

  // APPLY_VALUES — write approved values, record history
  onMessage<{ tabId: number; results: MappingResult[]; url: string; company: string | null; role: string | null }, WriteResult[]>(
    'APPLY_VALUES',
    async ({ tabId, results, url, company, role }) => {
      const session = sessions.get(tabId) ?? await restoreSession(tabId)
      if (!session || session.tabId !== tabId) throw new Error('Tab changed — please re-detect.')

      await persistSession(session)

      const [{ result: writeResults }] = await chrome.scripting.executeScript<[MappingResult[]], WriteResult[]>({
        target: { tabId },
        func: (mappings) => {
          // @ts-expect-error runtime injection
          return window.__jff_writeValues?.(mappings) ?? []
        },
        args: [results],
      })

      const rawSettings = await fileStore.readSettings()
      const settings = settingsService.parse(rawSettings)
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
      void settings

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
      const chain = await makeFallbackChain()
      if (!chain) throw new Error('No LLM provider configured. Please add one in Settings.')
      return structureProfileText(rawText, targetRole, chain)
    }
  )

  // TEST_PROVIDER — test a provider's connectivity
  onMessage<{ providerId: string }, { ok: boolean; latencyMs?: number; error?: string }>(
    'TEST_PROVIDER',
    async ({ providerId }) => {
      const chain = await makeFallbackChain()
      if (!chain) return { ok: false, error: 'No providers configured.' }
      return chain.testProvider(providerId)
    }
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
