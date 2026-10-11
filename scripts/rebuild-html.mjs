#!/usr/bin/env node
// ============================================================
// scripts/rebuild-html.mjs —— 一次性重建 description.html（**手动调用**，不联网，限速，可断续）
//
// 用途：把「HTML 生成侧」的修复应用到**存量** HTML。当前主要是 A：
//   描述区里嵌的 GB 图片外链没本地化（同一张图已下载到本目录，网格区按本地名引用）——
//   断网或 GB 清理该图后描述区的图显示不出来。新下载/收尾重写的 HTML 已修好，存量需要重建。
//
// 设计约束（用户 2026-10-12 指定）：
//   · **独立脚本、手动调用**：不挂路由、不挂启动流程、不加任何自动调用 —— 只 `node scripts/rebuild-html.mjs <根>`
//   · **不联网**：全程只读本地（description.html + 目录里的文件），索引对象直接从现有 HTML 解析出来
//   · **限制性能**：`--limit`（本次最多处理多少目录）+ `--sleep`（每批之间停顿），单并发
//   · **断续**：`--state <文件>` 记录已处理目录，中断后 `--resume` 接着跑
//   · **安全**：先 `--dry-run` 只统计；写盘走原子写（tmp+rename）；**只碰 description.html**，不动用户文件
//
// 用法：
//   node scripts/rebuild-html.mjs "<根目录>" --dry-run --limit 5      # 小范围预演（推荐先跑）
//   node scripts/rebuild-html.mjs "<根目录>" --limit 200 --sleep 100  # 实跑一批
//   node scripts/rebuild-html.mjs "<根目录>" --resume                 # 续跑（跳过已处理）
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { readIndexObj } = require(path.join(ROOT, "server", "lib", "index-html.js"));
const { buildHtmlContent } = require(path.join(ROOT, "server", "lib", "downloader.js"));
const { writeFileAtomic } = require(path.join(ROOT, "server", "lib", "download-task-store.js"));

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const target = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--limit"
  && argv[argv.indexOf(a) - 1] !== "--sleep" && argv[argv.indexOf(a) - 1] !== "--state");
const DRY = flag("--dry-run");
const LIMIT = Number(opt("--limit", "200"));
const SLEEP = Number(opt("--sleep", "100"));
const STATE = path.resolve(opt("--state", path.join(ROOT, ".rebuild-html-state.json")));
const RESUME = flag("--resume");

if (!target) {
  console.error("用法: node scripts/rebuild-html.mjs <根目录> [--dry-run] [--limit N] [--sleep ms] [--state 文件] [--resume]");
  process.exit(2);
}
if (!fs.existsSync(target)) { console.error("根目录不存在: " + target); process.exit(2); }

// ---------- 进度（断续） ----------
let done = new Set();
if (RESUME && fs.existsSync(STATE)) {
  try { done = new Set(JSON.parse(fs.readFileSync(STATE, "utf8")).done || []); } catch (_) { done = new Set(); }
}
function saveState() {
  try { writeFileAtomic(STATE, JSON.stringify({ target, updatedAt: new Date().toISOString(), done: [...done] }, null, 2)); } catch (_) {}
}

// ---------- 遍历（收集 description.html，遇到 limit 即停） ----------
// ⚠️ 只跳过明确要排除的目录名 —— 不能「跳过所有以 . 开头的目录」：
//   本项目的 mod 目录正是 .角色 / .Mods 这类点开头目录（Xrd Rev 2 实测：跳点目录 ⇒ 处理 0 个）。
const SKIP_DIRS = new Set(["@eaDir", "#recycle", ".trash", ".git", "node_modules", "__MACOSX"]);
function collect(dir, out) {
  if (out.length >= LIMIT) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of entries) {
    if (out.length >= LIMIT) return;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collect(full, out);
    else if (ent.name === "description.html") out.push(dir);
  }
}

const dirs = [];
collect(path.resolve(target), dirs);

// ---------- 重建 ----------
let scanned = 0, unchanged = 0, wouldChange = 0, changed = 0, skipped = 0, failed = 0;
const samples = [];
for (const dir of dirs) {
  if (RESUME && done.has(dir)) continue;
  scanned += 1;
  const htmlPath = path.join(dir, "description.html");
  let obj = null;
  try { obj = readIndexObj(dir); } catch (_) { obj = null; }
  if (!obj) { skipped += 1; continue; }                 // 解析不出索引对象 → 跳过（不动它）
  let next = "";
  try { next = buildHtmlContent(obj, dir); } catch (_) { failed += 1; continue; }
  let cur = "";
  try { cur = fs.readFileSync(htmlPath, "utf8"); } catch (_) { failed += 1; continue; }
  if (next === cur) { unchanged += 1; done.add(dir); continue; }
  wouldChange += 1;
  if (samples.length < 5) samples.push(path.relative(target, dir));
  if (DRY) continue;                                     // 预演：只统计不写
  try {
    writeFileAtomic(htmlPath, next);                     // 原子写：tmp + rename
    changed += 1;
    done.add(dir);
  } catch (_) { failed += 1; }
  if (SLEEP > 0 && changed % 20 === 0) await new Promise((r) => setTimeout(r, SLEEP));
}
if (!DRY) saveState();

// ---------- 汇报 ----------
console.log(`[rebuild-html] ${DRY ? "DRY-RUN（未写盘）" : "已写盘"}  根: ${target}`);
console.log(`  本次处理目录 ${scanned}（上限 ${LIMIT}）｜解析失败跳过 ${skipped}｜异常 ${failed}`);
console.log(`  未变化 ${unchanged}｜需要重写 ${wouldChange}｜已写 ${changed}`);
if (samples.length) {
  console.log("  样例（相对根）:");
  for (const s of samples) console.log("    " + s);
}
console.log(`  进度文件: ${STATE}${DRY ? "（预演不写）" : ""}${RESUME ? "（--resume 已启用）" : ""}`);
