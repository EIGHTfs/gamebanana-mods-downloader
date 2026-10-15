// test/task-store-autoswitch.test.cjs —— 2026-10-15 新增：任务列表「自动切库」行为
//
// 覆盖 download-task-store.js 的 auto 模式切换判据（与 test/task-store-sqlite.test.cjs 互补：
// 那个文件测存储后端本身，本文件只测「什么时候切」）：
//   ① 旧 json 那批**还有未完成项** ⇒ 继续用 JSON（不打断正在跑的批次）
//   ② 旧 json 那批**已全部下完** ⇒ 首次 save/flush 自动切到 SQLite，并把旧 json 退休进 .trash
//   ③ 切库过程中状态不能丢（切完从库读回来必须还是同一份）
//   ④ 强制 backend=json 时不切（现场排障用的逃生口）
//
// 隔离：全部在 os.tmpdir() 下建临时目录，绝不碰项目真实 json/。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const log = makeLog("task-store-autoswitch");
const store = require("../server/lib/download-task-store.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "task-switch-"));
}

/** 一份任务态（items + resultsMap；status 由调用方决定） */
function makeTask(n, status) {
  const items = [];
  const resultsMap = {};
  for (let i = 0; i < n; i++) {
    items.push({ type: "file", url: "u" + i, path: "/p/" + i + ".zip", displayName: i + ".zip", size: i + 1 });
    resultsMap[i] = { ok: i % 2 === 0, skipped: i % 2 === 1, exists: true, size: i + 1 };
  }
  return { status: status || "running", items, resultsMap, doneCount: n, concurrency: 3 };
}

function writerFor(jsonPath, live) {
  return store.createTaskWriter({
    filePath: jsonPath, ensureDir: () => {}, getTask: () => live, throttleMs: 1, log: () => {}
  });
}

loggedTest(log, "未下完 ⇒ 不切库：旧 json 那批还有未完成项时继续用 JSON", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const legacy = makeTask(3, "running");           // running ⇒ 未下完
    fs.writeFileSync(jsonPath, JSON.stringify(legacy, null, 2), "utf8");

    const live = makeTask(3, "running");
    const w = writerFor(jsonPath, live);
    assert.equal(w.mode, "json", "创建时应先按 JSON");
    w.save(); w.flush();
    assert.equal(w.mode, "json", "那批没下完 ⇒ 落盘后仍是 JSON");
    assert.equal(fs.existsSync(jsonPath), true, "旧 json 必须原地保留");
    assert.equal(fs.existsSync(store.dbPathOf(jsonPath)), false, "不该建库");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "已下完 ⇒ 自动切库：首次落盘切到 SQLite 并把旧 json 退休进 .trash", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const legacy = makeTask(3, "done");              // done + 每条都有结果 ⇒ 已下完
    fs.writeFileSync(jsonPath, JSON.stringify(legacy, null, 2), "utf8");

    const live = makeTask(3, "done");
    const w = writerFor(jsonPath, live);
    assert.equal(w.mode, "json", "创建时状态还没恢复，不能先动库");
    w.save(); w.flush();

    assert.equal(w.mode, "sqlite", "那批已下完 ⇒ 首次落盘后应已切到 SQLite");
    assert.equal(fs.existsSync(jsonPath), false, "旧 json 应已退休（不在原位置）");
    const trashDir = path.join(dir, ".trash");
    assert.equal(fs.existsSync(trashDir), true, "应进 .trash（可恢复）");
    assert.match(fs.readdirSync(trashDir).join(","), /download_task\.json/, ".trash 里应是原文件名");
    assert.equal(fs.existsSync(store.dbPathOf(jsonPath)), true, "应已建库");

    // 切库过程中状态不能丢
    const back = store.loadTask(jsonPath);
    assert.equal(back.items.length, 3, "切库后条数不变");
    assert.equal(back.status, "done");
    assert.equal(Object.keys(back.resultsMap).length, 3, "结果表也要完整");

    // 切过之后不再重复切（幂等）
    w.save(); w.flush();
    assert.equal(w.mode, "sqlite");
    assert.equal(fs.readdirSync(trashDir).length, 1, "不应重复退休");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "强制 backend=json 时不切库（现场排障逃生口）", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    fs.writeFileSync(jsonPath, JSON.stringify(makeTask(2, "done"), null, 2), "utf8");
    const w = store.createTaskWriter({
      filePath: jsonPath, ensureDir: () => {}, getTask: () => makeTask(2, "done"), throttleMs: 1, log: () => {}, backend: "json"
    });
    w.save(); w.flush();
    assert.equal(w.mode, "json", "显式 backend=json ⇒ 即使已下完也不切");
    assert.equal(fs.existsSync(jsonPath), true, "旧 json 保留");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "storageMode 如实报告：已下完时报 sqlite（并说明会自动切库）", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    fs.writeFileSync(jsonPath, JSON.stringify(makeTask(2, "done"), null, 2), "utf8");
    const sm = store.storageMode(jsonPath);
    assert.equal(sm.mode, "sqlite", "已下完 ⇒ 应报 sqlite");
    assert.match(sm.reason, /自动切库/, "原因里要说明会自动切库");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
