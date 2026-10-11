// ============================================================
// 下载任务落盘存储层（**任务专属**：快照净化 + 越界键清理）
//
// 通用底座（原子替换 + 合并写）已上提到模板：server/store/state-store.js
//   模板源 templates/js/store/state-store.js（assemble.json 下发），下游项目通用；
//   模板侧单测 bash test/state-store.test.sh（原子写/合并写/flush/cancel/pruned 计数）。
// 本文件只保留任务专属逻辑：
//   1. pruneStaleResults —— 清掉 resultsMap 里越界（下标 ≥ items.length）的陈旧键
//   2. buildSnapshot    —— 生成落盘快照（剥离运行时字段），与旧 saveTask 输出逐字段一致
//   3. createTaskWriter —— 在通用写入器外面包一层，注入上面的净化逻辑（对外 API 不变）
//
// 背景（2026-10-11 实测）：部署端 json/download_task.json 12.7→15.4 MB、saveTask 单次 ≈100–170ms，
//   却被 ~18 处调用（含每个文件的状态变化）⇒ 万级任务时主线程被同步写盘占满、页面卡顿；
//   且 writeFileSync 非原子，写一半崩溃会留下半个 JSON（任务列表损坏）。
//
// 不改数据结构、不改接口、不改文件格式：落盘内容与旧实现逐字段一致（仅少掉越界键）。
// ============================================================
"use strict";

const { writeFileAtomic, createThrottledWriter } = require("../store/state-store");
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

/**
 * 任务写入器 = 通用写入器（模板 server/store/state-store.js）+ 任务净化。
 * 对外 API 与旧实现完全一致：save() / flush() / cancel() / stats / _hasPending()
 *   · getState() 取当前 task；buildSnapshot 注入上面的净化（通用写入器会把 pruned 累加进 stats.prunedKeys）
 * @param {object} opts { filePath, ensureDir, getTask, throttleMs, log }
 */
function createTaskWriter(opts) {
  const o = opts || {};
  const w = createThrottledWriter({
    filePath: o.filePath,
    ensureDir: o.ensureDir,
    throttleMs: Number(o.throttleMs) > 0 ? Number(o.throttleMs) : 500,
    log: o.log,
    getState: () => (typeof o.getTask === "function" ? o.getTask() : null),
    buildSnapshot: (t) => buildSnapshot(t),
    // 2026-10-12：按**调用点**计数（meter 在模块加载时创建一次、站点固定；热路径零开销）
    onWrite: (bytes) => { try { taskWriteIo(bytes); } catch (_) {} }
  });
  return { save: w.save, flush: w.flush, cancel: w.cancel, stats: w.stats, _hasPending: w._hasPending };
}

module.exports = { pruneStaleResults, buildSnapshot, writeFileAtomic, createTaskWriter };

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
