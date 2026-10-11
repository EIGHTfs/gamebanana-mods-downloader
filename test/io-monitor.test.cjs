// test/io-monitor.test.cjs —— IO 监测「按调用点计数」回归
//
// 背景（2026-10-12）：原来只按 label 归因（index-read / task-write / hash / download-write），
//   写盘 120MB/s 时定位不到**具体哪一行**在写。扩展为按调用点（file:line）归因。
//
// 关键约束（本测试的核心价值）：
//   ① 站点必须在 meter() **创建时**固定 —— 热路径（下载分块逐块计数）绝不抓栈；
//   ② count() 必须向后兼容（旧调用点不改也能跑，站点记 "(未标注)"）；
//   ③ snapshot().bySite 结构稳定（/api/io 消费）。
// 性能护栏见第 3 条用例：10 万次调用若每次抓栈会到秒级，这里卡 400ms。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const path = require("path");

const log = makeLog("io-monitor");
const io = require(path.join(__dirname, "..", "server", "lib", "io-monitor.js"));

loggedTest(log, "meter：站点在创建时固定（抓到本测试文件），按 label+站点聚合字节与次数", () => {
  io.reset();
  const a = io.meter("hash");
  const b = io.meter("hash", "downloader.js:69");      // 显式站点
  a(100); a(200);
  b(50);

  const sites = io.topSites();
  const byHash = sites.filter((x) => x.label === "hash");
  assert.equal(byHash.length, 2, "同一 label 下应有两个不同站点");
  const explicit = byHash.find((x) => x.site === "downloader.js:69");
  assert.ok(explicit, "显式站点应原样记录");
  assert.equal(explicit.bytes, 50);
  assert.equal(explicit.calls, 1);

  const auto = byHash.find((x) => x.site !== "downloader.js:69");
  assert.ok(auto, "未显式给站点时应自动捕获");
  assert.match(auto.site, /io-monitor\.test\.cjs:\d+/, "自动捕获应指向真实调用点（本测试文件:行号）");
  assert.equal(auto.bytes, 300, "同一 meter 的多次调用应累加");
  assert.equal(auto.calls, 2);

  // label 总量仍照旧（兼容既有 /api/io 消费方）
  const labels = io.topLabels();
  assert.equal(labels.find((x) => x.label === "hash").bytes, 350);
  log.info(`自动捕获站点 = ${auto.site}`);
});

loggedTest(log, "count：向后兼容（站点记「(未标注)」），也可显式给站点", () => {
  io.reset();
  io.count("task-write", 1000);
  io.count("task-write", 500, "download-task-store.js:83");
  const sites = io.topSites();
  assert.equal(sites.length, 2);
  assert.equal(sites.find((x) => x.site === "(未标注)").bytes, 1000, "不传站点应记为 (未标注)");
  assert.equal(sites.find((x) => x.site === "download-task-store.js:83").bytes, 500);
  assert.equal(io.topLabels()[0].bytes, 1500);
});

loggedTest(log, "性能护栏：meter 调用 10 万次 < 400ms（证明热路径不抓栈）", () => {
  io.reset();
  const m = io.meter("hash", "hot-path");
  const t0 = Date.now();
  for (let i = 0; i < 100000; i += 1) m(128);
  const ms = Date.now() - t0;
  assert.ok(ms < 400, `10 万次 meter 调用耗时 ${ms}ms（>400ms 说明每次都在抓栈，热路径会拖垮下载）`);
  const cell = io.topSites().find((x) => x.site === "hot-path");
  assert.equal(cell.calls, 100000);
  assert.equal(cell.bytes, 12800000);
  log.info(`10 万次 meter 调用 ${ms}ms`);
});

loggedTest(log, "snapshot：bySite 结构稳定 + byLabel 保留（/api/io 消费方不破）", () => {
  io.reset();
  io.meter("index-read", "index-html.js:39")(4096);
  const snap = io.snapshot();
  assert.ok(Array.isArray(snap.bySite), "bySite 必须是数组");
  assert.ok(Array.isArray(snap.byLabel), "byLabel 必须保留（兼容）");
  const s = snap.bySite[0];
  for (const k of ["label", "site", "bytes", "calls", "human"]) {
    assert.ok(k in s, `bySite 条目应含 ${k}`);
  }
  assert.equal(s.human, "4.0 KB");
  assert.equal(typeof snap.enabled, "boolean");
  assert.equal(typeof snap.uptimeMs, "number");
});

loggedTest(log, "reset：清空归因表，保证用例之间互不污染", () => {
  io.reset();
  assert.equal(io.topSites().length, 0);
  assert.equal(io.topLabels().length, 0);
});
