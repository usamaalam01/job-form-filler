import { useEffect, useCallback, useState as useStateAlias } from 'react'
import { Onboarding } from './components/Onboarding'
import { usePanelStore } from './store/panelStore'
import { fileStore } from './filestore'
import { settingsService } from '@shared/settings'
import { sendToBackground } from '@shared/messaging'
import { HistoryService } from '@shared/history'
import { ProfileSelector } from './components/ProfileSelector'
import { ProfileEditor } from './components/ProfileEditor'
import { ProfileBuilder } from './components/ProfileBuilder'
import { ReviewTable } from './components/ReviewTable'
import { FlaggedItems } from './components/FlaggedItems'
import { DuplicateWarning } from './components/DuplicateWarning'
import { HistoryView } from './components/HistoryView'
import { Settings as SettingsPanel } from './components/Settings'
import type { ApplicationRecord, MappingResult } from '@shared/types'
import { useState } from 'react'

export function Panel() {
  const {
    activeTab, setActiveTab,
    setProfiles,
    activeProfile, setActiveProfile,
    tabId, setTabId, tabUrl, setTabUrl,
    mappingResults, setMappingResults,
    duplicate, setDuplicate,
    isDetecting, setIsDetecting,
    isApplying, setIsApplying,
    detectError, setDetectError,
    applyError, setApplyError,
    setHistory,
    folderConnected, setFolderConnected,
    settings, setSettings,
  } = usePanelStore()

  const [showOnboarding, setShowOnboarding] = useStateAlias(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [buildingProfile, setBuildingProfile] = useState(false)
  const [applyResults, setApplyResults] = useState<{ ok: number; fail: number } | null>(null)
  const [llmWarning, setLlmWarning] = useState<string | null>(null)
  const [providerHealthWarning, setProviderHealthWarning] = useState<string | null>(null)

  // ── Init ──────────────────────────────────────────────────────────────────

  const loadProfiles = useCallback(async () => {
    try {
      const slugs = await fileStore.listProfiles()
      setProfiles(slugs)
      if (slugs.length && !activeProfile) setActiveProfile(slugs[0])
    } catch { /* folder not connected yet */ }
  }, [activeProfile, setActiveProfile, setProfiles])

  const loadHistory = useCallback(async () => {
    try {
      const histSvc = new HistoryService(fileStore)
      const records = await histSvc.list()
      setHistory(records)
    } catch { /* ignore */ }
  }, [setHistory])

  useEffect(() => {
    const init = async () => {
      const connected = await fileStore.reconnectFolder()
      setFolderConnected(connected)
      if (connected) {
        await loadProfiles()
        await loadHistory()
        const raw = await fileStore.readSettings()
        const parsed = settingsService.parse(raw)
        setSettings(parsed)
        // Show onboarding only if never completed AND no profiles exist
        const slugs = await fileStore.listProfiles()
        const onboardingDone = (raw as Record<string, unknown>)['onboardingComplete'] === true
        if (!onboardingDone && slugs.length === 0) setShowOnboarding(true)
        // Background health check — warn if all configured providers are failing
        checkProviderHealth()
      } else {
        // Check if onboarding was previously completed via chrome.storage.local flag.
        // If yes, the folder handle expired (browser restart) — show "re-connect" screen.
        // If no, this is a fresh install — show onboarding.
        const stored = await chrome.storage.local.get('onboardingComplete')
        if (stored['onboardingComplete'] === true) {
          // folder needs re-grant, don't show onboarding again
        } else {
          setShowOnboarding(true)
        }
      }
      // Get active tab info
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        setTabId(tab.id)
        setTabUrl(tab.url ?? '')
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Provider health check ─────────────────────────────────────────────────

  const checkProviderHealth = useCallback(async () => {
    try {
      const { allFailed, anyConfigured, results } = await sendToBackground<
        void,
        { results: Record<string, { ok: boolean; error?: string }>; allFailed: boolean; anyConfigured: boolean }
      >({ type: 'TEST_ALL_PROVIDERS', payload: undefined })

      if (!anyConfigured) {
        setProviderHealthWarning('No LLM providers configured. AI mapping is disabled — fields will be filled by rules only. Add a provider in Settings.')
      } else if (allFailed) {
        const errors = Object.entries(results)
          .filter(([, r]) => !r.ok)
          .map(([id, r]) => `${id}: ${r.error ?? 'failed'}`)
          .join(' · ')
        setProviderHealthWarning(`All LLM providers are unreachable or have invalid keys. AI mapping is disabled. → ${errors}`)
      } else {
        setProviderHealthWarning(null)
      }
    } catch {
      // Background not ready yet — silent fail, not a user-facing error
    }
  }, [])

  // ── Connect folder ────────────────────────────────────────────────────────

  const connectFolder = async () => {
    await fileStore.requestFolder()
    setFolderConnected(true)
    await loadProfiles()
    await loadHistory()
    const raw = await fileStore.readSettings()
    setSettings(settingsService.parse(raw))
  }

  // ── Detect & map ──────────────────────────────────────────────────────────

  const detectAndMap = async () => {
    if (!tabId || !activeProfile) return
    setIsDetecting(true)
    setDetectError(null)
    setApplyResults(null)
    try {
      const { session, duplicate: dup, llmError } = await sendToBackground<
        { tabId: number; profileSlug: string },
        { session: { mappingResults: MappingResult[] }; duplicate: ApplicationRecord | null; llmError?: string }
      >({ type: 'DETECT_FIELDS', payload: { tabId, profileSlug: activeProfile } })

      setMappingResults(session.mappingResults)
      setDuplicate(dup ? { record: dup } : null)
      setLlmWarning(llmError ?? null)
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : 'Detection failed.')
    } finally {
      setIsDetecting(false)
    }
  }

  // ── Apply to page ─────────────────────────────────────────────────────────

  const applyToPage = async () => {
    if (!tabId) return
    setIsApplying(true)
    setApplyError(null)
    try {
      const results = await sendToBackground<
        { tabId: number; results: MappingResult[]; url: string; company: string | null; role: string | null },
        Array<{ fieldId: string; ok: boolean; note?: string }>
      >({
        type: 'APPLY_VALUES',
        payload: { tabId, results: mappingResults, url: tabUrl, company: null, role: null },
      })
      const ok = results.filter(r => r.ok && r.note !== 'skipped').length
      const fail = results.filter(r => !r.ok).length
      setApplyResults({ ok, fail })
      await loadHistory()
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Apply failed.')
    } finally {
      setIsApplying(false)
    }
  }

  // ── Create profile ────────────────────────────────────────────────────────

  const createProfile = async () => {
    const name = prompt('Profile name (e.g. "ML Engineer"):')
    if (!name) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const template = `---\nprofile_name: ${name}\nupdated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Personal Information\n- Full name: \n- Email: \n`
    await fileStore.writeProfile(slug, template)
    await loadProfiles()
    setActiveProfile(slug)
    // Open AI builder so user can paste resume text immediately
    setBuildingProfile(true)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (showOnboarding) {
    return (
      <Onboarding onComplete={async () => {
        setShowOnboarding(false)
        setFolderConnected(true)
        await chrome.storage.local.set({ onboardingComplete: true })
        await loadProfiles()
        await loadHistory()
        const raw = await fileStore.readSettings()
        setSettings(settingsService.parse(raw))
      }} />
    )
  }

  if (!folderConnected) {
    return (
      <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-yellow-950 border border-yellow-800 flex items-center justify-center text-2xl">📁</div>
          <div>
            <p className="text-sm font-semibold text-white">Re-connect your data folder</p>
            <p className="text-xs text-gray-500 mt-1">Chrome requires folder access to be re-granted after a browser restart. Your data is safe — just pick the same folder again.</p>
          </div>
          <button onClick={connectFolder} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
            Pick folder
          </button>
        </div>
      </div>
    )
  }

  if (editingProfile) {
    return (
      <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
        <Header />
        <ProfileEditor onClose={() => { setEditingProfile(false); loadProfiles() }} />
      </div>
    )
  }

  if (buildingProfile) {
    return (
      <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
        <Header />
        <ProfileBuilder
          activeProfile={activeProfile}
          onSaved={() => { setBuildingProfile(false); loadProfiles() }}
          onClose={() => setBuildingProfile(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 text-sm">
      <Header />

      {/* Tabs */}
      <div className="flex border-b border-gray-800 shrink-0">
        {(['fill', 'history', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors ${
              activeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'fill' ? 'Fill' : tab === 'history' ? 'History' : 'Settings'}
          </button>
        ))}
      </div>

      {/* Fill tab */}
      {activeTab === 'fill' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <ProfileSelector
            onEdit={() => setEditingProfile(true)}
            onNew={createProfile}
            onImported={loadProfiles}
          />

          {/* Duplicate warning */}
          {duplicate && (
            <DuplicateWarning record={duplicate.record} onDismiss={() => setDuplicate(null)} />
          )}

          {/* Action buttons */}
          <div className="flex gap-2 px-3 py-2 shrink-0">
            <button
              onClick={detectAndMap}
              disabled={isDetecting || !activeProfile}
              className="flex-1 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {isDetecting ? 'Detecting…' : 'Detect & Map'}
            </button>
            <button
              onClick={applyToPage}
              disabled={isApplying || mappingResults.length === 0}
              className="flex-1 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors"
            >
              {isApplying ? 'Applying…' : 'Apply to page'}
            </button>
          </div>

          {/* Status messages */}
          {providerHealthWarning && (
            <div className="mx-3 mt-1 rounded-lg border border-orange-800 bg-orange-950/50 px-3 py-2 flex items-start gap-2">
              <span className="text-orange-400 shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-orange-300 leading-relaxed">{providerHealthWarning}</p>
                <button
                  onClick={checkProviderHealth}
                  className="mt-1 text-[10px] text-orange-500 hover:text-orange-300 underline"
                >
                  Re-check
                </button>
              </div>
              <button onClick={() => setProviderHealthWarning(null)} className="text-orange-700 hover:text-orange-400 text-xs shrink-0">✕</button>
            </div>
          )}
          {detectError && <p className="text-xs text-red-400 px-3">{detectError}</p>}
          {applyError && <p className="text-xs text-red-400 px-3">{applyError}</p>}
          {llmWarning && <p className="text-xs text-yellow-500 px-3">⚠ {llmWarning}</p>}
          {applyResults && (
            <p className="text-xs text-green-400 px-3">
              ✓ {applyResults.ok} filled{applyResults.fail > 0 ? `, ${applyResults.fail} failed` : ''}
            </p>
          )}

          {/* Flagged items */}
          {mappingResults.length > 0 && <FlaggedItems results={mappingResults} />}

          {/* Review table */}
          <div className="flex-1 overflow-y-auto">
            <ReviewTable results={mappingResults} />
          </div>

          {/* Stats bar */}
          {mappingResults.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-800 text-[10px] text-gray-500 flex gap-3 shrink-0">
              <span className="text-green-500">{mappingResults.filter(r => r.source !== 'blank').length} mapped</span>
              <span className="text-red-400">{mappingResults.filter(r => r.source === 'blank').length} blank</span>
              <span className="text-yellow-400">{mappingResults.filter(r => r.needsReview).length} review</span>
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto">
          <HistoryView />
        </div>
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-3 pt-2 pb-1 shrink-0">
            <button
              onClick={() => setBuildingProfile(true)}
              disabled={!activeProfile}
              className="w-full py-1.5 rounded-lg border border-purple-800 bg-purple-950/40 text-purple-300 text-xs font-semibold disabled:opacity-40 hover:bg-purple-900/40 mb-2"
            >
              Build profile from pasted text (AI)
            </button>
          </div>
          <SettingsPanel
            settings={settings}
            onSettingsChange={setSettings}
            onDataDeleted={async () => {
              setSettings(settingsService.parse({}))
              setMappingResults([])
            }}
          />
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <header className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800 shrink-0 bg-gray-950">
      <svg className="w-4 h-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <path d="M8 12h8M8 8h5M8 16h6"/>
      </svg>
      <span className="font-bold text-white text-xs tracking-wide">Job Form Filler</span>
      <span className="ml-auto text-gray-700 text-[10px]">v0.1</span>
    </header>
  )
}
