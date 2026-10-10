// ============================================================
// 下载任务落盘存储层（纯函数 + 可注入写入器，便于单测）
//
// 为什么单独成文件（2026-10-11 实测驱动）：
//   部署端 json/download_task.json 实测 12.7 MB（items 12,782 条 / resultsMap 12,896 键），
//   而 saveTask() 每次都是「JSON.stringify(全量, null, 2) + writeFileSync 覆写整文件」——
//   实测 stringify 80ms + 写盘 21ms ≈ 100ms，却被 ~18 处调用（含每个文件的状态变化）。
//   万级任务时主线程被同步写盘占满、页面卡顿；且非原子写一旦中断就留下半个 JSON（任务列表损坏）。
//
// 本模块只做四件事，全部与业务解耦、可单测：
//   1. pruneStaleResults —— 清掉 resultsMap 里越界（下标 ≥ items.length）的陈旧键
//   2. buildSnapshot    —— 生成落盘快照（剥离运行时字段），与旧 saveTask 输出保持一致
//   3. writeFileAtomic  —— 临时文件 + rename 原子替换（崩溃/断电不会留半个文件）
//   4. createTaskWriter —— 脏标记 + 合并写（默认 500ms 一次），关键节点可 flush() 立即落盘
//
// 不改数据结构、不改接口、不改文件格式：落盘内容与旧实现逐字段一致（仅少掉越界键）。
// ============================================================
"use strict";

const fs = require("fs");

/**
 * 清掉 resultsMap 中越界（下标 <0 或 ≥ items.length）的陈旧键。
 * 依据：结果表按 item **下标**寻址（downloader.js 的 resultsMap[i]），越界键不可能映射到任何 item，
 *   只占体积（现场实测 12,896 键 > 12,782 条 = 114 个越界键）。
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

/**
 * 原子写文件：先写同目录临时文件，再 rename 覆盖目标（同目录 rename 是原子操作）。
 * 好处：任何时刻目标文件要么是旧的完整内容、要么是新的完整内容，不会出现半个 JSON。
 * @param {string} filePath 目标路径
 * @param {string} text 内容
 */
function writeFileAtomic(filePath, text) {
  const tmp = filePath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, text, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // rename 失败（极端情况）→ 清理临时文件后再抛，避免残留
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

/**
 * 创建节流合并写入器。
 *   save()  —— 置脏并排程（throttleMs 内多次调用只落一次盘）；调用方语义与旧 saveTask 相同（不阻塞）
 *   flush() —— 立即落盘（关键节点：批次开始/终止/暂停/恢复/进程退出）
 * 定时器 unref()，不会阻止进程退出。
 * @param {object} opts
 * @param {string} opts.filePath 目标文件
 * @param {() => void} [opts.ensureDir] 落盘前确保目录存在
 * @param {() => (object|null)} opts.getTask 取当前任务对象
 * @param {number} [opts.throttleMs=500]
 * @param {(msg:string)=>void} [opts.log]
 */
function createTaskWriter(opts) {
  const { filePath, ensureDir, getTask } = opts || {};
  const throttleMs = Number(opts && opts.throttleMs) > 0 ? Number(opts.throttleMs) : 500;
  const log = (opts && opts.log) || (() => {});
  const stats = { saves: 0, writes: 0, coalesced: 0, errors: 0, prunedKeys: 0 };
  let timer = null;
  let dirty = false;

  function doWrite() {
    const { snapshot, pruned } = buildSnapshot(getTask());
    if (pruned) stats.prunedKeys += pruned;
    if (typeof ensureDir === "function") ensureDir();
    writeFileAtomic(filePath, JSON.stringify(snapshot, null, 2));
    stats.writes++;
  }

  /** 立即落盘（无脏数据则什么都不做） */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return false;
    dirty = false;
    try { doWrite(); return true; } catch (e) {
      stats.errors++;
      log("[task-store] 落盘失败：" + (e && e.message));
      return false;
    }
  }

  /** 标记脏 + 排程合并写（同一窗口内多次调用只落一次盘） */
  function save() {
    stats.saves++;
    dirty = true;
    if (timer) { stats.coalesced++; return; }
    timer = setTimeout(() => { timer = null; flush(); }, throttleMs);
    if (timer.unref) timer.unref();
  }

  /**
   * 取消未落盘的排程（用于「终止任务并删除任务文件」这类场景）：
   *   否则节流窗口内残留的写盘会把刚删掉的任务文件又写回来（任务复活）。
   */
  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
    dirty = false;
  }

  return { save, flush, cancel, stats, _hasPending: () => dirty };
}

module.exports = { pruneStaleResults, buildSnapshot, writeFileAtomic, createTaskWriter };
