// test/append-dedup.test.cjs —— 追加任务的去重语义 + 复杂度回归门禁
//
// 背景（2026-10-11 实测）：planForAppend 的「已在列表则跳过」原来是
//   每个待追加项 × 逐条扫 pendingMods + items 的 O(n×m)。现场规模
//   2,544 × (3,655 + 36,739) ≈ 1.03 亿次 extractModId ⇒ **12,784ms** 纯 CPU 阻塞主线程，
//   用户侧表现为点「启动/继续 N 个 mod」后长时间无响应。
//   改法：先把两侧已有 modId 收进 Set（各扫一遍）再判定 ⇒ O(n+m)（实测 14ms）。
//
// 本测试同时守住两件事：
//   ① 语义等价——本批内重复只留一个 / 已在列表的跳过 / reset 模式（new|done|stopped）不清空判定；
//   ② 复杂度不退化——真实规模（3,655 + 36,739 + 2,544）必须在宽松上限内跑完（旧实现 12.8 秒必超）。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const path = require("path");

const log = makeLog("append-dedup");
const downloader = require(path.join(__dirname, "..", "server", "lib", "downloader.js"));

/** 测试用 modId 提取：取 URL 末尾数字（避免依赖 GB API 网络） */
const extract = (u) => { const m = String(u || "").match(/(\d+)\s*$/); return m ? m[1] : ""; };
const url = (n) => "https://gamebanana.com/mods/" + n;

loggedTest(log, "追加去重语义：本批内重复只留一个 / 已在列表跳过 / reset 不清空判定", () => {
  const t = {
    status: "paused",
    pendingMods: [{ profileUrl: url(1001), name: "a" }],
    items: [{ modUrl: url(1002), url: "" }, { path: "/x", url: url(1003) }]
  };
  // 本批内重复（3001 出现两次）+ 已在 pendingMods（1001）+ 已在 items（1002） ⇒ 跳过 3 个
  const r = downloader.planForAppend(t, [url(3001), url(3001), url(1001), url(1002), url(3002)], extract);
  assert.deepEqual(r.append, [url(3001), url(3002)], "append 应只留本批首个 3001 与全新 3002");
  assert.equal(r.dedupSkipped, 1, "本批内重复应计 1");
  assert.equal(r.listSkipped, 2, "已在 pendingMods/items 的各计 1");
  assert.equal(r.reset, null, "paused 不是 done/stopped ⇒ reset 为 null（追加不清空）");

  // reset 分支：done/stopped 清空批次 ⇒ 不做「已在列表」判定
  const rd = downloader.planForAppend({ status: "done", pendingMods: [], items: [] }, [url(1001)], extract);
  assert.equal(rd.reset, "done");
  const rs = downloader.planForAppend({ status: "stopped", pendingMods: [], items: [] }, [url(1001)], extract);
  assert.equal(rs.reset, "stopped");
  const rn = downloader.planForAppend(null, [url(1001)], extract);
  assert.equal(rn.reset, "new", "无任务 ⇒ new（新建批次）");
});

loggedTest(log, "追加去重复杂度：真实规模（3,655+36,739+2,544）O(n+m)，旧实现 12.8 秒必超", () => {
  const PEND = 3655, ITEMS = 36739, ADD = 2544;
  const t = {
    status: "paused",
    pendingMods: Array.from({ length: PEND }, (_, i) => ({ profileUrl: url(100000 + i), name: "P" + i })),
    items: Array.from({ length: ITEMS }, (_, i) => ({ modUrl: url(200000 + i), url: "" }))
  };
  const urls = Array.from({ length: ADD }, (_, i) => url(300000 + i));
  for (let i = 0; i < 200; i++) urls[i] = t.pendingMods[i * 3].profileUrl; // 200 个与已有重复

  const t0 = Date.now();
  const r = downloader.planForAppend(t, urls, extract);
  const ms = Date.now() - t0;
  assert.equal(r.listSkipped, 200, "与已有重复的 200 个应被跳过");
  assert.equal(r.append.length, ADD - 200, "其余全部保留");
  assert.ok(ms < 2000, `真实规模追加去重耗时 ${ms}ms，超过 2000ms 上限（O(n×m) 退化会到 12 秒级）`);
  log.info(`真实规模去重耗时 ${ms}ms（旧 O(n×m) 实现实测 12,784ms）`);
});
