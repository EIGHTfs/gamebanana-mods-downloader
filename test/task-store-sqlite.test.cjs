// test/task-store-sqlite.test.cjs —— 2026-10-15 新增（下载任务列表 SQLite 后端）
//
// 覆盖范围：**只针对下载任务列表的落盘**（json/download_task.json ↔ json/download_task.db）。
//   索引 json/index/、任务导出导入（/api/task/export|import）、前端 均不在本次范围内。
//
// 目的：
//   ① 等价性：同一份内存态经 JSON 后端与 SQLite 后端落盘后，读回来**逐字段相等**
//   ② 行级增量：只改一个 item，第二次落盘**只写 1 行**（这正是本次改造的收益来源）
//   ③ 双读：无 .db 时能读到旧 json（升级不丢队列）；有 .db 时以 .db 为准
//   ④ 回退：node:sqlite 不可用时，写入器 mode === "json"（走原有 JSON 路径）
//   ⑤ 清空：dropStore 连 -wal/-shm 侧车一起清掉
//
// 隔离：全部在 os.tmpdir() 下建临时目录，绝不碰项目真实 json/。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const log = makeLog("task-store-sqlite");

const store = require("../server/lib/download-task-store.js");

/** 建临时数据目录 */
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "task-store-"));
}

/** 一份有代表性的任务态（含 items / resultsMap / 标量字段） */
function makeTask(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      type: "file", url: "https://gamebanana.com/dl/" + (1800000 + i), path: "/x/y/" + i + ".zip",
      displayName: i + ".zip", gbMd5: "a".repeat(32), size: 1000000 + i, targetDir: "/x/y",
      modId: String(600000 + i), modName: "mod" + i, modUrl: "https://gamebanana.com/mods/" + (600000 + i),
      author: "a", game: "g", exists: true
    });
  }
  const resultsMap = {};
  for (let i = 0; i < n; i++) resultsMap[i] = { status: "done", percent: 100, size: 1000000 + i };
  return {
    status: "running", pendingMods: [], items, resultsMap, doneCount: n, currentIndex: 0,
    currentItem: null, activeItems: [], preparingItem: null, concurrency: 3, updatedAt: 1760000000000
  };
}

/** 用给定后端写一份任务，返回写入器 */
function writeOnce(jsonPath, task, opts) {
  const w = store.createTaskWriter(Object.assign({
    filePath: jsonPath,
    ensureDir: () => fs.mkdirSync(path.dirname(jsonPath), { recursive: true }),
    getTask: () => task,
    throttleMs: 1,
    log: () => {}
  }, opts || {}));
  w.save();
  w.flush();
  return w;
}

loggedTest(log, "等价性：同一内存态经 JSON 后端与 SQLite 后端落盘，读回来逐字段相等", () => {
  const dir = tmpDir();
  try {
    const task = makeTask(200);
    // 两条后端各自显式指定（backend 开关）—— 不依赖运行环境的 Node 版本，任何机器上结果一致
    const jsonPath = path.join(dir, "download_task.json");
    const wJson = writeOnce(jsonPath, task, { backend: "json" });
    assert.equal(wJson.mode, "json", "backend=json 时应是 JSON 后端");
    const fromJson = store.loadTask(jsonPath);

    // SQLite 后端
    const dir2 = tmpDir();
    const jsonPath2 = path.join(dir2, "download_task.json");
    const wSql = writeOnce(jsonPath2, task, { backend: "sqlite" });
    assert.equal(wSql.mode, "sqlite", "backend=sqlite 时应是 SQLite 后端");
    const fromSql = store.loadTask(jsonPath2);

    // 两边读回来必须逐字段相等（activeItems/preparingItem 已按 buildSnapshot 归一）
    assert.deepEqual(fromSql, fromJson, "SQLite 与 JSON 两条后端的落盘内容必须等价");
    assert.equal(fromSql.items.length, 200);
    assert.equal(Object.keys(fromSql.resultsMap).length, 200);
    assert.equal(fromSql.items[7].modName, "mod7");
    fs.rmSync(dir2, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "行级增量：只改一个 item，第二次落盘只写 1 行（收益来源）", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const task = makeTask(500);
    const w = writeOnce(jsonPath, task, { backend: "sqlite" });
    assert.ok(w.stats.rowsWritten >= 500, "首写应写满 items（含 meta/results），实际 " + w.stats.rowsWritten);
    const firstRows = w.stats.rowsWritten;

    // 只改一个 item 的一个字段（模拟某个文件下载完成）
    task.items[123].exists = false;
    w.save(); w.flush();
    const delta = w.stats.rowsWritten - firstRows;
    assert.equal(delta, 1, "只改一条 ⇒ 只应写 1 行，实际写了 " + delta + " 行");

    // 再改一个 resultsMap 条目 ⇒ 也只写 1 行
    const before = w.stats.rowsWritten;
    task.resultsMap[456] = { status: "failed", percent: 30, size: 1 };
    w.save(); w.flush();
    assert.equal(w.stats.rowsWritten - before, 1, "只改一条结果 ⇒ 只应写 1 行");

    // 内容确实生效
    const back = store.loadTask(jsonPath);
    assert.equal(back.items[123].exists, false);
    assert.equal(back.resultsMap[456].status, "failed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "读/写优先级：存在旧 json 时按 json（读写都是）；json 销毁后才用 .db", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const legacy = makeTask(3);
    fs.writeFileSync(jsonPath, JSON.stringify(legacy, null, 2), "utf8");

    // 只有 json：按 json 加载；auto 写入器也选 JSON（继续按旧格式落盘）
    const onlyJson = store.loadTask(jsonPath);
    assert.ok(onlyJson && onlyJson.items.length === 3, "只有 json 时按 json 加载");
    assert.equal(fs.existsSync(store.dbPathOf(jsonPath)), false, "此时不应凭空建库");
    const wAuto = store.createTaskWriter({
      filePath: jsonPath, ensureDir: () => {}, getTask: () => legacy, throttleMs: 1, log: () => {}
    });
    assert.equal(wAuto.mode, "json", "存在旧 json 时 auto 应选 JSON 后端");

    // 两者都在（例如之前切过库）：仍按 json —— 旧批没跑完之前以它为准
    writeOnce(jsonPath, makeTask(5), { backend: "sqlite" });
    assert.equal(fs.existsSync(store.dbPathOf(jsonPath)), true, "应已生成 .db");
    const both = store.loadTask(jsonPath);
    assert.equal(both.items.length, 3, "两者都在时按 json 加载（json 优先）");
    assert.equal(store.storageMode(jsonPath).mode, "json", "storageMode 也应如实报 json");

    // 模拟「那批跑完、列表销毁」：json 没了 ⇒ 读 .db
    fs.unlinkSync(jsonPath);
    const onlyDb = store.loadTask(jsonPath);
    assert.equal(onlyDb.items.length, 5, "json 销毁后应读 .db");
    assert.equal(store.storageMode(jsonPath).mode, "sqlite", "无 json 时应报 sqlite");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "回退：backend=json 时走原有 JSON 路径，不创建 .db（低版本 Node 的兜底）", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const w = writeOnce(jsonPath, makeTask(2), { backend: "json" });
    assert.equal(w.mode, "json");
    assert.equal(fs.existsSync(store.dbPathOf(jsonPath)), false, "回退路径不应创建 .db");
    assert.equal(fs.existsSync(jsonPath), true, "回退路径应写 JSON 文件");
    // storageMode 如实报告自动选择的结果（本机有 node:sqlite ⇒ sqlite；没有 ⇒ json）
    const sm = store.storageMode();
    assert.ok(sm.mode === "sqlite" || sm.mode === "json", "storageMode 必须给出明确模式");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "清空：dropStore 连 -wal/-shm 侧车与旧 json 一起清掉", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    fs.writeFileSync(jsonPath, JSON.stringify(makeTask(2)), "utf8");
    writeOnce(jsonPath, makeTask(2), { backend: "sqlite" });
    const dbPath = store.dbPathOf(jsonPath);
    assert.equal(fs.existsSync(dbPath), true);

    store.dropStore(jsonPath);
    assert.equal(fs.existsSync(dbPath), false, ".db 应被清掉");
    assert.equal(fs.existsSync(dbPath + "-wal"), false, "-wal 应被清掉");
    assert.equal(fs.existsSync(dbPath + "-shm"), false, "-shm 应被清掉");
    assert.equal(fs.existsSync(jsonPath), false, "旧 json 也应被清掉");
    assert.equal(store.loadTask(jsonPath), null, "清空后读不到任务");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "批量中只增不删：追加新项后已完成项全部保留（与旧 JSON 同行为）", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const task = makeTask(1000);
    const w = writeOnce(jsonPath, task, { backend: "sqlite" });
    const before = w.stats.rowsWritten;

    // 真实用法：一批还在跑时用户继续追加新 mod；**已完成的不从列表移除**
    for (let i = 1000; i < 1100; i++) {
      task.items.push({
        type: "file", url: "https://gamebanana.com/dl/" + i, path: "/x/" + i + ".zip",
        displayName: i + ".zip", gbMd5: "b".repeat(32), size: i, targetDir: "/x",
        modId: String(i), modName: "add" + i, modUrl: "https://gamebanana.com/mods/" + i,
        author: "b", game: "g", exists: false
      });
      task.resultsMap[i] = { status: "pending", percent: 0, size: i };
    }
    w.save(); w.flush();

    const back = store.loadTask(jsonPath);
    assert.equal(back.items.length, 1100, "追加后应是 1100 条");
    assert.equal(back.items[0].modName, "mod0", "已完成项必须仍在列表里（只增不删）");
    assert.equal(back.resultsMap[999].status, "done", "已完成的结果必须仍在");
    const delta = w.stats.rowsWritten - before;
    assert.ok(delta <= 220, "追加 100 条只应写约 200 行（100 item + 100 result），实际 " + delta);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

loggedTest(log, "空态：任务为 null 时落盘不抛错，读回为 null", () => {
  const dir = tmpDir();
  try {
    const jsonPath = path.join(dir, "download_task.json");
    const w = writeOnce(jsonPath, null);
    assert.ok(w.stats.writes >= 1, "空态也应完成一次写入（清表）");
    assert.equal(store.loadTask(jsonPath), null, "空态读回应为 null");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
