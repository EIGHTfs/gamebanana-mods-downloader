// ============================================================
// 下载任务落盘存储层（**任务专属**：快照净化 + 越界键清理 + 后端选择）
//
// 通用底座（原子替换 + 合并写）已上提到模板：server/store/state-store.js
//   模板源 templates/js/store/state-store.js（assemble.json 下发），下游项目通用；
//   模板侧单测 bash test/state-store.test.sh（原子写/合并写/flush/cancel/pruned 计数）。
// 本文件只保留任务专属逻辑：
//   1. pruneStaleResults —— 清掉 resultsMap 里越界（下标 ≥ items.length）的陈旧键
//   2. buildSnapshot    —— 生成落盘快照（剥离运行时字段），与旧 saveTask 输出逐字段一致
//   3. createTaskWriter —— 在通用写入器外面包一层，注入上面的净化逻辑（对外 API 不变）
//   4. 后端选择（2026-10-15）—— 内置 node:sqlite 可用时走 SQLite 行级增量写，否则回落 JSON；
//      auto 模式下**自动切库**：旧 download_task.json 那批只要还有未完成项就继续用它，
//      一旦全部下完（且状态已安全落进库）就把它退休进 json/.trash 并切到 SQLite（见 createTaskWriter）
//
// 背景（2026-10-11 实测）：部署端 json/download_task.json 12.7→15.4 MB、saveTask 单次 ≈100–170ms，
//   却被 ~18 处调用（含每个文件的状态变化）⇒ 万级任务时主线程被同步写盘占满、页面卡顿；
//   且 writeFileSync 非原子，写一半崩溃会留下半个 JSON（任务列表损坏）。
// 补充（2026-10-15 实测）：峰值规模到过 3.6 万项 / 34.3MB；SQLite 侧单条 UPDATE 0.377ms、
//   DELETE 0.991ms，但**全量载入并不更快** ⇒ 收益来自「只写变化的行」，
//   见 server/lib/task-sqlite-store.js 的实现说明。
//
// 不改数据结构、不改接口、不改对外契约：两条后端产出的落盘内容与旧实现逐字段一致（仅少掉越界键）。
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const { writeFileAtomic, createThrottledWriter } = require("../store/state-store");
// 2026-10-15：SQLite 后端（Node 内置 node:sqlite；不可用时本模块自动回落 JSON 路径）
const taskSqlite = require("./task-sqlite-store");
// 2026-10-11：IO 归因（读/写点自报用量，见 lib/io-monitor.js）
const ioMonitor = require("./io-monitor");
// 2026-10-12：按**调用点**计数——meter 在模块加载时创建一次（站点固定，热路径零开销）
const taskWriteIo = ioMonitor.meter("task-write", "download-task-store.js:createTaskWriter/onWrite");

/**
 * 清掉 resultsMap 中越界（下标 <0 或 ≥ items.length）的陈旧键。
 * 依据：结果表按 item **下标**寻址（downloader.js 的 resultsMap[i]），越界键不可能映射到任何 item，
 *   只占体积（现场曾观测 12,896 键 > 12,782 条 = 114 个越界键）。
 * 注意：直接在传入对象上删除（内存与落盘同时变干净），返回删除数量供自检/统计。
 * @param {object} task
 * @returns {number} 删除的键数
 */
function pruneStaleResults(task) {
  if (!task || typeof task !== "object") return 0;
  const rm = task.resultsMap;
  if (!rm || typeof rm !== "object") return 0;
  const n = Array.isArray(task.items) ? task.items.length : 0;
  let removed = 0;
  for (const k of Object.keys(rm)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      delete rm[k];
      removed++;
    }
  }
  return removed;
}

/**
 * 生成落盘快照（与旧 saveTask 的输出保持逐字段一致）。
 *   · 剥离 activeItems 里的运行时字段 _spT / _spLast（速度采样，无需持久化）
 *   · preparingItem 只留 { name, type: "preparing" }
 *   · 调用前会先 pruneStaleResults（越界键在内存里一并清掉）
 * @param {object|null} task
 * @returns {{ snapshot: object|null, pruned: number }}
 */
function buildSnapshot(task) {
  if (!task) return { snapshot: null, pruned: 0 };
  const pruned = pruneStaleResults(task);
  const snapshot = {
    ...task,
    activeItems: (task.activeItems || []).map((a) => ({ ...a, _spT: undefined, _spLast: undefined })),
    preparingItem: task.preparingItem ? { name: task.preparingItem.name, type: "preparing" } : null
  };
  return { snapshot, pruned };
}

/** 由任务 JSON 路径推出 SQLite 库路径（同一目录、同名前缀） */
function dbPathOf(jsonPath) {
  return String(jsonPath || "").replace(/\.json$/, "") + ".db";
}

/**
 * 任务写入器 = 后端（SQLite 优先 / JSON 回落）+ 任务净化。
 * 对外 API 与旧实现完全一致：save() / flush() / cancel() / stats / _hasPending()
 *   · getState() 取当前 task；buildSnapshot 注入上面的净化
 *   · 额外暴露 mode（sqlite / json）供启动日志说明实际生效的后端
 * @param {object} opts { filePath, ensureDir, getTask, throttleMs, log }
 */
/** 旧 JSON 那批是否还有没下完的：running/preparing，或仍有 item 没拿到结果 */
function jsonHasUnfinishedWork(d) {
  if (!d || typeof d !== "object") return false;
  if (d.status === "running" || d.status === "preparing") return true;
  const items = Array.isArray(d.items) ? d.items : [];
  const rm = (d.resultsMap && typeof d.resultsMap === "object") ? d.resultsMap : {};
  for (let i = 0; i < items.length; i++) if (rm[i] === undefined) return true;
  return false;
}

/**
 * 旧 JSON 退休：移入同目录 .trash（可恢复）。
 *   ⚠ 只在「当前状态已经完整落进 SQLite 库」之后才调用 —— 否则退休等于丢队列。
 */
function retireJson(jsonPath, log) {
  try {
    const trash = path.join(path.dirname(jsonPath), ".trash");
    fs.mkdirSync(trash, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(trash, stamp + "-" + path.basename(jsonPath));
    fs.renameSync(jsonPath, dest);
    if (typeof log === "function") log("[task-store] 旧 JSON 已退休（可恢复）：" + dest);
    return dest;
  } catch (e) {
    if (typeof log === "function") log("[task-store] 旧 JSON 退休失败：" + ((e && e.message) || e));
    return null;
  }
}

/**
 * 创建任务写入器（对外 API 不变：save / flush / cancel / stats / _hasPending / mode）。
 *
 * 后端选择（auto 模式）：
 *   · 内置 node:sqlite 不可用（低版本 Node）⇒ 一律走原有 JSON 路径
 *   · 没有旧 download_task.json ⇒ 直接走 SQLite
 *   · 有旧 json 且那批**还有未完成项** ⇒ 继续用 JSON（不打断正在跑的批次）
 *   · 有旧 json 但那批**已全部下完** ⇒ **自动切库**：先把当前状态完整写进 SQLite，
 *     确认无错后才把旧 json 退休进 .trash，然后改用 SQLite
 *   切换在每次 save/flush 时**惰性判定** ⇒ 不需要重启，也不需要迁移脚本。
 */
function createTaskWriter(opts) {
  const o = opts || {};
  const jsonPath = o.filePath;
  const dbPath = dbPathOf(jsonPath);
  const want = String(o.backend || "auto");
  const log = typeof o.log === "function" ? o.log : () => {};
  const common = {
    ensureDir: o.ensureDir,
    getState: () => (typeof o.getTask === "function" ? o.getTask() : null),
    buildSnapshot: (t) => buildSnapshot(t),
    throttleMs: o.throttleMs,
    log: o.log
  };

  function makeJsonWriter() {
    // 回落：环境没有内置 node:sqlite 时完全走原有 JSON 路径。
    //   ⚠ filePath 必须是旧 JSON 路径 —— 曾误传 dbPath，导致回退时把 JSON 写进了 .db 文件。
    const w = createThrottledWriter(Object.assign({}, common, {
      filePath: jsonPath,
      onWrite: (bytes) => { try { taskWriteIo(bytes); } catch (_) {} }
    }));
    return { save: w.save, flush: w.flush, cancel: w.cancel, stats: w.stats, _hasPending: w._hasPending, mode: "json" };
  }

  function makeSqliteWriter() {
    // 行级增量写：只序列化并 UPSERT 变化的行（详见 task-sqlite-store.js）
    const w = taskSqlite.createSqliteTaskWriter(Object.assign({}, common, {
      filePath: dbPath,
      jsonPath: jsonPath,
      onWrite: (rows) => { try { taskWriteIo(rows); } catch (_) {} }
    }));
    return { save: w.save, flush: w.flush, cancel: w.cancel, stats: w.stats, _hasPending: w._hasPending, mode: "sqlite", close: w.close };
  }

  const jsonExists = !!(jsonPath && fs.existsSync(jsonPath));
  const useSqlite = want === "sqlite" || (want === "auto" && !jsonExists && taskSqlite.isAvailable());
  let active = useSqlite ? makeSqliteWriter() : makeJsonWriter();
  let switched = false;

  /** 惰性判定是否该自动切库（每次 save/flush 调一次；条件不满足时几乎零成本） */
  function maybeAutoSwitch() {
    if (switched || want !== "auto" || active.mode !== "json") return;
    if (!taskSqlite.isAvailable()) return;
    if (!jsonPath || !fs.existsSync(jsonPath)) return;
    // 状态还没恢复出来时不能切：此刻落库会把空状态写进去（等于清空队列）
    if (!common.getState()) return;
    let legacy = null;
    try { legacy = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch (_) { return; }
    if (jsonHasUnfinishedWork(legacy)) return;   // 那批还没下完 ⇒ 继续用 JSON
    const next = makeSqliteWriter();
    next.save(); next.flush();                   // 先把当前状态完整写进库
    if (next.stats.errors > 0) {                 // 落库失败（写入器会自己回落 JSON）⇒ 不退休旧文件
      log("[task-store] 自动切库未成功（旧 JSON 保留）：见上一条日志");
      return;
    }
    retireJson(jsonPath, log);
    active = next;
    switched = true;
    log("[task-store] 旧 JSON 那批已下完 ⇒ 已自动切到 SQLite");
  }

  return {
    save: () => { maybeAutoSwitch(); active.save(); },
    flush: () => { maybeAutoSwitch(); return active.flush(); },
    cancel: () => active.cancel(),
    _hasPending: () => active._hasPending(),
    get stats() { return active.stats; },
    get mode() { return active.mode; },
    close: () => { try { if (active.close) active.close(); } catch (_) {} }
  };
}

/**
 * 读取任务（旧 JSON 优先；json 不在时读 SQLite 库）。
 *   为什么 json 优先：json 一旦退休（自动切库时进 .trash）就只剩库了，所以「json 还在」意味着
 *   它才是最权威的一份；若先读库，会在自动切库完成之前读到旧快照。
 * @param {string} jsonPath 旧任务 JSON 路径
 * @returns {object|null}
 */
function loadTask(jsonPath) {
  return taskSqlite.loadTask(dbPathOf(jsonPath), jsonPath);
}

/** 清空任务存储：SQLite 库（含 -wal/-shm 侧车）+ 旧 JSON */
function dropStore(jsonPath) {
  return taskSqlite.dropStore(dbPathOf(jsonPath), jsonPath);
}

/** 存储后端探测结果（启动日志用）：{ mode: "sqlite"|"json", reason } */
function storageMode(jsonPath) {
  const p = taskSqlite.probe();
  if (jsonPath && fs.existsSync(jsonPath)) {
    let legacy = null;
    try { legacy = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch (_) { legacy = null; }
    if (legacy && p.ok && !jsonHasUnfinishedWork(legacy)) {
      return { mode: "sqlite", reason: "旧 JSON 那批已下完 ⇒ 本次落盘会自动切库并把旧 JSON 退休进 .trash" };
    }
    return { mode: "json", reason: "旧 download_task.json 那批还有未完成项（下完后自动切库）" };
  }
  return p.ok ? { mode: "sqlite", reason: "" } : { mode: "json", reason: p.reason || "" };
}

module.exports = {
  pruneStaleResults,
  buildSnapshot,
  writeFileAtomic,
  createTaskWriter,
  loadTask,
  dropStore,
  storageMode,
  dbPathOf
};

// ── 旧实现（2026-10-11 之前本文件自带的原子写与写入器，已上提到模板 server/store/state-store.js）──
//   保留备查，勿删：
// function writeFileAtomic(filePath, text) {
//   const tmp = filePath + ".tmp-" + process.pid;
//   fs.writeFileSync(tmp, text, "utf8");
//   try { fs.renameSync(tmp, filePath); }
//   catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
// }
// function createTaskWriter(opts) {
//   const { filePath, ensureDir, getTask } = opts || {};
//   const throttleMs = Number(opts && opts.throttleMs) > 0 ? Number(opts.throttleMs) : 500;
//   const log = (opts && opts.log) || (() => {});
//   const stats = { saves: 0, writes: 0, coalesced: 0, errors: 0, prunedKeys: 0 };
//   let timer = null; let dirty = false;
//   function doWrite() { const { snapshot, pruned } = buildSnapshot(getTask()); if (pruned) stats.prunedKeys += pruned;
//     if (typeof ensureDir === "function") ensureDir(); writeFileAtomic(filePath, JSON.stringify(snapshot, null, 2)); stats.writes++; }
//   function flush() { if (timer) { clearTimeout(timer); timer = null; } if (!dirty) return false; dirty = false;
//     try { doWrite(); return true; } catch (e) { stats.errors++; log("[task-store] 落盘失败：" + (e && e.message)); return false; } }
//   function save() { stats.saves++; dirty = true; if (timer) { stats.coalesced++; return; }
//     timer = setTimeout(() => { timer = null; flush(); }, throttleMs); if (timer.unref) timer.unref(); }
//   function cancel() { if (timer) { clearTimeout(timer); timer = null; } dirty = false; }
//   return { save, flush, cancel, stats, _hasPending: () => dirty };
// }
