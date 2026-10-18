// test/hash-index-baseline.test.cjs —— 2026-10-18 新增（索引反查等价性基线回归）
//
// 目的：把 json/index 反查链路 `queryByHash` 的返回**逐字段钉死**。
//   后续「索引改 SQLite」时，只要本测试仍绿，就证明查询语义没变；
//   基线由 scripts/hash-index-baseline.cjs 在**生产数据**上采集（10 万条真实索引），
//   路径已脱敏成 <ROOT_n> 占位符，本测试在临时索引上**离线复现**。
//
// 覆盖：
//   ① 基线完整性：夹具记录的 sha256 必须与内容重算一致（防手改基线、防悄悄放宽）
//   ② queryByHash 逐条等价：gb / local / name 三段样本 + 边界（不存在的 key、带/去后缀）
//   ③ 脱敏合规：夹具内不得残留机器绝对路径（否则既不能入库、换机也复跑不了）
//
// 不覆盖（有意为之，避免假测试）：`searchGb` 的**全库**结果需要 10 万条真实索引才能复现，
//   离线用小样本重算只会得到一个"自己算给自己看"的结论 ⇒ 交给生产机上
//   `node scripts/hash-index-baseline.cjs --json-dir <json> --redact <库根> --verify test/fixtures/hash-index-baseline.json`
//   比对整体指纹。本文件只校验夹具里搜索用例自身自洽（count 与 modIds 数量一致）。
//
// 隔离：临时目录 + GBMD_JSON_DIR（与 test/index-jsonl-parity.test.cjs 同一手法），绝不碰真实 json/。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const log = makeLog("hash-index-baseline");

const FIXTURE = path.join(__dirname, "fixtures", "hash-index-baseline.json");
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

/** 键名递归排序后序列化（与采集脚本同一算法，保证指纹可重算） */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
    return o;
  }
  return v;
}

/** 用临时 json 目录加载一份**全新的** hash-index（清缓存 + 临时环境变量，避免模块级状态串味） */
function freshIndex(jsonDir) {
  const modPath = require.resolve("../server/lib/hash-index.js");
  delete require.cache[modPath];
  const storePath = require.resolve("../server/lib/jsonl-store.js");
  delete require.cache[storePath];
  // 2026-10-18：索引存储层也带模块级状态（打开的库句柄），必须一起清，
  //   否则上一个临时目录的库会残留到下一个用例
  const idxStorePath = require.resolve("../server/lib/index-store.js");
  delete require.cache[idxStorePath];
  const oldEnv = process.env.GBMD_JSON_DIR;
  process.env.GBMD_JSON_DIR = jsonDir;
  try {
    return require(modPath);
  } finally {
    if (oldEnv === undefined) delete process.env.GBMD_JSON_DIR;
    else process.env.GBMD_JSON_DIR = oldEnv;
  }
}

/** 临时 json 目录（含 index/ 子目录），用完整棵删掉 */
function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-hi-baseline-"));
  fs.mkdirSync(path.join(root, "index"), { recursive: true });
  try {
    return fn(root);
  } finally {
    try { require("../server/lib/index-store.js").closeDb(); } catch (_) {}
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
}

/** 把基线里的支撑记录写回成 jsonl 索引文件（保留原文件名，便于对照） */
function writeIndex(indexDir, records) {
  const byFile = new Map();
  for (const r of records) {
    const name = String(r.file || "Baseline.jsonl").replace(/\.json$/, ".jsonl");
    if (!byFile.has(name)) byFile.set(name, []);
    byFile.get(name).push(r);
  }
  for (const [name, rs] of byFile) {
    const text = rs.map((r) => JSON.stringify({ t: r.t, k: r.k, v: r.v })).join("\n") + "\n";
    fs.writeFileSync(path.join(indexDir, name), text, "utf8");
  }
}

loggedTest(log, "基线完整性：夹具 sha256 与内容重算一致（防手改基线）", () => {
  const core = {};
  for (const k of Object.keys(fx)) {
    if (k === "capturedAt" || k === "sha256") continue; // 采集时间不参与指纹
    core[k] = fx[k];
  }
  const recalc = crypto.createHash("sha256").update(JSON.stringify(canonical(core))).digest("hex");
  assert.equal(recalc, fx.sha256, "夹具被改动过：请用 scripts/hash-index-baseline.cjs 重新采集，不要手改");
  assert.equal(fx.queryCount, (fx.queries || []).length, "queryCount 应与 queries 条数一致");
  assert.ok((fx.queries || []).length > 0, "基线不能是空的");
  assert.ok((fx.records || []).length > 0, "基线必须带支撑记录，否则无法离线复现");
});

loggedTest(log, "脱敏合规：夹具内不得出现机器绝对路径", () => {
  const text = fs.readFileSync(FIXTURE, "utf8");
  assert.equal(/\/volume[0-9]/.test(text), false, "不得残留 /volumeN 这类本机路径");
  assert.equal(/([A-Za-z]:\\\\)/.test(text), false, "不得残留 Windows 盘符路径");
  // 所有路径类字段必须是占位符开头（<ROOT_n>）或纯相对（图片名/压缩包名）
  const bad = (fx.queries || []).filter((q) => {
    const md = q.expect && q.expect.modDir;
    return typeof md === "string" && md !== "" && md.charAt(0) === "/";
  });
  assert.equal(bad.length, 0, "modDir 必须是 <ROOT_n>/... 形式，实际出现了绝对路径：" + JSON.stringify(bad.slice(0, 2)));
});

loggedTest(log, "queryByHash 逐条等价：三段样本命中结果与基线逐字段一致", () => {
  withTmp((root) => {
    writeIndex(path.join(root, "index"), fx.records || []);
    const idx = freshIndex(root);
    idx.load();

    let checked = 0;
    let hits = 0;
    for (const q of fx.queries || []) {
      const got = idx.queryByHash(q.input) || null;
      assert.deepEqual(got, q.expect || null, "key=" + q.input + "（段=" + q.t + "）的返回与基线不一致");
      checked++;
      if (got) hits++;
    }
    assert.equal(checked, (fx.queries || []).length, "所有基线用例都要跑到");
    assert.ok(hits > 0, "基线若一条都没命中，等于没测到反查语义");
  });
});

loggedTest(log, "queryByHash 边界：不存在的 key 必须返回 null，短名/带后缀互查一致", () => {
  withTmp((root) => {
    writeIndex(path.join(root, "index"), fx.records || []);
    const idx = freshIndex(root);
    idx.load();

    assert.equal(idx.queryByHash("00000000000000000000000000000000"), null, "全 0 hash 不应命中");
    assert.equal(idx.queryByHash(""), null, "空 key 不应命中");

    // 从基线里取一条「name 段」样本，验证带后缀/去后缀双向可命中（2026-10-11 的 stemIndex 修复）
    const nameQ = (fx.queries || []).find((q) => q.t === "name" && q.expect && /\.[a-z0-9]{2,5}$/i.test(q.input));
    if (nameQ) {
      const withExt = nameQ.input;
      const noExt = withExt.replace(/\.[a-z0-9]{2,5}$/i, "");
      if (noExt !== withExt) {
        const a = idx.queryByHash(withExt);
        const b = idx.queryByHash(noExt);
        assert.ok(a, "带后缀应能命中：" + withExt);
        assert.ok(b, "去后缀也应能命中（stemIndex）：" + noExt);
        assert.equal(String(b.modId || ""), String(a.modId || ""), "带/去后缀应命中同一条记录");
      }
    }
  });
});

loggedTest(log, "搜索用例自洽：count 与 modIds 数量一致（全库结果由生产机 --verify 保证）", () => {
  for (const s of fx.searches || []) {
    assert.equal(s.modIds.length, s.count, "q=" + s.q + " 的 count 与 modIds 数量不一致");
    const uniq = new Set(s.modIds);
    assert.equal(uniq.size, s.modIds.length, "q=" + s.q + " 的 modIds 应已按 modId 去重");
  }
  assert.ok((fx.searches || []).length > 0, "基线应至少带几条搜索用例");
});
