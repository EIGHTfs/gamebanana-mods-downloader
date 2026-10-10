#!/usr/bin/env node
// ============================================================
// scripts/check-status-logic.mjs —— 状态判定专项检查（防「排除式结束判定」再犯）
//
// 背景（2026-10-11 两次真实事故，都出在同一类写法上）：
//   ① 前端 taskStats/rowHtml 用 `status !== "running" && status !== "preparing"` 当「任务已结束」
//      ⇒ **暂停**被误判为结束 ⇒ 在途行冒出 🔄重试/🚫跳过、全局「重试失败」亮起
//   ② 后端 retryFailed 用 `stillRunning` 取反当结束 ⇒ 暂停态点「重试失败」把 **3 万多条尚未轮到下载**
//      的项全部重新入队、清空结果表 ⇒ 任务文件反复重写、写盘 ≈76–95MB/s，服务被拖到接口超时
//
// 规则（可机械判定，无需 AST）：
//   R1 排除式比较：`status !== "x"` 必须带 `status-check-ok: <理由>` 说明（同行或上一行）。
//      理由：排除式写法在**新增状态**（如 paused）时会静默并入旧语义分支——这正是上面两次事故的成因。
//   R2 「已结束」字面量集合（done/stopped/error）只允许出现在名字匹配 isTaskEnded/isEnded 的函数里；
//      别处把其中 ≥2 个拼在一起 = 又私自发明一套「结束」定义（应改为调用统一 helper）。
//
// 用法：node scripts/check-status-logic.mjs [--json]
//   退出码 0 = 通过；1 = 有问题（会列出 file:line 与修改建议）
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 注意：不要用 new URL(...).pathname —— 路径含中文时会被百分号编码（实测踩过）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".trash", "test", "docs", "json", "mapping", "tool"]);
const ENDED = ["done", "stopped", "error"];
const findings = [];

function walk(dir) {
  let out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out = out.concat(walk(p));
    } else if (ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** 找该行所在的最近函数名（向上扫描 `function xxx` / `xxx = (...) =>` 的简单形态） */
function enclosingFn(lines, i) {
  for (let k = i; k >= 0 && k > i - 400; k--) {
    const m = lines[k].match(/(?:function\s+([A-Za-z0-9_$]+))|(?:const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\()/);
    if (m) return m[1] || m[2] || "";
  }
  return "";
}

const files = walk(ROOT);
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*)/.test(line)) continue; // 注释行不判（含本文件说明与历史记录）

    // R1：排除式状态比较
    if (/\.?status\s*!==?\s*["']/.test(line) && !/status-check-ok:/.test(line) && !/status-check-ok:/.test(lines[i - 1] || "")) {
      findings.push({
        rule: "R1-排除式状态比较",
        file: rel, line: i + 1, snippet: line.trim().slice(0, 120),
        hint: "排除式写法在新增状态时会静默并入旧分支。改为正向判定（枚举允许的状态），或在同行/上一行加 `// status-check-ok: <为什么这样写安全>`"
      });
    }

    // R2：私自发明「已结束」集合
    const hits = ENDED.filter((s) => new RegExp(`["']${s}["']`).test(line));
    if (hits.length >= 2) {
      const fn = enclosingFn(lines, i);
      const waived = /status-check-ok:/.test(line) || /status-check-ok:/.test(lines[i - 1] || "");
      if (!/isTaskEnded|isEnded/.test(fn) && !waived) {
        findings.push({
          rule: "R2-私自拼「已结束」集合",
          file: rel, line: i + 1, snippet: line.trim().slice(0, 120),
          hint: `检测到 ${hits.join("/")} 组合（所在函数: ${fn || "?"}）。请改用统一的 isTaskEnded() helper，别在各处重新定义「结束」`
        });
      }
    }
  }
}

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ ok: findings.length === 0, scanned: files.length, findings }, null, 2));
} else if (!findings.length) {
  console.log(`✅ 状态判定检查通过（扫描 ${files.length} 个 .js 文件，未发现排除式结束判定/私自定义结束集合）`);
} else {
  console.log(`❌ 状态判定检查发现 ${findings.length} 处问题：`);
  for (const x of findings) {
    console.log(`  [${x.rule}] ${x.file}:${x.line}`);
    console.log(`     代码: ${x.snippet}`);
    console.log(`     建议: ${x.hint}`);
  }
}
process.exit(findings.length ? 1 : 0);
