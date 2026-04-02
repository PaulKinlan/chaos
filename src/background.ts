console.log('CHAOS loaded');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  console.log('CHAOS extension installed');
});
