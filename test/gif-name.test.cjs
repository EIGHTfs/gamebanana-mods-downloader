// test/gif-name.test.cjs —— ① gif 命名防覆盖：原名_大小MB（同名不同大小不覆盖）+ HEAD 失败前缀兜底
// 便携单测（不依赖网络/真实数据）：直接测 downloader.gifLocalName 的命名公式
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const log = makeLog("gif-name");
const { gifLocalName } = require("../server/lib/downloader");

loggedTest(log, "gifLocalName：size>0 → 原名_大小MB（同名不同大小 → 不同名，防覆盖）", () => {
  const a = gifLocalName("anigif.gif", 524288, "https://x/a/anigif.gif");   // 0.5MB
  const b = gifLocalName("anigif.gif", 1258291, "https://x/b/anigif.gif");  // 1.2MB
  assert.equal(a, "anigif_0.50MB.gif");
  assert.equal(b, "anigif_1.20MB.gif");
  assert.notEqual(a, b, "同名不同大小 → 本地名不同（不覆盖）");
});

loggedTest(log, "gifLocalName：1MB 精确 → 1.00MB（≥2 位小数）", () => {
  assert.equal(gifLocalName("a.gif", 1048576, "u"), "a_1.00MB.gif");
});

loggedTest(log, "gifLocalName：保留非 gif 扩展名", () => {
  assert.equal(gifLocalName("a.webp", 524288, "u"), "a_0.50MB.webp");
});

loggedTest(log, "gifLocalName：size=0（HEAD 失败）→ localGifName 前缀兜底，不同 URL 不同前缀", () => {
  const a = gifLocalName("anigif.gif", 0, "https://postimg.cc/aaa/anigif.gif");
  const b = gifLocalName("anigif.gif", 0, "https://postimg.cc/bbb/anigif.gif");
  assert.equal(a, "aaa_anigif.gif");
  assert.equal(b, "bbb_anigif.gif");
  assert.notEqual(a, b, "兜底前缀也不同（不同目录段），仍不覆盖");
});
