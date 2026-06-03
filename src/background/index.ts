import { initOrchestrator } from './orchestrator'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[JFF] Extension installed.')
})

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id! })
})

initOrchestrator()
