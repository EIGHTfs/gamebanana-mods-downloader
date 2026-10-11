#!/usr/bin/env node
// ============================================================
// scripts/rebuild-html.mjs —— 一次性重建 description.html（**手动调用的薄壳**）
//
// 实现全部在 server/lib/rebuild-html.js（与「重建索引」接口共用同一份，避免两套逻辑）。
// 本文件只做：参数解析 → 调用库 → 打印汇报。
//
// 设计约束（用户 2026-10-12 指定）：
//   · **独立脚本、手动调用**：不挂路由、不挂启动流程、不加任何自动调用
//   · **不联网**：只读本地（description.html + 目录里的文件）
//   · **限制性能**：--limit（本次最多处理多少目录）+ --sleep（每批停顿）
//   · **断续**：--state <文件> 记进度 + --resume 续跑
//   · **安全**：--dry-run 只统计不写；写盘原子写；只碰 description.html
//
// 用法：
//   node scripts/rebuild-html.mjs "<根>" --dry-run --limit 5          # 小范围预演
//   node scripts/rebuild-html.mjs "<根>" --limit 200 --sleep 100      # 实跑一批
//   node scripts/rebuild-html.mjs "<根>" --resume                     # 续跑
//   node scripts/rebuild-html.mjs "<根>" --md5                        # 顺带补算图片内容 md5（重活！）
// ============================================================
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { rebuildHtmls } = require(path.join(ROOT, "server", "lib", "rebuild-html.js"));

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
// 第一个非「选项值」的位置参数即根目录
const VALUE_FLAGS = new Set(["--limit", "--sleep", "--state", "--sleep-every"]);
let target = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUE_FLAGS.has(argv[i])) i += 1;
    continue;
  }
  target = argv[i];
  break;
}

if (!target) {
  console.error("用法: node scripts/rebuild-html.mjs <根目录> [--dry-run] [--limit N] [--sleep ms] [--state 文件] [--resume] [--md5]");
  process.exit(2);
}

const DRY = flag("--dry-run");
const STATE = path.resolve(opt("--state", path.join(ROOT, ".rebuild-html-state.json")));
const sum = await rebuildHtmls({
  roots: target,
  limit: Number(opt("--limit", "200")),
  sleep: Number(opt("--sleep", "100")),
  sleepEvery: Number(opt("--sleep-every", "20")),
  dryRun: DRY,
  md5: flag("--md5"),
  stateFile: STATE,
  resume: flag("--resume"),
});

console.log(`[rebuild-html] ${DRY ? "DRY-RUN（未写盘）" : "已写盘"}  根: ${target}`);
console.log(`  本次处理目录 ${sum.scanned}｜解析失败跳过 ${sum.skipped}｜异常 ${sum.failed}`);
console.log(`  未变化 ${sum.same}｜需要重写 ${sum.changed}｜补算 md5 ${sum.md5Filled}`);
console.log(`  进度文件: ${STATE}${DRY ? "（预演不写）" : ""}${flag("--resume") ? "（--resume 已启用）" : ""}`);
