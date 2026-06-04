import { useState } from 'react'
import { fileStore } from '../filestore'
import { settingsService } from '@shared/settings'
import { ProviderHealthCard } from './ProviderHealthCard'
import type { ProviderConfig } from '@shared/types'

interface Props {
  onComplete: () => void
}

type Step = 'welcome' | 'folder' | 'profile' | 'llm' | 'disclaimer'
const STEPS: Step[] = ['welcome', 'folder', 'profile', 'llm', 'disclaimer']

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [folderConnected, setFolderConnected] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [profileCreated, setProfileCreated] = useState(false)
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({})
  const [providers, setProviders] = useState(settingsService.parse({}).providers)
  const [error, setError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  const stepIndex = STEPS.indexOf(step)

  const pickFolder = async () => {
    setError(null)
    try {
      await fileStore.requestFolder()
      setFolderConnected(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open folder picker.')
    }
  }

  const createProfile = async () => {
    if (!profileName.trim()) return
    setCreatingProfile(true)
    setError(null)
    try {
      const slug = profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const md = `---\nprofile_name: ${profileName}\n${targetRole ? `target_role: ${targetRole}\n` : ''}updated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Personal Information\n- Full name: \n- Email: \n- Phone: \n\n# Preferences\n- Work authorization: \n- Notice period: \n- Salary expectation: \n`
      await fileStore.writeProfile(slug, md)
      // Set as default profile in settings
      const raw = await fileStore.readSettings()
      const s = settingsService.parse(raw)
      await fileStore.writeSettings(settingsService.serialise({ ...s, defaultProfile: slug }))
      setProfileCreated(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile.')
    } finally {
      setCreatingProfile(false)
    }
  }

  const finish = async () => {
    try {
      const raw = await fileStore.readSettings()
      const s = settingsService.parse(raw)
      const updated = { ...s, providers, onboardingComplete: true } as typeof s & { onboardingComplete: boolean }
      // Save provider configs to disk
      await fileStore.writeSettings(settingsService.serialise(updated))
      // Cache LLM settings to chrome.storage.local for background SW access
      await settingsService.cacheLLMSettings(updated)
      // Save API keys
      for (const [id, key] of Object.entries(providerKeys)) {
        if (key) await settingsService.setApiKey(id, key, s)
      }
      onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings.')
    }
  }

  const next = () => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const canProceed: Record<Step, boolean> = {
    welcome: true,
    folder: folderConnected,
    profile: true, // optional
    llm: true,     // optional
    disclaimer: agreed,
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      {/* Progress bar */}
      <div className="flex shrink-0">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 transition-colors ${i <= stepIndex ? 'bg-blue-500' : 'bg-gray-800'}`}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-y-auto p-5 gap-4">

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-950 border border-blue-800 flex items-center justify-center text-3xl">📋</div>
              <h1 className="text-lg font-bold text-white">Welcome to Job Form Filler</h1>
              <p className="text-xs text-gray-400 max-w-[240px]">Auto-fill job applications from your local profile. No data leaves your machine.</p>
            </div>
            <div className="flex flex-col gap-2">
              {[
                ['🗂', 'Your profile stays on your disk — no cloud, no accounts.'],
                ['🤖', 'Hybrid fill: fast rules for common fields, AI for the rest.'],
                ['✅', 'You always review before submitting. Nothing is auto-submitted.'],
              ].map(([icon, text]) => (
                <div key={text} className="flex gap-3 items-start bg-gray-900 rounded-lg p-3 border border-gray-800">
                  <span className="text-lg shrink-0">{icon}</span>
                  <p className="text-xs text-gray-300">{text}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Step: Folder */}
        {step === 'folder' && (
          <>
            <div className="text-center py-3">
              <div className="text-4xl mb-2">📁</div>
              <h2 className="text-base font-bold text-white mb-1">Choose a data folder</h2>
              <p className="text-xs text-gray-400">All profiles, Q&A answers and history will be saved here as plain files you can edit anytime.</p>
            </div>
            {folderConnected
              ? <div className="rounded-lg border border-green-800 bg-green-950/40 p-3 text-xs text-green-300 text-center">✓ Data folder connected!</div>
              : <button onClick={pickFolder} className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold">Pick folder</button>
            }
            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            <p className="text-[10px] text-gray-600 text-center">API keys are stored separately in the browser's sandboxed storage — never in this folder.</p>
          </>
        )}

        {/* Step: Profile */}
        {step === 'profile' && (
          <>
            <div className="text-center py-2">
              <div className="text-3xl mb-2">👤</div>
              <h2 className="text-base font-bold text-white mb-1">Create your first profile</h2>
              <p className="text-xs text-gray-400">Optional — you can add one later.</p>
            </div>
            {profileCreated
              ? <div className="rounded-lg border border-green-800 bg-green-950/40 p-3 text-xs text-green-300 text-center">✓ Profile created! You can edit it after setup.</div>
              : (
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Profile name *</label>
                    <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)}
                      placeholder="e.g. ML Engineer"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Target role (optional)</label>
                    <input type="text" value={targetRole} onChange={e => setTargetRole(e.target.value)}
                      placeholder="e.g. Machine Learning Engineer"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                  <button
                    onClick={createProfile}
                    disabled={!profileName.trim() || creatingProfile}
                    className="w-full py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold disabled:opacity-40"
                  >
                    {creatingProfile ? 'Creating…' : 'Create profile'}
                  </button>
                </div>
              )
            }
          </>
        )}

        {/* Step: LLM */}
        {step === 'llm' && (
          <>
            <div className="text-center py-2">
              <div className="text-3xl mb-2">🤖</div>
              <h2 className="text-base font-bold text-white mb-1">Add an AI provider</h2>
              <p className="text-xs text-gray-400 mb-3">Optional — rules-only filling works without a key. AI improves coverage of unusual fields.</p>
            </div>
            <div className="flex flex-col gap-2">
              {providers.slice(0, 3).map(p => (
                <ProviderHealthCard
                  key={p.id}
                  provider={p}
                  apiKey={providerKeys[p.id] ?? ''}
                  onChange={patch => setProviders(prev => prev.map(pr => pr.id === p.id ? { ...pr, ...patch } : pr) as ProviderConfig[])}
                  onKeyChange={key => setProviderKeys(prev => ({ ...prev, [p.id]: key }))}
                />
              ))}
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </>
        )}

        {/* Step: Disclaimer */}
        {step === 'disclaimer' && (
          <>
            <div className="text-center py-3">
              <div className="text-3xl mb-2">⚖️</div>
              <h2 className="text-base font-bold text-white mb-1">One last thing</h2>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 text-xs text-gray-300 leading-relaxed space-y-2">
              <p>This tool fills form fields based on your profile and suggests values. <strong className="text-white">You are responsible for reviewing every value before submitting.</strong></p>
              <p>The tool will never click Submit on your behalf, never fabricate facts not in your profile, and never bypass captchas or anti-bot systems.</p>
              <p>Ensure all submitted information is truthful and accurate.</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                className="w-4 h-4 accent-blue-500" />
              <span className="text-xs text-gray-300">I understand and accept responsibility for the accuracy of submitted data.</span>
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </>
        )}
      </div>

      {/* Footer nav */}
      <div className="shrink-0 border-t border-gray-800 p-4 flex gap-2">
        {stepIndex > 0 && (
          <button
            onClick={() => setStep(STEPS[stepIndex - 1])}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold"
          >
            Back
          </button>
        )}
        <div className="flex-1" />
        {step === 'disclaimer'
          ? (
            <button
              onClick={finish}
              disabled={!agreed}
              className="px-5 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-bold disabled:opacity-40"
            >
              Get started
            </button>
          ) : (
            <button
              onClick={next}
              disabled={!canProceed[step]}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-40"
            >
              {step === 'profile' || step === 'llm' ? 'Skip' : 'Next'}
            </button>
          )
        }
      </div>
    </div>
  )
}
