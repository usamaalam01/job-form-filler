import type {
  FillSession, DetectedField, MappingResult, WriteResult,
  ApplicationRecord,
} from '@shared/types'
import { onMessage } from '@shared/messaging'
import { applyRules } from '@shared/mapper-rules'
import { parseProfile } from '@shared/profile-parser'
import { HistoryService } from '@shared/history'
import { normalizeUrl } from '@shared/history'
import { FileStore } from '../panel/filestore'
import { settingsService } from '@shared/settings'

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

// ─── FileStore singleton (background uses panel's singleton via messages,
//     but can also operate on already-permitted handles after folder is set) ───

const fileStore = new FileStore()

// ─── Orchestrator init ────────────────────────────────────────────────────────

export function initOrchestrator(): void {
  // DETECT_FIELDS — inject content script, detect, run rules mapper
  onMessage<{ tabId: number; profileSlug: string }, { session: FillSession; duplicate: ApplicationRecord | null }>(
    'DETECT_FIELDS',
    async ({ tabId, profileSlug }) => {
      // Re-connect folder if needed (already-permitted handle)
      await fileStore.reconnectFolder()

      // Load profile
      const profileMd = await fileStore.readProfile(profileSlug)
      if (!profileMd) throw new Error(`Profile not found: ${profileSlug}`)
      const profile = parseProfile(profileMd)

      // Inject content script and detect fields
      const [{ result: detectedFields }] = await chrome.scripting.executeScript<[], DetectedField[]>({
        target: { tabId },
        func: () => {
          // @ts-expect-error — detectFields is injected by the content script
          return window.__jff_detectFields?.() ?? []
        },
      })

      // Run rules mapper
      const mappingResults = applyRules(detectedFields ?? [], profile)

      // Build session
      const session: FillSession = {
        tabId,
        profileSlug,
        detectedFields: detectedFields ?? [],
        mappingResults,
        requestId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
      }
      sessions.set(tabId, session)
      await persistSession(session)

      // Duplicate check
      const settings = settingsService.parse(await fileStore.readSettings())
      const histSvc = new HistoryService(fileStore)
      const [firstTab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabUrl = firstTab?.url ?? ''
      const duplicate = await histSvc.checkDuplicate(tabUrl, null, null, settings.dedupeWindow)

      return { session, duplicate }
    }
  )

  // MAP_FIELDS — return cached mapping results for a tab (Phase 2 adds LLM here)
  onMessage<{ tabId: number }, MappingResult[]>(
    'MAP_FIELDS',
    async ({ tabId }) => {
      const session = sessions.get(tabId) ?? await restoreSession(tabId)
      if (!session) throw new Error('No active session for tab. Please re-detect.')
      return session.mappingResults
    }
  )

  // APPLY_VALUES — write approved values to the content script, record history
  onMessage<{ tabId: number; results: MappingResult[]; url: string; company: string | null; role: string | null }, WriteResult[]>(
    'APPLY_VALUES',
    async ({ tabId, results, url, company, role }) => {
      // EC-29: verify tab hasn't changed
      const session = sessions.get(tabId) ?? await restoreSession(tabId)
      if (!session || session.tabId !== tabId) {
        throw new Error('Tab changed — please re-detect.')
      }

      await persistSession(session) // EC-22: persist before async ops

      // Send to content script
      const [{ result: writeResults }] = await chrome.scripting.executeScript<[MappingResult[]], WriteResult[]>({
        target: { tabId },
        func: (mappings) => {
          // @ts-expect-error — writeValues is injected by the content script
          return window.__jff_writeValues?.(mappings) ?? []
        },
        args: [results],
      })

      // Record history
      const settings = settingsService.parse(await fileStore.readSettings())
      const histSvc = new HistoryService(fileStore)
      const filled = writeResults?.filter(r => r.ok && r.note !== 'skipped').length ?? 0
      const flagged = results.filter(r => !r.include || r.needsReview).length
      await histSvc.add({
        url,
        url_normalized: normalizeUrl(url),
        company,
        role,
        profile_used: session.profileSlug,
        filled_at: new Date().toISOString(),
        status: 'filled',
        fields_filled: filled,
        fields_flagged: flagged,
      })
      void settings // used above

      await clearSession(tabId)
      return writeResults ?? []
    }
  )

  // DUPLICATE_CHECK — check history for a URL
  onMessage<{ url: string; company: string | null; role: string | null }, ApplicationRecord | null>(
    'DUPLICATE_CHECK',
    async ({ url, company, role }) => {
      await fileStore.reconnectFolder()
      const settings = settingsService.parse(await fileStore.readSettings())
      const histSvc = new HistoryService(fileStore)
      return histSvc.checkDuplicate(url, company, role, settings.dedupeWindow)
    }
  )

  // HISTORY_ADD — manually add a history entry (e.g. mark submitted)
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

  // Restore orphaned sessions on SW startup (EC-22)
  chrome.tabs.query({}, async (tabs) => {
    for (const tab of tabs) {
      if (!tab.id) continue
      const session = await restoreSession(tab.id)
      if (session) sessions.set(tab.id, session)
    }
  })
}
