import { create } from 'zustand'
import type { MappingResult, ApplicationRecord, AppSettings } from '@shared/types'
import { SETTINGS_DEFAULTS } from '@shared/settings'

export type PanelTab = 'fill' | 'history' | 'settings'

export interface DuplicateInfo {
  record: ApplicationRecord
}

interface PanelState {
  // Navigation
  activeTab: PanelTab
  setActiveTab: (tab: PanelTab) => void

  // Profile
  profiles: string[]
  activeProfile: string | null
  setProfiles: (profiles: string[]) => void
  setActiveProfile: (slug: string | null) => void

  // Fill session
  tabId: number | null
  tabUrl: string
  mappingResults: MappingResult[]
  duplicate: DuplicateInfo | null
  isDetecting: boolean
  isApplying: boolean
  detectError: string | null
  applyError: string | null
  setTabId: (id: number | null) => void
  setTabUrl: (url: string) => void
  setMappingResults: (results: MappingResult[]) => void
  updateMappingResult: (fieldId: string, patch: Partial<MappingResult>) => void
  setDuplicate: (dup: DuplicateInfo | null) => void
  setIsDetecting: (v: boolean) => void
  setIsApplying: (v: boolean) => void
  setDetectError: (e: string | null) => void
  setApplyError: (e: string | null) => void
  clearSession: () => void

  // History
  history: ApplicationRecord[]
  setHistory: (records: ApplicationRecord[]) => void

  // Settings
  settings: AppSettings
  setSettings: (s: AppSettings) => void

  // Folder connected
  folderConnected: boolean
  setFolderConnected: (v: boolean) => void
}

export const usePanelStore = create<PanelState>((set) => ({
  activeTab: 'fill',
  setActiveTab: (tab) => set({ activeTab: tab }),

  profiles: [],
  activeProfile: null,
  setProfiles: (profiles) => set({ profiles }),
  setActiveProfile: (slug) => set({ activeProfile: slug }),

  tabId: null,
  tabUrl: '',
  mappingResults: [],
  duplicate: null,
  isDetecting: false,
  isApplying: false,
  detectError: null,
  applyError: null,
  setTabId: (tabId) => set({ tabId }),
  setTabUrl: (tabUrl) => set({ tabUrl }),
  setMappingResults: (mappingResults) => set({ mappingResults }),
  updateMappingResult: (fieldId, patch) => set(state => ({
    mappingResults: state.mappingResults.map(r =>
      r.field.fieldId === fieldId ? { ...r, ...patch } : r
    ),
  })),
  setDuplicate: (duplicate) => set({ duplicate }),
  setIsDetecting: (isDetecting) => set({ isDetecting }),
  setIsApplying: (isApplying) => set({ isApplying }),
  setDetectError: (detectError) => set({ detectError }),
  setApplyError: (applyError) => set({ applyError }),
  clearSession: () => set({ mappingResults: [], duplicate: null, detectError: null, applyError: null }),

  history: [],
  setHistory: (history) => set({ history }),

  settings: SETTINGS_DEFAULTS,
  setSettings: (settings) => set({ settings }),

  folderConnected: false,
  setFolderConnected: (folderConnected) => set({ folderConnected }),
}))
