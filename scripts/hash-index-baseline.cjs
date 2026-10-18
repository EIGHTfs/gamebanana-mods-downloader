#!/usr/bin/env node
// ============================================================
// 索引反查等价性基准：采集 / 校验（2026-10-18 新增）
//
// 用途：json/index 的反查链路（queryByHash / searchGb）改动前先落一份「黄金基线」，
//       改完用同一脚本重跑，指纹一致即证明**查询语义逐字段未变**。
//
// 为什么同时产出两种东西：
//   ① queries  —— 每个样本 key 的**原始查询结果**（不是 HTTP 路由投影，字段更全、更严格）
//   ② records  —— 支撑这些结果的那几条索引记录（{t,k,v}）
//   ⇒ 有了 ② 就能在**没有生产数据**的机器上重建一个小索引做离线回归（test/hash-index-baseline.test.cjs），
//     有了 ① 就能把查询语义钉死；两者合起来 = 真实数据 + 可入库复跑。
//
// 用法（全部参数化，脚本内不写任何具体路径）：
//   node scripts/hash-index-baseline.cjs --json-dir <json 根目录> [--out <基线文件>] [--samples 3]
//   node scripts/hash-index-baseline.cjs --json-dir <json 根目录> --verify <已有基线文件>
//
// 退出码：0 成功 / 1 失败 / 2 指纹不一致（--verify 模式）
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- 参数 ----------
function parseArgs(argv) {
  const out = { samples: 3, redact: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--json-dir") out.jsonDir = next();
    else if (a === "--out") out.out = next();
    else if (a === "--verify") out.verify = next();
    else if (a === "--redact") out.redact.push(next());
    else if (a === "--samples") out.samples = Math.max(1, parseInt(next(), 10) || 3);
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

const USAGE = [
  "用法：node scripts/hash-index-baseline.cjs --json-dir <json 根目录> [--out <基线文件>] [--samples 3] [--redact <路径>]...",
  "      node scripts/hash-index-baseline.cjs --json-dir <json 根目录> --verify <已有基线文件> [--redact <路径>]...",
  "",
  "  --json-dir  json 根目录（其下有 index/*.jsonl），必填",
  "  --out       采集结果写入的文件（缺省打印到 stdout）",
  "  --verify    用当前代码重算，与已有基线比对指纹（一致退出 0，不一致退出 2）",
  "  --samples   每个分段取前 N / 后 N 个 key 作样本（缺省 3）",
  "  --redact    额外要脱敏的路径前缀（可重复）。索引里记录的 modDir 通常指向游戏库根，",
  "              该根往往在项目目录之外 ⇒ 必须显式传入，否则基线会固化机器专属路径。",
  "              替换成 <ROOT_1>/<ROOT_2>…（按路径长度倒序编号），保证换机器复跑指纹一致。"
].join("\n");

// ---------- 工具 ----------
/**
 * 把机器相关路径替换成占位符（只处理字符串；结构由 normDeep 递归）。
 *   redacts：额外前缀（如游戏库根），与 jsonDir / 项目根一起按**长度倒序**替换 ——
 *   必须先替换长前缀，否则短前缀（项目根）会抢先命中，留下半截绝对路径。
 */
function makePathReplacer(jsonDir, redacts) {
  const json = path.resolve(jsonDir);
  const root = path.dirname(json); // 通常就是项目根
  const all = [...new Set([json, root].concat((redacts || []).map((p) => path.resolve(p))))]
    .sort((a, b) => b.length - a.length);
  const labels = all.map((p, i) => ({ p, tag: "<ROOT_" + (i + 1) + ">" }));
  return (s) => {
    let out = String(s);
    for (const { p, tag } of labels) out = out.split(p).join(tag);
    return out;
  };
}

function normDeep(v, norm) {
  if (typeof v === "string") return norm(v);
  if (Array.isArray(v)) return v.map((x) => normDeep(x, norm));
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = normDeep(v[k], norm);
    return o;
  }
  return v;
}

/** 键名递归排序后序列化：指纹与对象字段顺序无关，跨 Node 版本稳定 */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
    return o;
  }
  return v;
}

function fingerprint(core) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(core))).digest("hex");
}

// ---------- 采集 ----------

/** 加载索引模块并读入全部游戏文件（GBMD_JSON_DIR 必须在 require 之前设置） */
function loadIndex(jsonDir) {
  const oldEnv = process.env.GBMD_JSON_DIR;
  process.env.GBMD_JSON_DIR = jsonDir;
  let idx;
  try {
    idx = require("../server/lib/hash-index.js");
  } finally {
    if (oldEnv === undefined) delete process.env.GBMD_JSON_DIR;
    else process.env.GBMD_JSON_DIR = oldEnv;
  }
  idx.load();
  return idx;
}

/** 扫描索引文件：每段采样前 N / 后 N 个 key，并建立「key → 各段记录」反查表 */
function scanIndexFiles(indexDir, samples) {
  const files = fs.readdirSync(indexDir).filter((f) => /\.jsonl$/.test(f)).sort();
  const firstKeys = {};
  const lastKeys = {};
  const recsByPlainKey = new Map(); // k -> [{t,k,v,file}]（同一 key 可能同时出现在 gb/local/name 三段）
  const modNames = [];
  const games = new Set();
  const perFile = [];

  for (const f of files) {
    const text = fs.readFileSync(path.join(indexDir, f), "utf8");
    let records = 0;
    for (const line of text.split("\n")) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch (_) { continue; }
      if (!r || !r.t || r.k === undefined) continue;
      records++;
      const t = String(r.t);
      const k = String(r.k);
      if (!firstKeys[t]) firstKeys[t] = [];
      if (firstKeys[t].length < samples) firstKeys[t].push(k);
      if (!lastKeys[t]) lastKeys[t] = [];
      lastKeys[t].push(k);
      if (lastKeys[t].length > samples) lastKeys[t].shift();
      if (!recsByPlainKey.has(k)) recsByPlainKey.set(k, []);
      recsByPlainKey.get(k).push({ t, k, v: r.v, file: f });
      if (t === "gb" && r.v) {
        if (r.v.game) games.add(String(r.v.game));
        const n = String(r.v.modName || "");
        if (n && modNames.length < 8 && modNames.indexOf(n) < 0) modNames.push(n);
      }
    }
    perFile.push({ file: f, records });
  }
  return { firstKeys, lastKeys, recsByPlainKey, modNames, games, perFile };
}

/** 样本 key：每段前 N + 后 N，去重后升序（确定性） */
function pickSampleKeys(firstKeys, lastKeys) {
  const out = [];
  for (const t of Object.keys(firstKeys).sort()) {
    const set = new Set([].concat(firstKeys[t] || [], lastKeys[t] || []));
    for (const k of [...set].sort()) out.push({ t, k });
  }
  return out;
}

/** 边界 key：不存在的 key + 「带后缀 / 去后缀」双向（从 name 段样本派生） */
function pickEdgeKeys(sampleKeys) {
  const names = sampleKeys.filter((x) => x.t === "name").map((x) => x.k);
  const withExt = names.find((k) => /\.[a-z0-9]{2,5}$/i.test(k)) || "";
  const noExt = withExt ? withExt.replace(/\.[a-z0-9]{2,5}$/i, "") : "";
  return ["00000000000000000000000000000000", "deadbeef", noExt, withExt ? withExt + ".png" : ""]
    .filter(Boolean);
}

/**
 * 离线复现所需的支撑记录：**同一 key 在三段的记录都要带上**。
 *   原因：queryByHash 是 local→gb→name→stem 逐级回落的，只存「本段」记录会让
 *   重建后的索引查到另一段的记录（首版夹具正是栽在这里）。边界 key 还要带上 stem 变体。
 */
function buildRecords(sampleKeys, edges, recsByPlainKey, norm) {
  const needed = new Set(sampleKeys.map((x) => x.k));
  for (const k of edges) {
    needed.add(k);
    for (const pk of recsByPlainKey.keys()) {
      if (pk === k || pk.startsWith(k + ".")) needed.add(pk);
    }
  }
  const seen = new Set();
  const records = [];
  for (const k of needed) {
    for (const rec of (recsByPlainKey.get(k) || [])) {
      const sig = rec.t + "\u0000" + rec.k + "\u0000" + rec.file;
      if (seen.has(sig)) continue;
      seen.add(sig);
      records.push(normDeep(rec, norm));
    }
  }
  return records;
}

/** 反查用例：样本 key + 边界 key，记录**原始返回**（不是 HTTP 路由投影，字段更全、更严格） */
function buildHashQueries(sampleKeys, edges, idx, norm) {
  const queries = [];
  for (const { t, k } of sampleKeys) {
    queries.push({ kind: "hash", t, input: norm(k), expect: normDeep(idx.queryByHash(k) || null, norm) });
  }
  for (const k of edges) {
    queries.push({ kind: "hash", t: "edge", input: norm(k), expect: normDeep(idx.queryByHash(k) || null, norm) });
  }
  return queries;
}

/** 搜索用例：全库语义，只有真实数据才能复现（离线测试只做自洽校验，不冒充等价性） */
function buildSearches(modNames, games, idx, norm) {
  const one = (q, game) => {
    const res = idx.searchGb(q, game) || [];
    return { q: norm(q), game: norm(game), count: res.length, modIds: res.map((x) => String(x.modId)).sort() };
  };
  const out = [];
  for (const n of modNames.slice(0, 3)) {
    out.push(one(n, ""));
    if (n.length >= 6) out.push(one(n.slice(0, 6), ""));
  }
  const g0 = [...games].sort()[0] || "";
  if (g0 && modNames[0]) out.push(one(modNames[0], g0));
  return out;
}

/** 采集主流程：加载 → 扫描采样 → 生成记录与用例 */
function collect(opts) {
  const jsonDir = path.resolve(opts.jsonDir);
  const indexDir = path.join(jsonDir, "index");
  if (!fs.existsSync(indexDir)) throw new Error("找不到索引目录：" + indexDir);

  const idx = loadIndex(jsonDir);
  const status = idx.status();
  const scan = scanIndexFiles(indexDir, opts.samples);
  const sampleKeys = pickSampleKeys(scan.firstKeys, scan.lastKeys);
  const edges = pickEdgeKeys(sampleKeys);
  const norm = makePathReplacer(jsonDir, opts.redact);

  const records = buildRecords(sampleKeys, edges, scan.recsByPlainKey, norm);
  const queries = buildHashQueries(sampleKeys, edges, idx, norm);
  const searches = buildSearches(scan.modNames, scan.games, idx, norm);

  return Object.assign({ status, perFile: scan.perFile, queryCount: queries.length }, { queries, searches, records });
}

// ---------- 主流程 ----------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.jsonDir) {
    process.stdout.write(USAGE + "\n");
    return opts.help ? 0 : 1;
  }

  const core = collect(opts);
  const sha = fingerprint(core);

  if (opts.verify) {
    const old = JSON.parse(fs.readFileSync(opts.verify, "utf8"));
    const oldSha = old.sha256 || "";
    const same = oldSha === sha;
    process.stdout.write(
      "[hash-index-baseline] 校验 " + (same ? "通过 ✓" : "失败 ✗") + "\n" +
      "  基线指纹: " + oldSha + "\n" +
      "  当前指纹: " + sha + "\n" +
      "  查询数  : " + core.queryCount + "（基线 " + (old.queryCount || "?") + "）\n"
    );
    if (!same) {
      // 逐条定位第一处差异，避免只给一个"不一样"
      const oldQ = (old.queries || []);
      for (let i = 0; i < Math.max(oldQ.length, core.queries.length); i++) {
        const a = JSON.stringify(canonical(oldQ[i] || null));
        const b = JSON.stringify(canonical(core.queries[i] || null));
        if (a !== b) {
          process.stdout.write("  首个差异 #" + i + "\n    基线: " + a.slice(0, 400) + "\n    当前: " + b.slice(0, 400) + "\n");
          break;
        }
      }
    }
    return same ? 0 : 2;
  }

  const payload = Object.assign({ capturedAt: new Date().toISOString(), sha256: sha }, core);
  const text = JSON.stringify(payload, null, 1);
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, text + "\n", "utf8");
    process.stdout.write("[hash-index-baseline] 已写入 " + opts.out + "\n  指纹 " + sha + " / 查询 " + core.queryCount + " / 记录 " + core.records.length + "\n");
  } else {
    process.stdout.write(text + "\n");
  }
  return 0;
}

process.exitCode = main();
