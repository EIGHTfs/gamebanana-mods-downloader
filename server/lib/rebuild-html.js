// ============================================================
// lib/rebuild-html.js —— 重建 description.html（**库实现**，供两处共用）
//
//   ① scripts/rebuild-html.mjs        —— 独立 CLI（手动调用、不联网、限速、可断续）
//   ② POST /api/hash-rebuild 的 html/md5 选项 —— 接在现有「重建索引」入口上
//
// 只读本地、不联网：索引对象用 readIndexObj 从现有 HTML 解析出来。
//
// 两个可选项（**都默认关**）：
//   · html —— 重写 HTML（把描述区里的 GB 图片外链换成本地文件名等生成侧修复应用到存量）
//             实测 ≈6.5ms/目录（16k 个目录 ≈1 分 45 秒），轻活，可常开
//   · md5  —— 补算图片**内容 md5** 写回索引（第三层冗余键）
//             ⚠️ 重活：要逐个读图片内容，实测收尾读盘 ≈7–8MB/s，曾把 /api/task 拖到无响应
//             ⇒ 默认关，勾了才跑；跑时务必限速 + 可中断（本模块按 limit/sleep 限负载）
//
// 安全：只重写 description.html（writeFileAtomic 原子写）；不删不改用户文件。
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { readIndexObj } = require("./index-html");
const { writeFileAtomic } = require("../store/state-store");

// ⚠️ downloader **必须懒加载**：存在 hash-index → rebuild-html → downloader → hash-index 的循环依赖，
//   顶层 require 时 downloader 还没初始化完，会拿到未完成的导出（实测报
//   "Accessing non-existent property 'rebuildFromObj' of module exports inside circular dependency"）。
let _buildHtmlContent = null;
function buildHtml(obj, dir) {
  if (!_buildHtmlContent) _buildHtmlContent = require("./downloader").buildHtmlContent;
  return _buildHtmlContent(obj, dir);
}

// 只排除明确不要的目录名 —— 不能「跳过所有以 . 开头的目录」：
//   本项目 mod 目录正是 .角色 / .Mods 这类点开头目录（Xrd Rev 2 实测：跳点目录 ⇒ 处理 0 个）
const SKIP_DIRS = new Set(["@eaDir", "#recycle", ".trash", ".git", "node_modules", "__MACOSX"]);

/** 递归收集含 description.html 的目录（最多 limit 个；limit<=0 表示不限） */
function collectDirs(root, limit, out) {
  const acc = out || [];
  const cap = limit > 0 ? limit : Infinity;
  (function walk(dir) {
    if (acc.length >= cap) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const ent of entries) {
      if (acc.length >= cap) return;
      if (SKIP_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === "description.html") acc.push(dir);
    }
  })(path.resolve(root));
  return acc;
}

/** 同步算文件内容 md5（仅 md5 选项开启时才调用；失败返回 null） */
function fileMd5Sync(file) {
  try {
    return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
  } catch (_) {
    return null;
  }
}

/**
 * 给**已解析**的索引对象补算图片内容 md5（默认不调用；重活：逐个读图片内容）。
 * @returns {number} 实际补算条数
 */
function fillImageMd5(obj, dir) {
  let n = 0;
  for (const im of (obj && obj.images) || []) {
    if (!im || im.hash) continue;
    const name = im.file || im.gbFile || "";
    if (!name) continue;
    const abs = path.join(dir, name);
    if (!fs.existsSync(abs)) continue;
    const h = fileMd5Sync(abs);
    if (!h) continue;
    im.hash = h;
    n += 1;
  }
  return n;
}

/**
 * 对**已解析**的索引对象做重建（供 hash-index 的遍历复用：那边已经 readIndexObj 过了，
 * 直接用它就能省掉「二次遍历 + 二次解析」）。
 * @returns {{status:"same"|"changed"|"failed", md5Filled:number, error?:string, dryRun?:boolean}}
 */
function rebuildFromObj(obj, dir, opts) {
  const o = opts || {};
  const htmlPath = path.join(dir, "description.html");
  const md5Filled = o.md5 ? fillImageMd5(obj, dir) : 0;
  let next = "";
  try {
    next = buildHtml(obj, dir);   // 懒加载的 downloader.buildHtmlContent
  } catch (e) {
    return { status: "failed", md5Filled, error: String((e && e.message) || e) };
  }
  let cur = "";
  try {
    cur = fs.readFileSync(htmlPath, "utf8");
  } catch (e) {
    return { status: "failed", md5Filled, error: String((e && e.message) || e) };
  }
  if (next === cur) return { status: "same", md5Filled };
  if (o.dryRun) return { status: "changed", md5Filled, dryRun: true };
  try {
    writeFileAtomic(htmlPath, next);   // 原子写：tmp + rename
    return { status: "changed", md5Filled };
  } catch (e) {
    return { status: "failed", md5Filled, error: String((e && e.message) || e) };
  }
}

/**
 * 重建单个 mod 目录的 description.html（CLI 路径：自己读索引对象）。
 * @returns {{status:"same"|"changed"|"skipped"|"failed", md5Filled:number, error?:string}}
 */
function rebuildOne(dir, opts) {
  let obj = null;
  try {
    obj = readIndexObj(dir);
  } catch (_) {
    obj = null;
  }
  if (!obj) return { status: "skipped", md5Filled: 0, error: "解析不出索引对象" };
  return rebuildFromObj(obj, dir, opts);
}

/** 读进度文件（断续用）；不存在/损坏 → 空集合 */
function loadDone(stateFile) {
  if (!stateFile || !fs.existsSync(stateFile)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(stateFile, "utf8")).done || []);
  } catch (_) {
    return new Set();
  }
}

/** 写进度文件（原子写；失败不影响主流程） */
function saveDone(stateFile, done, extra) {
  if (!stateFile) return;
  try {
    writeFileAtomic(stateFile, JSON.stringify({
      ...(extra || {}),
      updatedAt: new Date().toISOString(),
      done: [...done],
    }, null, 2));
  } catch (_) {
    /* 进度写不进去不影响主流程 */
  }
}

/**
 * 批量重建。
 * @param {object} opts
 *   roots      {string[]|string} 根目录（可多个）
 *   html       {boolean} 是否重写 HTML（默认 false —— 只算 md5 时可单独开 md5）
 *   md5        {boolean} 是否补算图片内容 md5（默认 false）
 *   dryRun     {boolean} 只统计不写盘（默认 false）
 *   limit      {number}  本次最多处理多少目录（0=不限，默认 200）
 *   sleep      {number}  每处理 sleepEvery 个目录停顿多少 ms（默认 0）
 *   sleepEvery {number}  停顿间隔（默认 20）
 *   stateFile  {string}  进度文件（用于断续）
 *   resume     {boolean} 跳过进度文件里已处理的目录
 *   onProgress {function} 进度回调 ({scanned, changed, ...})
 * @returns {Promise<object>} 汇总
 */
async function rebuildHtmls(opts) {
  const o = opts || {};
  const roots = (Array.isArray(o.roots) ? o.roots : [o.roots]).filter(Boolean).map((r) => path.resolve(r));
  const limit = o.limit === undefined ? 200 : Number(o.limit);
  const sleep = Number(o.sleep || 0);
  const sleepEvery = Number(o.sleepEvery || 20);
  const stateFile = o.stateFile ? path.resolve(o.stateFile) : "";

  // 进度（断续）
  let done = new Set();
  if (o.resume && stateFile && fs.existsSync(stateFile)) {
    try {
      done = new Set(JSON.parse(fs.readFileSync(stateFile, "utf8")).done || []);
    } catch (_) {
      done = new Set();
    }
  }
  const saveState = () => {
    if (!stateFile) return;
    try {
      writeFileAtomic(stateFile, JSON.stringify({ updatedAt: new Date().toISOString(), done: [...done] }, null, 2));
    } catch (_) {
      /* 进度写不进去不影响主流程 */
    }
  };

  const dirs = [];
  for (const r of roots) collectDirs(r, limit > 0 ? limit - dirs.length : 0, dirs);

  const sum = { roots: roots.length, scanned: 0, same: 0, changed: 0, skipped: 0, failed: 0, md5Filled: 0, dryRun: !!o.dryRun };
  for (const dir of dirs) {
    if (o.resume && done.has(dir)) continue;
    sum.scanned += 1;
    const r = rebuildOne(dir, { md5: o.md5, dryRun: o.dryRun });
    if (r.status === "same") { sum.same += 1; done.add(dir); }
    else if (r.status === "changed") { sum.changed += 1; done.add(dir); }
    else if (r.status === "skipped") sum.skipped += 1;
    else sum.failed += 1;
    sum.md5Filled += r.md5Filled || 0;
    if (typeof o.onProgress === "function") o.onProgress(sum, dir);
    if (sleep > 0 && sum.scanned % sleepEvery === 0) await new Promise((res) => setTimeout(res, sleep));
  }
  if (!o.dryRun) saveState();
  return sum;
}

module.exports = { SKIP_DIRS, collectDirs, fileMd5Sync, fillImageMd5, rebuildFromObj, rebuildOne, rebuildHtmls, loadDone, saveDone };
