"use strict";
// 页面侧：把当前 mod 链接交给扩展（popup「开始下载」也会走 background）。
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "currentUrl") sendResponse({ url: location.href });
});
