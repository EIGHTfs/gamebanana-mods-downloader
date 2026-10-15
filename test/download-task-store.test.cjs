// test/download-task-store.test.cjs —— 2026-10-11 新增：
//   下载任务落盘存储层的单测（越界键清理 / 快照净化 / 原子写 / 节流合并写）
//
// 背景：部署端 json/download_task.json 实测 12.7MB、saveTask ≈100ms/次且被 ~18 处调用，
//   万级任务时卡顿；本次改为「越界键清理 + 快照净化 + 原子写 + 合并写」。
// 本测试只测纯函数与可注入的写入器（临时目录，不碰项目数据、不依赖网络）。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../server/lib/download-task-store");

const log = makeLog("download-task-store");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

loggedTest(log, "pruneStaleResults：删掉越界键，保留合法键与顺序", () => {
  const task = { items: [{}, {}, {}], resultsMap: { 0: { ok: true }, 1: { ok: true }, 2: { ok: true }, 3: { ok: true }, 10: { ok: true } } };
  const removed = store.pruneStaleResults(task);
  assert.equal(removed, 2, "下标 3 与 10 越界，应删 2 个");
  assert.deepEqual(Object.keys(task.resultsMap), ["0", "1", "2"]);
});

loggedTest(log, "pruneStaleResults：负下标/非数字键也清掉", () => {
  const task = { items: [{}], resultsMap: { 0: { ok: true }, "-1": { ok: true }, abc: { ok: true }, "1e3": { ok: true } } };
  const removed = store.pruneStaleResults(task);
  assert.equal(removed, 3);
  assert.deepEqual(Object.keys(task.resultsMap), ["0"]);
});

loggedTest(log, "pruneStaleResults：items 为空 → 全清；异常输入安全返回 0", () => {
  const t1 = { items: [], resultsMap: { 0: {}, 1: {} } };
  assert.equal(store.pruneStaleResults(t1), 2);
  assert.deepEqual(t1.resultsMap, {});
  assert.equal(store.pruneStaleResults(null), 0);
  assert.equal(store.pruneStaleResults({}), 0);
  assert.equal(store.pruneStaleResults({ items: [{}], resultsMap: null }), 0);
});

loggedTest(log, "buildSnapshot：剥离 activeItems 的运行时字段 + 精简 preparingItem", () => {
  const task = {
    status: "running",
    items: [{ url: "u1" }],
    resultsMap: { 0: { ok: true }, 5: { ok: true } },
    activeItems: [{ idx: 0, name: "a.jpg", speed: 1234, _spT: 111, _spLast: 222 }],
    preparingItem: { name: "b.jpg", type: "preparing", extra: "x" },
    concurrency: 8
  };
  const { snapshot, pruned } = store.buildSnapshot(task);
  assert.equal(pruned, 1, "越界键 5 应被清掉");
  assert.equal(snapshot.activeItems[0]._spT, undefined);
  assert.equal(snapshot.activeItems[0]._spLast, undefined);
  assert.equal(snapshot.activeItems[0].speed, 1234, "其它字段保留");
  assert.deepEqual(snapshot.preparingItem, { name: "b.jpg", type: "preparing" });
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.concurrency, 8);
  // 序列化后不应出现被剥离的字段（JSON.stringify 会丢 undefined）
  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes("_spT") && !text.includes("_spLast"), "落盘文本不应含速度采样字段");
});

loggedTest(log, "buildSnapshot：task 为 null → 快照 null（与旧实现一致）", () => {
  const r = store.buildSnapshot(null);
  assert.equal(r.snapshot, null);
  assert.equal(r.pruned, 0);
});

loggedTest(log, "writeFileAtomic：写入正确且不残留临时文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-store-test-"));
  const file = path.join(dir, "task.json");
  store.writeFileAtomic(file, '{"a":1}');
  assert.equal(fs.readFileSync(file, "utf8"), '{"a":1}');
  store.writeFileAtomic(file, '{"a":2,"b":3}');   // 覆盖写
  assert.equal(fs.readFileSync(file, "utf8"), '{"a":2,"b":3}');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftovers, [], "不应残留临时文件");
  fs.rmSync(dir, { recursive: true, force: true });
});

loggedTest(log, "createTaskWriter：窗口内多次 save 只落一次盘（合并写）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-store-test-"));
  const file = path.join(dir, "task.json");
  let task = { status: "running", items: [{ url: "u" }], resultsMap: { 0: { ok: true } } };
  const w = store.createTaskWriter({ filePath: file, getTask: () => task, throttleMs: 50, backend: "json" });
  for (let i = 0; i < 10; i++) w.save();
  assert.equal(fs.existsSync(file), false, "节流窗口内不应立刻写盘");
  await sleep(150);
  assert.equal(w.stats.writes, 1, "10 次 save 应合并成 1 次写盘");
  assert.equal(w.stats.saves, 10);
  assert.equal(w.stats.coalesced, 9);
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(written.status, "running");
  assert.deepEqual(Object.keys(written.resultsMap), ["0"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

loggedTest(log, "createTaskWriter：flush 立即落盘；无脏数据不写；cancel 后不写", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-store-test-"));
  const file = path.join(dir, "task.json");
  const task = { status: "paused", items: [], resultsMap: {} };
  const w = store.createTaskWriter({ filePath: file, getTask: () => task, throttleMs: 5000, backend: "json" });
  assert.equal(w.flush(), false, "无脏数据 → 不写");
  assert.equal(fs.existsSync(file), false);
  w.save();
  assert.equal(w.flush(), true, "flush 应立即落盘");
  assert.equal(w.stats.writes, 1);
  assert.ok(fs.existsSync(file));
  // cancel：取消窗口内残留写盘（对应「终止任务并删除任务文件」场景，避免任务复活）
  w.save();
  w.cancel();
  await sleep(60);
  assert.equal(w.stats.writes, 1, "cancel 后不应再写");
  assert.equal(w._hasPending(), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

loggedTest(log, "createTaskWriter：落盘时累计越界键清理数（stats.prunedKeys）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-store-test-"));
  const file = path.join(dir, "task.json");
  const task = { status: "running", items: [{}], resultsMap: { 0: { ok: true }, 7: { ok: true }, 8: { ok: true } } };
  const w = store.createTaskWriter({ filePath: file, getTask: () => task, throttleMs: 10, backend: "json" });
  w.save();
  await sleep(60);
  assert.equal(w.stats.prunedKeys, 2, "越界键 7、8 应被清理并计数");
  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(written.resultsMap), ["0"]);
  fs.rmSync(dir, { recursive: true, force: true });
});
