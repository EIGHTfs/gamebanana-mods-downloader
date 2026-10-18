#!/usr/bin/env node
// ============================================================
// 索引存储后端性能对比：JSONL（整文件重写） vs SQLite（行级增量）（2026-10-18 新增）
//
// 用途：用**真实索引数据**做同数据双臂对比，回答「换库到底快多少、快在哪」。
//   只读源目录（把 .jsonl 复制到临时工作目录后再跑），绝不改动生产索引。
//
// 测的四件事：
//   ① 启动加载 load()      —— 两种后端的「全量读 + 建三段 Map」耗时与内存
//   ② 单游戏增量写（改 1 条）—— 这是改造的核心收益点：JSONL 要重写整个游戏文件，SQLite 只动 1 行
//   ③ 全库增量写（每游戏改 1 条）—— 对应 rebuild / 批量收尾场景
//   ④ 落盘体积 —— jsonl 总大小 vs index.db 大小
//
// 用法（参数化，脚本内不写具体路径）：
//   node scripts/bench-index-store.cjs --dir <json/index> [--work <临时目录>] [--iters 5]
//
// 退出码：0 成功 / 1 参数或执行错误
// ============================================================
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const jsonlStore = require("../server/lib/jsonl-store");
const indexStore = require("../server/lib/index-store");
const hashIndex = require("../server/lib/hash-index");

const USAGE = [
  "用法：node scripts/bench-index-store.cjs --dir <json/index> [--work <临时目录>] [--iters 5]",
  "",
  "  --dir    源索引目录（只读，会被完整复制到 --work 下再跑），必填",
  "  --work   工作目录（缺省 os.tmpdir 下的临时目录，跑完自动清理）",
  "  --iters  每项重复次数（缺省 5，报告取中位数之外的均值与会话最快值）"
].join("\n");

function parseArgs(argv) {
  const out = { iters: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") out.dir = argv[++i];
    else if (a === "--work") out.work = argv[++i];
    else if (a === "--iters") out.iters = Math.max(1, parseInt(argv[++i], 10) || 5);
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

/** 高精度计时（毫秒，保留 2 位） */
function ms(t0) {
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1000) return (n / 1000).toFixed(2) + "s";
  if (n >= 10) return n.toFixed(1) + "ms";
  return n.toFixed(2) + "ms";
}

function fmtMB(bytes) {
  return (bytes / 1048576).toFixed(1) + "MB";
}

/** 把源目录的 .jsonl/.json 索引文件复制到工作目录的 index/ 下（不动源） */
function prepareWork(srcDir, workRoot) {
  const indexDir = path.join(workRoot, "index");
  fs.mkdirSync(indexDir, { recursive: true });
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"));
  for (const f of files) fs.copyFileSync(path.join(srcDir, f), path.join(indexDir, f));
  return { indexDir, files: files.length };
}

/** 一次完整的 load()：读全部 base + 建三段 Map（与生产启动路径同一个函数） */
function runLoad(indexDir) {
  const oldEnv = process.env.GBMD_JSON_DIR;
  process.env.GBMD_JSON_DIR = path.dirname(indexDir);
  try {
    hashIndex.load();
    return hashIndex.status();
  } finally {
    if (oldEnv === undefined) delete process.env.GBMD_JSON_DIR;
    else process.env.GBMD_JSON_DIR = oldEnv;
  }
}

/** 读出某个 base 的记录（两种后端都能读；用于构造写入负载） */
function readBase(indexDir, base) {
  return jsonlStore.readIndex(path.join(indexDir, base));
}

/** 改其中一条（模拟一次真实增量：某个文件的 hash/size 变了） */
function mutate(records) {
  const out = records.map((r) => r);
  const i = Math.floor(out.length / 2);
  out[i] = Object.assign({}, out[i], { v: Object.assign({}, out[i].v, { _benchTouched: Date.now() }) });
  return out;
}

/** 计时一组重复，返回 {avg, min, max} */
function timeIt(iters, fn) {
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = process.hrtime.bigint();
    fn(i);
    samples.push(ms(t0));
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  return { avg: sum / samples.length, min: Math.min(...samples), max: Math.max(...samples), n: iters };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.dir) {
    process.stdout.write(USAGE + "\n");
    return opts.help ? 0 : 1;
  }
  const srcDir = path.resolve(opts.dir);
  if (!fs.existsSync(srcDir)) {
    process.stdout.write("✗ 目录不存在：" + srcDir + "\n");
    return 1;
  }
  const probe = indexStore.probe();
  if (!probe.ok) {
    process.stdout.write("✗ " + probe.reason + "\n");
    return 1;
  }

  const workRoot = opts.work
    ? path.resolve(opts.work)
    : fs.mkdtempSync(path.join(os.tmpdir(), "idxbench-"));
  const cleanup = !opts.work;
  try {
    const { indexDir, files } = prepareWork(srcDir, workRoot);
    const bases = fs.readdirSync(indexDir).filter((f) => f.endsWith(".jsonl") || f.endsWith(".json")).map((f) => f.replace(/\.jsonl?$/, "")).sort();

    // 估算源数据规模
    let totalRecords = 0;
    let jsonlBytes = 0;
    const recsOf = new Map();
    for (const b of bases) {
      const r = readBase(indexDir, b);
      const recs = Array.isArray(r.records) ? r.records : [];
      recsOf.set(b, recs);
      totalRecords += recs.length;
      jsonlBytes += r.bytes || 0;
      if (!r.bytes) {
        try { jsonlBytes += fs.statSync(path.join(indexDir, b + ".jsonl")).size; } catch (_) {}
      }
    }
    // 挑记录最多的那个 base 做「单游戏增量写」负载
    let bigBase = bases[0];
    for (const b of bases) if (recsOf.get(b).length > recsOf.get(bigBase).length) bigBase = b;

    process.stdout.write("== 索引性能对比（同数据双臂） ==\n");
    process.stdout.write("  数据规模: " + bases.length + " 个 base / " + totalRecords + " 条 / jsonl " + fmtMB(jsonlBytes) + "\n");
    process.stdout.write("  最大 base: " + bigBase + "（" + recsOf.get(bigBase).length + " 条）\n");
    process.stdout.write("  重复次数: " + opts.iters + "\n\n");

    // ---------- ① 启动加载 ----------
    const loadJsonl = timeIt(opts.iters, () => { runLoad(indexDir); });
    // 种库：把工作目录里的数据写进 SQLite（一次性）
    for (const b of bases) indexStore.writeIndexAtomic(path.join(indexDir, b), { game: b, schema: 2 }, recsOf.get(b));
    indexStore.closeDb();
    const loadSqlite = timeIt(opts.iters, () => { runLoad(indexDir); });
    indexStore.closeDb();

    // ---------- ② 单游戏增量写（改 1 条）----------
    const bigRecs = recsOf.get(bigBase);
    const bigTouched = mutate(bigRecs);
    const bigJsonlPath = path.join(indexDir, bigBase);
    // JSONL：整文件重写（这正是改造前的行为）
    const wJsonl = timeIt(opts.iters, () => {
      jsonlStore.writeIndexAtomic(bigJsonlPath, { game: bigBase, schema: 2 }, bigTouched);
    });
    const jsonlFileBytes = (() => { try { return fs.statSync(bigJsonlPath + ".jsonl").size; } catch (_) { return 0; } })();
    // SQLite：只 UPSERT 变化的那一行
    const walBefore = (() => { try { return fs.statSync(indexStore.dbPathOf(indexDir) + "-wal").size; } catch (_) { return 0; } })();
    const wSqlite = timeIt(opts.iters, () => {
      indexStore.writeIndexAtomic(path.join(indexDir, bigBase), { game: bigBase, schema: 2 }, bigTouched);
    });
    const walAfter = (() => { try { return fs.statSync(indexStore.dbPathOf(indexDir) + "-wal").size; } catch (_) { return 0; } })();
    indexStore.closeDb();

    // ---------- ③ 全库增量写（每游戏改 1 条）----------
    const allTouched = new Map();
    for (const b of bases) allTouched.set(b, mutate(recsOf.get(b)));
    const allJsonl = timeIt(opts.iters, () => {
      for (const b of bases) jsonlStore.writeIndexAtomic(path.join(indexDir, b), { game: b, schema: 2 }, allTouched.get(b));
    });
    const allSqlite = timeIt(opts.iters, () => {
      for (const b of bases) indexStore.writeIndexAtomic(path.join(indexDir, b), { game: b, schema: 2 }, allTouched.get(b));
    });
    indexStore.closeDb();

    // ---------- ④ 落盘体积 ----------
    const dbSize = (() => { try { return fs.statSync(indexStore.dbPathOf(indexDir)).size; } catch (_) { return 0; } })();
    const walSize = (() => { try { return fs.statSync(indexStore.dbPathOf(indexDir) + "-wal").size; } catch (_) { return 0; } })();
    const jsonlTotal = (() => {
      let n = 0;
      for (const f of fs.readdirSync(indexDir)) if (f.endsWith(".jsonl")) n += fs.statSync(path.join(indexDir, f)).size;
      return n;
    })();

    const speed = (a, b) => (b > 0 ? (a / b).toFixed(1) + "×" : "-");
    process.stdout.write("① 启动加载 load()（读全部 base + 建三段 Map）\n");
    process.stdout.write("   JSONL : 均 " + fmt(loadJsonl.avg) + "（最快 " + fmt(loadJsonl.min) + "）\n");
    process.stdout.write("   SQLite: 均 " + fmt(loadSqlite.avg) + "（最快 " + fmt(loadSqlite.min) + "）\n");
    process.stdout.write("   对比  : SQLite 是 JSONL 的 " + speed(loadJsonl.avg, loadSqlite.avg) + "\n\n");

    process.stdout.write("② 单游戏增量写（" + bigBase + " / " + bigRecs.length + " 条 / 只改 1 条）\n");
    process.stdout.write("   JSONL : 均 " + fmt(wJsonl.avg) + "（最快 " + fmt(wJsonl.min) + "）  写了 " + fmtMB(jsonlFileBytes) + "\n");
    process.stdout.write("   SQLite: 均 " + fmt(wSqlite.avg) + "（最快 " + fmt(wSqlite.min) + "）  WAL 变化 " + fmtMB(Math.max(0, walAfter - walBefore)) + "\n");
    process.stdout.write("   对比  : SQLite 比 JSONL 快 " + speed(wJsonl.avg, wSqlite.avg) + "\n\n");

    process.stdout.write("③ 全库增量写（" + bases.length + " 个 base，各改 1 条）\n");
    process.stdout.write("   JSONL : 均 " + fmt(allJsonl.avg) + "（最快 " + fmt(allJsonl.min) + "）\n");
    process.stdout.write("   SQLite: 均 " + fmt(allSqlite.avg) + "（最快 " + fmt(allSqlite.min) + "）\n");
    process.stdout.write("   对比  : SQLite 比 JSONL 快 " + speed(allJsonl.avg, allSqlite.avg) + "\n\n");

    process.stdout.write("④ 落盘体积\n");
    process.stdout.write("   JSONL 合计 : " + fmtMB(jsonlTotal) + "\n");
    process.stdout.write("   SQLite     : " + fmtMB(dbSize) + "（另有 WAL " + fmtMB(walSize) + "，会自动 checkpoint）\n");
    return 0;
  } finally {
    indexStore.closeDb();
    if (cleanup) {
      try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch (_) {}
    } else {
      process.stdout.write("\n（工作目录保留：" + workRoot + "）\n");
    }
  }
}

process.exitCode = main();
