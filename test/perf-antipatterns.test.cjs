// test/perf-antipatterns.test.cjs —— 反模式检查脚本的「历史提交语料回归」
//
// 测试方法（用户 2026-10-12 提出）：拿**历史提交的修复点**当语料——
//   对每个修复点，取「修复前（sha^）」与「修复后（sha）」两版文件，分别跑检查脚本：
//     · 修复前必须**扫得出来**（命中预期规则）
//     · 修复后必须**扫不出来**（该规则对该文件不再命中）
//   这样脚本的召回率与误报率都被真实历史钉住，而不是我自说自话。
//
// 隔离：把项目代码子集（server/crx/scripts）复制到 os.tmpdir() 的临时目录，再覆盖成历史版本，
//   全程不碰真实工作区、不碰 json/ 数据。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const log = makeLog("perf-antipatterns");
const REPO = path.join(__dirname, "..");
const CHECKER = path.join(REPO, "scripts", "check-perf-antipatterns.mjs");

/** 语料：sha 为修复提交；file 为被修文件；rule 为预期规则；tier 为预期等级（可选） */
const CORPUS = [
  { sha: "655030a", file: "server/lib/downloader.js", rule: "R1", tier: "warning",
    desc: "planForAppend 嵌套线性扫描（2,544×40,394 ≈ 1.03 亿次 = 12,784ms）" },
  { sha: "5bee6dc", file: "server/lib/downloader.js", rule: "R2", tier: "warning",
    desc: "finalizeHtmls 逐目录调 ingestModDir（写盘 121MB/s、收尾 363–455 秒）；修复后移入 if (changed) ⇒ 规则放过" },
  { sha: "4b56497", file: "server/lib/gb-api.js", rule: "R6", tier: "blocker",
    desc: "fetchJsonHeaders 循环后缺兜底 return ⇒ 返回 undefined ⇒ 调用方解构崩溃" },
  { sha: "bdf7032", file: "server/lib/downloader.js", rule: "R9", tier: "blocker",
    desc: "下载写死 Chrome/120 UA（GB 会话与 UA 绑定 ⇒ 全 403）" },
  { sha: "bdf7032", file: "crx/native-host/host.cjs", rule: "R9", tier: "blocker",
    desc: "native host 写死极简 UA 却带浏览器 cookie" },
  { sha: "a34397c", file: "server/public/fragments/topbar/userscript.html", rule: "R8", tier: "blocker",
    desc: "href 手写 ?v=4.4.1 与脚本 @version 4.5.0 漂移" },
  { sha: "fe9259e", file: "server/routes/download.js", rule: "R5",
    desc: "写接口把完整 task 塞进响应（38MB 响应、120 秒无响应）" },
];

// 语料**故意不含**的坑（静态判不出来，别自欺欺人）：
//   · 4b56497 的「索引每轮都写整份」——调用点在 `if (changed)` 里，和「每个游戏写一次」在代码上长得一样，
//     差别只在**循环规模**（4,598 目录 vs 13 游戏）⇒ 必须运行期计数，静态规则只能给 warning 提示。
//   · 5953be1 的「渲染不存在的字段 f.exists」——需要数据流分析（该字段从未被赋值），当前不做。

/** 把项目代码子集复制到临时目录（不复制 json/ 数据） */
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-perf-"));
  for (const sub of ["server", "crx", "scripts"]) {
    fs.cpSync(path.join(REPO, sub), path.join(dir, sub), { recursive: true });
  }
  return dir;
}
/** 取历史版本的某文件内容（sha 可为 "<sha>^"） */
function showFile(sha, file) {
  return execFileSync("git", ["-C", REPO, "show", `${sha}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
/** 在沙箱里跑检查脚本，返回 findings */
function runChecker(sandbox) {
  let out = "";
  try {
    out = execFileSync(process.execPath, [CHECKER, "--root", sandbox, "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    out = String(e.stdout || "");   // 有 blocker 时退出码 1，stdout 仍是 JSON
  }
  return JSON.parse(out).findings || [];
}
const hits = (findings, rule, file, tier) =>
  findings.filter((f) => f.rule === rule && f.file === file.replace(/\\/g, "/") && (!tier || f.tier === tier));

loggedTest(log, "反模式检查：历史修复点语料——修复前必须扫出、修复后必须不报", () => {
  const sandbox = makeSandbox();
  const results = [];
  try {
    for (const c of CORPUS) {
      // 修复前：写到沙箱 → 应命中
      fs.writeFileSync(path.join(sandbox, c.file), showFile(c.sha + "^", c.file));
      const before = runChecker(sandbox);
      const beforeHit = hits(before, c.rule, c.file, c.tier);
      // 修复后：写到沙箱 → 不应再命中
      fs.writeFileSync(path.join(sandbox, c.file), showFile(c.sha, c.file));
      const after = runChecker(sandbox);
      const afterHit = hits(after, c.rule, c.file, c.tier);
      results.push({ c, beforeN: beforeHit.length, afterN: afterHit.length });
      assert.ok(beforeHit.length > 0,
        `【漏报】${c.sha} ${c.file} 应被 ${c.rule} 扫出（${c.desc}），实际未命中`);
      assert.equal(afterHit.length, 0,
        `【误报】${c.sha} ${c.file} 修复后仍被 ${c.rule} 命中（${c.desc}）：${JSON.stringify(afterHit[0] || {})}`);
      log.info(`✓ ${c.sha} ${c.rule} ${c.file} —— ${c.desc}`);
    }
    const total = results.length;
    const recall = results.filter((r) => r.beforeN > 0).length;
    log.info(`语料回归：${total} 个历史修复点，召回 ${recall}/${total}，误报 ${results.filter((r) => r.afterN > 0).length}`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
