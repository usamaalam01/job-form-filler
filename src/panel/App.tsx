export function App() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 text-sm">
      <header className="flex items-center gap-2 px-3 py-3 border-b border-gray-800 shrink-0">
        <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 12h8M8 8h5M8 16h6" />
        </svg>
        <span className="font-semibold text-white text-xs tracking-wide">Job Form Filler</span>
        <span className="ml-auto text-gray-600 text-xs">v0.1.0</span>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="w-10 h-10 rounded-xl bg-blue-950 border border-blue-800 flex items-center justify-center">
          <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 6v6l4 2" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <p className="text-gray-400 text-xs leading-relaxed max-w-[200px]">
          Phase 0 scaffold — product features coming in Phase 1.
        </p>
      </main>
    </div>
  )
}
