import React from 'react'
import { createRoot } from 'react-dom/client'
import '../panel/index.css'

function OptionsApp() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <h1 className="text-lg font-bold text-white mb-2">Job Form Filler — Settings</h1>
      <p className="text-gray-500 text-sm">Settings UI added in Phase 4 (P4-T2).</p>
    </div>
  )
}

const root = document.getElementById('root')!
createRoot(root).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
)
