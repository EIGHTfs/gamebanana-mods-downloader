#!/usr/bin/env node
// ============================================================
// scripts/check-perf-antipatterns.mjs —— 性能/健壮性反模式静态检查（零依赖）
//
// 由来（2026-10-12）：本项目连续踩到同一类坑——**热路径上对大表做全量处理**。逐个手工排查太慢，
//   于是把「已经踩过并修复」的结构特征固化成规则，用历史提交做语料回归（见 test/perf-antipatterns.test.cjs）。
//
// 分层（重要）：
//   · blocker 级 = 结构上确定有问题（缺兜底 return / 写死 UA / 版本号漂移 / 未加守卫的循环内整份重写）
//   · warning 级 = 强候选，需结合实测判断（嵌套线性扫描、循环内整份重写但有守卫、长同步循环无让出点、
//     接口回全量对象）。**warning 不代表真瓶颈**——真瓶颈必须用 CPU profiler / IO 归因实测。
//   · 静态**扫不出**的：哪个热点最贵、字段是否真的存在（需数据流）、写入频次（需运行期计数）。
//
// 豁免：行内或上一行写 `perf-ok: <理由>` 即跳过该行命中。
// 用法：node scripts/check-perf-antipatterns.mjs [--root <dir>] [--json] [files...]
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["server", "crx", "scripts"];
const CODE_RE = /\.(js|cjs|mjs|html)$/;

// ---------- 基础工具 ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "json" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (CODE_RE.test(ent.name)) out.push(p);
  }
  return out;
}
/** 把字符串/注释内容替换成等长空白（保留换行）——结构扫描时用，避免串内括号干扰配对 */
function mask(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && c2 === "*") { out += "  "; i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { out += "  "; i += 2; continue; }
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}
const lineOf = (src, off) => src.slice(0, off).split("\n").length;
/** 从 mask 的 openIdx（'{' 或 '('）找到配对位置；找不到返回 -1 */
function matchPair(m, openIdx) {
  const open = m[openIdx];
  const close = open === "{" ? "}" : ")";
  let depth = 0;
  for (let i = openIdx; i < m.length; i++) {
    if (m[i] === open) depth++;
    else if (m[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** 找到 mask 中所有循环块（for/while/forEach/map/filter/some/every/reduce） */
function loopsIn(m, from = 0, to = m.length) {
  const out = [];
  const re = /(?:^|[^\w$.])(for\s*(?:await\s*)?\(|while\s*\(|\.(?:forEach|map|filter|some|every|reduce)\s*\()/g;
  re.lastIndex = from;
  let mt;
  while ((mt = re.exec(m)) && mt.index < to) {
    // 注意：mt[0] 含前缀（(?:^|[^\w$.])），括号位置必须按 mt[0] 末尾算，不能用 mt[1].length
    const parenStart = mt.index + mt[0].length - 1;
    const parenEnd = matchPair(m, parenStart);
    if (parenEnd < 0 || parenEnd > to) continue;
    let bodyStart = -1, bodyEnd = -1;
    let j = parenEnd + 1;
    while (j < to && /\s/.test(m[j])) j++;
    if (m[j] === "{") { bodyStart = j + 1; bodyEnd = matchPair(m, j); }
    else { bodyStart = parenEnd + 1; bodyEnd = parenEnd + 1; }   // 表达式体（如 .map(x => x.a)）无块
    if (bodyStart < 0 || bodyEnd < 0) continue;
    out.push({ head: mt[1].trim(), start: mt.index, bodyStart, bodyEnd });
  }
  return out;
}
/** 从 off 向外找最近的 if 条件（跳过 try/else 等非 if 块）；只在 stopAt 之后找（避免把循环外的 if 算进来） */
function enclosingIfCond(m, off, stopAt = 0) {
  let depth = 0;
  for (let i = off - 1; i > stopAt; i--) {
    if (m[i] === "}") depth++;
    else if (m[i] === "{") {
      if (depth > 0) { depth--; continue; }
      const before = m.slice(Math.max(stopAt, i - 240), i);
      const mt = before.match(/if\s*\(([^)]*)\)\s*$/);
      if (mt) return mt[1];
      // 不是 if 块（如 try {）：继续向外找，别在这里返回 null
    }
  }
  return null;
}
/** 收集函数体：{name, bodyStart, bodyEnd}（function 声明 + 箭头函数块体） */
function funcsIn(m) {
  const out = [];
  const re = /(?:async\s+)?function\s*([\w$]*)\s*\([^)]*\)\s*\{/g;
  let mt;
  while ((mt = re.exec(m))) out.push({ name: mt[1] || "(anonymous)", bodyStart: mt.index + mt[0].length, bodyEnd: matchPair(m, mt.index + mt[0].length - 1) });
  const re2 = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/g;
  while ((mt = re2.exec(m))) out.push({ name: mt[1], bodyStart: mt.index + mt[0].length, bodyEnd: matchPair(m, mt.index + mt[0].length - 1) });
  return out.filter((f) => f.bodyEnd > f.bodyStart);
}
const hasWaiver = (src, off) => {
  const l = lineOf(src, off);
  const lines = src.split("\n");
  return /perf-ok:/.test(lines[l - 1] || "") || /perf-ok:/.test(lines[l - 2] || "");
};

// ---------- 规则 ----------
/** R1 嵌套线性扫描（O(n×m) 候选）：.filter/.find/.some/.every 回调里再套 for + === 比较 */
function R1(file, src, m, add) {
  const re = /\.(filter|find|some|every)\s*\(/g;
  let mt;
  while ((mt = re.exec(m))) {
    const parenEnd = matchPair(m, mt.index + mt[0].length - 1);
    if (parenEnd < 0) continue;
    const body = m.slice(mt.index + mt[0].length, parenEnd);
    if (!/\bfor\s*(?:await\s*)?\(/.test(body)) continue;
    if (!body.includes("===")) continue;
    if (hasWaiver(src, mt.index)) continue;
    add("warning", "R1", file, lineOf(src, mt.index),
      `成员判定回调里套了 for 循环并做 === 比较 ⇒ O(n×m) 候选（历史：planForAppend 2,544×40,394 ≈ 1.03 亿次 = 12,784ms）`,
      src.slice(mt.index, mt.index + 80).replace(/\s+/g, " "));
  }
}
/** R2 循环内整份重写文件：循环体调用「内部含 writeFileSync + JSON.stringify」的函数（含传递闭包） */
function buildFullRewriters(files) {
  // 按文件解析调用图：同名函数跨文件串味会把无关函数误判成「整份重写」（实测踩过：
  //   gameRootOf / walkDir / gameIdOf 被误报），故只在**同一文件内**做传递闭包。
  const perFile = new Map();
  for (const f of files) {
    const m = mask(fs.readFileSync(f, "utf8"));
    const map = new Map();
    for (const fn of funcsIn(m)) map.set(fn.name, m.slice(fn.bodyStart, fn.bodyEnd));
    perFile.set(f, map);
  }
  const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "typeof", "new", "await",
    "delete", "void", "in", "of", "do", "else", "try", "JSON", "Object", "Array", "String", "Number", "Boolean",
    "Map", "Set", "Promise", "require", "parseInt", "parseFloat", "isNaN", "console", "Error", "Date", "RegExp",
    "Buffer", "setTimeout", "setInterval", "clearInterval", "clearTimeout"]);
  const isDirectWriter = (file, name) => {
    const map = perFile.get(file);
    const b = map && map.get(name);
    return !!(b && /writeFileSync\s*\(/.test(b) && /JSON\.stringify\s*\(/.test(b));
  };
  // 只认「自己直接整份写」+「一层调用到直接写」——不做多级传递：
  //   多级传递会把 gameRootOf → readConfig → …→ 某处写文件 这类无关链条染进来（实测误报一片）。
  //   注意：**循环规模静态不可知**（13 个游戏 vs 4,598 个目录都长一样）⇒ R2 只作 warning，不作 blocker。
  const isFull = (file, name) => {
    if (isDirectWriter(file, name)) return true;
    const map = perFile.get(file);
    const b = map && map.get(name);
    if (!b) return false;
    for (const callee of new Set([...b.matchAll(/([\w$]+)\s*\(/g)].map((x) => x[1]))) {
      if (KEYWORDS.has(callee) || callee === name) continue;
      if (isDirectWriter(file, callee)) return true;
    }
    return false;
  };
  const set = new Set();
  for (const [file, map] of perFile) for (const name of map.keys()) if (isFull(file, name)) set.add(name);
  return set;
}
function R2(file, src, m, add, fullRewrite) {
  for (const lp of loopsIn(m)) {
    const body = m.slice(lp.bodyStart, lp.bodyEnd);
    for (const mt of body.matchAll(/(?:[\w$.]*\.)?([\w$]+)\s*\(/g)) {
      if (!fullRewrite.has(mt[1])) continue;
      const abs = lp.bodyStart + mt.index;
      if (hasWaiver(src, abs)) continue;
      const cond = enclosingIfCond(m, abs, lp.bodyStart);
      // guarded：历史修复引入的 `if (changed)` 守卫 ⇒ 只有内容真变了才写，直接放过
      if ((cond || "").includes("changed")) continue;
      const args = body.slice(mt.index, mt.index + 200);
      if (/deferSave|批量|queue|batch/i.test(args)) continue;
      add("warning", "R2", file, lineOf(src, abs),
        `循环内调用「整份重写文件」的 ${mt[1]}() ⇒ 每轮重写整份（历史：单份索引 15–26MB × 数千轮 = 几十 GB；`
        + `**循环规模静态不可知**，请确认循环上限后再决定是否批量化/延迟落盘）`,
        src.slice(abs, abs + 70).replace(/\s+/g, " "));
    }
  }
}
/** R4 长同步循环无让出点：循环体 ≥2 个同步 fs 调用且无 await（在 async 函数内） */
function R4(file, src, m, add) {
  for (const fn of funcsIn(m)) {
    if (!/async/.test(m.slice(Math.max(0, fn.bodyStart - 60), fn.bodyStart))) continue;
    const body = m.slice(fn.bodyStart, fn.bodyEnd);
    for (const lp of loopsIn(body)) {
      const lb = body.slice(lp.bodyStart, lp.bodyEnd);
      if ((lb.match(/Sync\s*\(/g) || []).length < 2) continue;
      if (/\bawait\b/.test(lb)) continue;
      const abs = fn.bodyStart + lp.start;
      if (hasWaiver(src, abs)) continue;
      add("warning", "R4", file, lineOf(src, abs),
        `async 函数内的长同步循环（≥2 个 Sync 调用、无 await 让出点）⇒ 会占满事件循环（历史：收尾把 /api/* 堵死 74 秒）`,
        src.slice(abs, abs + 70).replace(/\s+/g, " "));
    }
  }
}
/** R5 接口回全量对象：sendJson 里 `task: <裸标识符>`（历史：把 38MB 完整任务塞进响应） */
function R5(file, src, m, add) {
  if (!/routes[\\/]/.test(file)) return;
  const re = /\btask:\s*([A-Za-z_$][\w$]*)\s*[,}]/g;
  let mt;
  while ((mt = re.exec(src))) {
    if (hasWaiver(src, mt.index)) continue;
    add("warning", "R5", file, lineOf(src, mt.index),
      `响应里直接回裸变量 task: ${mt[1]}（可能是完整状态对象）⇒ 大对象序列化+传输（历史：/api/task 34.3MB/次、写接口 38MB 响应）`,
      src.slice(mt.index, mt.index + 60).replace(/\s+/g, " "));
  }
}
/** R6 循环后缺兜底 return：函数顶层 for 内含 return，循环之后既无 return 也无 throw ⇒ 可能返回 undefined */
function R6(file, src, m, add) {
  for (const fn of funcsIn(m)) {
    const body = m.slice(fn.bodyStart, fn.bodyEnd);
    const loops = loopsIn(body).filter((lp) =>
      !loopsIn(body).some((o) => o !== lp && o.bodyStart < lp.bodyStart && o.bodyEnd > lp.bodyEnd));
    for (const lp of loops) {
      // 只认「有值 return」：裸 `return;` 是排空/提前退出助手（如 pump()），返回值无人使用，不算此坑
      if (!/\breturn\s+[^\s;]/.test(body.slice(lp.bodyStart, lp.bodyEnd))) continue;
      const tail = body.slice(lp.bodyEnd + 1).replace(/\s|}/g, "");
      if (tail) continue;                      // 后面还有语句
      const abs = fn.bodyStart + lp.start;
      if (hasWaiver(src, abs)) continue;
      add("blocker", "R6", file, lineOf(src, abs),
        `${fn.name}() 的循环里 return、循环之后既无 return 也无 throw ⇒ 可能**返回 undefined**（历史：fetchJsonHeaders 返回 undefined ⇒ 调用方解构崩溃）`,
        src.slice(abs, abs + 70).replace(/\s+/g, " "));
    }
  }
}
/** R9 写死 UA：对象字面量里 "User-Agent" 的值是**纯字符串字面量**（配置优先+兜底常量不算） */
function R9(file, src, m, add) {
  const re = /["']User-Agent["']\s*:\s*["']([^"']*)["']/g;
  let mt;
  while ((mt = re.exec(src))) {
    if (!/Mozilla/.test(mt[1])) continue;
    if (hasWaiver(src, mt.index)) continue;
    add("blocker", "R9", file, lineOf(src, mt.index),
      `写死 User-Agent（未走配置/调用方）⇒ GB 会话与 UA 绑定，UA 不匹配会被判未登录（历史：下载全 403）`,
      src.slice(mt.index, mt.index + 70).replace(/\s+/g, " "));
  }
}
/** R8 版本号漂移：html 里 .user.js 的 ?v= 与脚本元数据 @version 不一致 */
function R8(files, add) {
  const htmls = files.filter((f) => /fragments|\.html$/i.test(f));
  const scripts = files.filter((f) => /\.user\.js$/.test(f));
  const vers = new Map();
  for (const s of scripts) {
    const mt = fs.readFileSync(s, "utf8").match(/@version\s+([\w.]+)/);
    if (mt) vers.set(path.basename(s), mt[1]);
  }
  for (const h of htmls) {
    const src = fs.readFileSync(h, "utf8");
    for (const mt of src.matchAll(/href="([^"]*\.user\.js)\?v=([\w.]+)"/g)) {
      const base = path.basename(mt[1]);
      const real = vers.get(base);
      if (!real) continue;
      if (hasWaiver(src, mt.index)) continue;
      add("blocker", "R8", h, lineOf(src, mt.index),
        `href 手写 ?v=${mt[2]} 与脚本 @version ${real} **不一致**（serve 端已 no-store 防缓存，手写必然漂移；历史：?v=4.4.1 vs 4.5.0）`,
        src.slice(mt.index, mt.index + 70).replace(/\s+/g, " "));
    }
  }
}

// ---------- 主流程 ----------
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const rootIdx = argv.indexOf("--root");
const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : ROOT;
const explicit = argv.filter((a, i) => !a.startsWith("--") && i !== rootIdx + 1);
let files = explicit.length ? explicit.map((f) => path.resolve(f)) : [];
if (!files.length) for (const d of SCAN_DIRS) walk(path.join(root, d), files);
files = files.filter((f) => fs.existsSync(f));

const findings = [];
const add = (tier, rule, file, line, message, snippet) =>
  findings.push({ tier, rule, file: path.relative(root, file), line, message, snippet });
const fullRewrite = buildFullRewriters(files);
for (const f of files) {
  if (/\.user\.js$/.test(f) || /\.html$/i.test(f)) continue;   // 油猴脚本与 HTML 由 R8 单独处理
  const src = fs.readFileSync(f, "utf8");
  const m = mask(src);
  R1(f, src, m, add);
  R2(f, src, m, add, fullRewrite);
  R4(f, src, m, add);
  R5(f, src, m, add);
  R6(f, src, m, add);
  R9(f, src, m, add);
}
R8(files, add);

const blockers = findings.filter((x) => x.tier === "blocker");
if (asJson) console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
else if (!findings.length) console.log(`✅ 反模式检查通过（扫描 ${files.length} 个文件）`);
else {
  console.log(`反模式检查：${blockers.length} 个 blocker / ${findings.length - blockers.length} 个 warning（扫描 ${files.length} 个文件）`);
  for (const x of findings) console.log(`  [${x.tier}] ${x.rule} ${x.file}:${x.line}  ${x.message}\n      ${x.snippet}`);
}
process.exit(blockers.length ? 1 : 0);
