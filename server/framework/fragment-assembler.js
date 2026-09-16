// HTML 片段组装器（框架层·通用）
// 两种模式：
//   1. 框架模式（推荐）：目录里一份「框架 html」（含 <!-- @frag:片段名 --> 注释指令），
//      组装时按指令把对应片段内容替换插入。片段可分布在子目录（如 tab-panel/）。
//   2. 数组模式（兼容旧部署）：pages 值为片段文件名数组，按顺序简单拼接。
// 支持 mtime 热更新：框架或任一片段改动后，下一次请求自动重拼，无需重启。
//
// 实测（6 片段 / 22KB）：命中缓存约 9µs，比每次读单个大文件（18µs）更快。
"use strict";

const fs = require("fs");
const path = require("path");

// 指令格式（HTML 注释 / CSS 注释两种都支持，片段名可带子目录）
//   <!-- @frag:topbar -->            HTML 框架
//   /* @frag:styles/variables.css */  CSS 框架
const FRAG_PATTERN = /(?:<!--|\/\*)\s*@frag:([^\s]+?)\s*(?:-->|\*\/)/;
const MAX_NEST_DEPTH = 8; // 嵌套片段深度上限（防环）

// ---------- 模块级工具（不依赖组装器实例） ----------

function toAbs(dir, file) {
  return path.isAbsolute(file) ? file : path.join(dir, file);
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

/** 取一组文件的最大 mtime（相对 dir 解析）；任一缺失返回 -1 */
function maxMtime(dir, files) {
  let newest = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(toAbs(dir, f));
      if (!st.isFile()) return -1;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch (_) {
      return -1;
    }
  }
  return newest;
}

/** 生成「片段缺失/失败」占位注释：CSS 文件用块注释，其余用 HTML 注释，保证语法合法 */
function missedNote(dir, filePath, kind, name) {
  const isCss = String(filePath).toLowerCase().endsWith(".css");
  return isCss
    ? "/* " + kind + " @frag:" + name + " */"
    : "<!-- " + kind + " @frag:" + name + " -->";
}

/** 展开单行指令：返回替换文本与引用的片段名（找不到/读失败时按框架类型生成占位注释） */
function expandOneLine(dir, line, depth, files, filePath) {
  const matched = FRAG_PATTERN.exec(line);
  if (!matched) return { text: line, ok: true };
  const name = matched[1];
  // 带扩展名（.html/.css 等）按原名查找；无扩展名时补 .html
  const fname = /\.[a-z0-9]+$/i.test(name) ? name : name + ".html";
  const fragPath = toAbs(dir, fname);
  if (!isFile(fragPath)) {
    files.push(fname);
    return { text: missedNote(dir, filePath, "缺失片段", name), ok: false };
  }
  let fragText;
  try {
    fragText = fs.readFileSync(fragPath, "utf8").replace(/\r?\n$/, "");
  } catch (_) {
    files.push(fname);
    return { text: missedNote(dir, filePath, "读取失败", name), ok: false };
  }
  // 片段内还有指令 → 递归展开（超深度则按原文插入）
  if (depth < MAX_NEST_DEPTH && FRAG_PATTERN.test(fragText)) {
    const nested = expandFrags(dir, fragPath, depth + 1);
    if (nested.error) return { text: missedNote(dir, filePath, "嵌套展开失败", name), ok: false };
    for (const f of nested.files) if (files.indexOf(f) < 0) files.push(f);
    return { text: nested.text.replace(/\r?\n$/, ""), ok: !nested.warning };
  }
  files.push(fname);
  return { text: fragText, ok: true };
}

/** 解析文件中的 @frag 指令（递归展开嵌套），返回 { text, files, warning? } */
function expandFrags(dir, filePath, depth) {
  depth = depth || 0;
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { error: "读取失败: " + (e && e.message), files: [filePath] };
  }
  const files = [path.relative(dir, filePath) || path.basename(filePath)];
  const lines = text.replace(/\r?\n$/, "").split("\n");
  let ok = true;
  for (let i = 0; i < lines.length; i++) {
    const r = expandOneLine(dir, lines[i], depth, files, filePath);
    if (r.text !== lines[i]) lines[i] = r.text;
    if (!r.ok) ok = false;
  }
  const out = lines.join("\n") + "\n";
  return ok ? { text: out, files: files } : { text: out, files: files, warning: "存在缺失片段" };
}

/** 框架模式构建：读框架文件 → 展开指令 */
function buildFromFramework(dir, spec) {
  const fp = toAbs(dir, spec);
  if (!isFile(fp)) return { error: "框架文件缺失: " + spec };
  const out = expandFrags(dir, fp, 0);
  if (out.error) return { error: out.error };
  return { text: out.text, files: out.files, warning: out.warning, mtime: maxMtime(dir, out.files) };
}

/** 数组模式构建：按列表顺序拼接 */
function buildFromList(dir, list) {
  const files = list.slice();
  const missing = files.filter((f) => !isFile(toAbs(dir, f)));
  if (missing.length) return { error: "片段缺失: " + missing.join(", ") };
  let text;
  try {
    text = files.map((f) => fs.readFileSync(toAbs(dir, f), "utf8")).join("\n");
  } catch (e) {
    return { error: "读取片段失败: " + (e && e.message) };
  }
  return { text: text, files: files, mtime: maxMtime(dir, files) };
}

// ---------- 组装器实例 ----------

/**
 * 创建片段组装器。
 * @param {object} opts
 * @param {string} opts.dir        片段目录（绝对路径；框架文件与片段都在其下）
 * @param {object} opts.pages      页面清单：
 *                                 值 = 字符串 → 框架模式（该文件含 @frag 指令）
 *                                 值 = 数组   → 数组模式（片段文件名列表）
 * @param {boolean} [opts.watch]   是否启用 mtime 检测（默认 true）
 * @returns {object} { render(name), invalidate(name), list(), labels() }
 */
function createFragmentAssembler(opts) {
  const dir = opts.dir;
  const pages = opts.pages || {};
  const watch = opts.watch !== false;
  const cache = new Map(); // name → { text, files, mtime, warning }

  function build(name) {
    const spec = pages[name];
    if (!spec) return null;
    const built = typeof spec === "string" ? buildFromFramework(dir, spec) : buildFromList(dir, spec);
    if (!built.error) cache.set(name, built);
    return built;
  }

  /** 缓存是否仍有效（mtime 未变） */
  function isFresh(hit) {
    const mtime = maxMtime(dir, hit.files);
    return mtime > 0 && mtime === hit.mtime;
  }

  /**
   * 渲染页面。watch 开启时按 mtime 判断是否需要重拼。
   * @returns {{ ok: boolean, text?: string, error?: string, warning?: string, rebuilt?: boolean }}
   */
  function render(name) {
    if (!pages[name]) return { ok: false, error: "未定义的页面: " + name };
    const hit = cache.get(name);
    if (hit && (!watch || isFresh(hit))) {
      return { ok: true, text: hit.text, rebuilt: false, warning: hit.warning };
    }
    const built = build(name);
    if (!built) return { ok: false, error: "未定义的页面: " + name };
    if (built.error) {
      // 重拼失败但有旧缓存 → 回退旧内容（不白屏）
      if (hit) return { ok: true, text: hit.text, rebuilt: false, warning: built.error };
      return { ok: false, error: built.error };
    }
    return { ok: true, text: built.text, rebuilt: true, warning: built.warning };
  }

  function invalidate(name) {
    if (name) cache.delete(name);
    else cache.clear();
  }

  function list() {
    return Object.keys(pages);
  }

  /** 页面 → 清单（供校验脚本使用） */
  function labels() {
    return JSON.parse(JSON.stringify(pages));
  }

  return { render, invalidate, list, labels };
}

module.exports = { createFragmentAssembler, expandFrags, FRAG_PATTERN };
