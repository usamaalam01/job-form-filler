// Background service worker entry point.
// Wired up in Phase 0; orchestration logic added in P1-T8.
chrome.runtime.onInstalled.addListener(() => {
  console.log('[JFF] Extension installed.')
})

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id! })
})
