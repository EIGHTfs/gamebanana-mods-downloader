#!/usr/bin/env node
// ============================================================
// scripts/fix-index-escaped-names.mjs —— 一次性修复「GB 转义名」产生的索引文件名
//
// 背景（2026-10-12）：GameBanana 早期返回的游戏名里带 Java 风格转义，例如
//   Arknights#Uff1aEndfield      （#Uff1a 就是 \uFF1A = 全角冒号「：」）
//   后来 GB 改回正常名字（Arknights: Endfield），经 mapping.sanitizeName 变成
//   Arknights：Endfield —— 于是 json/index/ 下**两个文件并存**（同一批数据被读两份）。
//
// 本脚本：把带 #UXXXX 的旧文件**合并进**正确文件（按 sanitizeName 后的名字），
//   合并规则：逐键合并；**键冲突时保留正确文件的值**（它更新、更权威），冲突明细打印出来。
//   合并后旧文件移进同目录 .trash/（可恢复，符合「删除必须可恢复」纪律），不直接删除。
//
// 用法（默认 dry-run，什么都不写）：
//   node scripts/fix-index-escaped-names.mjs            # 预演：只报「哪些文件要合并、多少条、几处冲突」
//   node scripts/fix-index-escaped-names.mjs --apply    # 真做：合并 + 旧文件移进 .trash/
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { sanitizeName } = require(path.join(ROOT, "server", "lib", "mapping.js"));
const { writeFileAtomic } = require(path.join(ROOT, "server", "lib", "download-task-store.js"));

const INDEX_DIR = path.join(ROOT, "json", "index");
const APPLY = process.argv.includes("--apply");
const ESC_RE = /#U([0-9a-fA-F]{4})/g;

/** 把 #UXXXX 还原成真实字符（#Uff1a → ：） */
function unescapeName(s) {
  return String(s).replace(ESC_RE, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** 逐键合并：base 为准，extra 只补 base 没有的键；冲突计入 conflicts */
function mergeMaps(base, extra) {
  const out = { ...(base || {}) };
  const conflicts = [];
  for (const [k, v] of Object.entries(extra || {})) {
    if (!(k in out)) out[k] = v;
    else if (JSON.stringify(out[k]) !== JSON.stringify(v)) conflicts.push(k);
  }
  return { out, conflicts };
}

function countOf(obj) {
  return ["gb", "local", "name"].reduce((n, k) => n + Object.keys((obj && obj[k]) || {}).length, 0);
}

if (!fs.existsSync(INDEX_DIR)) {
  console.log("找不到 json/index 目录: " + INDEX_DIR);
  process.exit(2);
}

const files = fs.readdirSync(INDEX_DIR).filter((f) => f.endsWith(".json"));
const targets = files.filter((f) => ESC_RE.test(f));
ESC_RE.lastIndex = 0;   // 正则带 g，test 后要复位

if (!targets.length) {
  console.log("[fix-index] json/index 下没有带 #UXXXX 的文件，无需处理 ✓");
  process.exit(0);
}

console.log(`[fix-index] ${APPLY ? "APPLY（会写盘）" : "DRY-RUN（不写盘）"}  目录: ${INDEX_DIR}`);
let merged = 0, renamed = 0, moved = 0, totalConflicts = 0;
for (const f of targets) {
  const srcPath = path.join(INDEX_DIR, f);
  const stem = f.replace(/\.json$/, "");
  const decoded = unescapeName(stem);
  const goodName = sanitizeName(decoded) + ".json";
  const goodPath = path.join(INDEX_DIR, goodName);
  const srcObj = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const srcCount = countOf(srcObj);
  if (goodPath === srcPath) {
    console.log(`  ⚠ ${f} → sanitize 后仍是自己（映射表未覆盖该转义），跳过`);
    continue;
  }
  const exists = fs.existsSync(goodPath);
  if (!exists) {
    console.log(`  · 改名：${f} → ${goodName}（${srcCount} 条；目标不存在，无需合并）`);
    if (APPLY) { fs.renameSync(srcPath, goodPath); renamed += 1; }
    continue;
  }
  const goodObj = JSON.parse(fs.readFileSync(goodPath, "utf8"));
  const goodCount = countOf(goodObj);
  let conflicts = [];
  const out = { ...goodObj };
  for (const key of ["gb", "local", "name"]) {
    const r = mergeMaps(goodObj[key], srcObj[key]);
    out[key] = r.out;
    conflicts = conflicts.concat(r.conflicts.map((c) => `${key}:${c}`));
  }
  const outCount = countOf(out);
  console.log(`  · 合并：${f}（${srcCount} 条）→ ${goodName}（${goodCount} 条）`);
  console.log(`      合并后 ${outCount} 条；键冲突 ${conflicts.length} 处（保留正确文件的值）${conflicts.length ? "：" + conflicts.slice(0, 5).join(", ") : ""}`);
  totalConflicts += conflicts.length;
  if (APPLY) {
    writeFileAtomic(goodPath, JSON.stringify(out, null, 2));
    const trash = path.join(INDEX_DIR, ".trash");
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(srcPath, path.join(trash, `${Date.now()}-${f}`));
    moved += 1;
    merged += 1;
  }
}
console.log(`  汇总：待处理 ${targets.length}｜合并 ${merged}｜改名 ${renamed}｜移入 .trash ${moved}｜键冲突 ${totalConflicts}`);
console.log(APPLY ? "  已写盘（旧文件在 json/index/.trash/，可恢复）" : "  预演结束，未写任何文件；确认后加 --apply 执行");
