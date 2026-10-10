#!/usr/bin/env node
// ============================================================
// scripts/check-hardcoded-paths.mjs —— 脚本硬编码路径专项检查
//
// 规则（2026-10-11 用户要求「所有脚本都不要硬编码路径」）：
//   脚本/测试里的路径必须**派生**：从脚本自身位置（import.meta.url / BASH_SOURCE）、环境变量、
//   参数、`os.tmpdir()`、项目根相对路径等得来；禁止写死 `/volume1/...`、`/usr/local/bin/node`、
//   `C:\...` 这类本机绝对路径（换机/换环境即失效）。
//
// 判定：
//   · 扫描 scripts/、test/、仓库根的 *.sh
//   · 只看**代码行**（跳过纯注释行；注释里的示例路径由人工清理）
//   · 命中绝对路径字面量 → 报错；确有必要的（平台规定路径、测试夹具、node 候选搜索列表）
//     在同行或上一行加 `// path-check-ok: <理由>`（.sh 用 `# path-check-ok: <理由>`）豁免
//   · 已知合规形态不报：`os.tmpdir()`/`path.join(__dirname, …)`/`$(dirname "$0")`/`$ROOT/...`
//
// 用法：node scripts/check-hardcoded-paths.mjs [--json]；退出码 0=通过 1=有问题
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["scripts", "test"];
const SKIP_FILES = new Set(["check-hardcoded-paths.mjs"]); // 本文件自身含规则说明与豁免词
// 平台/工具规定、或本来就是「候选搜索」的路径（不报）：Synology 套件目录、node 候选、常见系统目录
const ALLOW = [
  /^\/var\/packages\//,            // Synology SPK 规定目录（安装器脚本必须用）
  /^\/usr\/local\/bin\/node$/,     // node 候选搜索列表项
  /^\/opt\/(homebrew|node)\//,     // 同上（macOS/Linux 候选）
  /^\/var\/packages\/Node\.js_/    // 同上（Synology node 候选）
];
const ABS = /(?:^|[\s(,=:[{])((?:\/(?:volume|usr|etc|opt|var|home|root|tmp|mnt|media|srv)\b[^\s"'`,)]*)|(?:[A-Za-z]:\\\\[^\s"'`,)]*))/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "logs") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(mjs|cjs|js|sh)$/.test(ent.name) && !SKIP_FILES.has(ent.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
for (const f of fs.readdirSync(ROOT)) if (f.endsWith(".sh")) files.push(path.join(ROOT, f));

const findings = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(#|\/\/|\*|\/\*)/.test(trimmed)) continue;                       // 纯注释行不判
    const waived = /path-check-ok:/.test(line) || /path-check-ok:/.test(lines[i - 1] || "");
    ABS.lastIndex = 0;
    let m;
    while ((m = ABS.exec(line))) {
      const hit = m[1];
      if (ALLOW.some((re) => re.test(hit))) continue;
      if (waived) continue;
      findings.push({ file: rel, line: i + 1, path: hit, snippet: trimmed.slice(0, 120) });
    }
  }
}

const json = process.argv.includes("--json");
if (json) console.log(JSON.stringify({ ok: !findings.length, scanned: files.length, findings }, null, 2));
else if (!findings.length) console.log(`✅ 路径检查通过（扫描 ${files.length} 个脚本/测试，未发现硬编码绝对路径）`);
else {
  console.log(`❌ 路径检查发现 ${findings.length} 处硬编码绝对路径：`);
  for (const x of findings) {
    console.log(`  ${x.file}:${x.line}  →  ${x.path}`);
    console.log(`     代码: ${x.snippet}`);
  }
  console.log("  修法：从脚本自身位置/env/参数派生（BASH_SOURCE、import.meta.url、os.tmpdir()、path.join(__dirname,…)）；");
  console.log("       确有必要的（平台规定路径/测试夹具/候选搜索列表）加 `path-check-ok: <理由>` 豁免");
}
process.exit(findings.length ? 1 : 0);
