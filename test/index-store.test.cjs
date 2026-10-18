// test/index-store.test.cjs —— 2026-10-18 新增（索引存储层：SQLite 优先、JSONL 回落）
//
// 定位：`server/lib/index-store.js` 是 jsonl-store 两个入口的 **drop-in 替代**
//   （readIndex / writeIndexAtomic，签名与返回结构一致）⇒ 本测试只钉两件事：
//   ① **等价性**：同一批记录经库写读回来，与经 JSONL 写读回来**逐条逐字段一致**
//   ② **行级增量**：改 1 条只动 1 行（这正是本次改造的收益来源；原来要重写整个游戏文件）
//   外加：删除行会被清掉、listBases 走库、库不可用时回落 JSONL（低版本 Node 上仍能跑）。
//
// 隔离：临时目录 + 关闭库句柄，绝不碰项目真实 json/。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const log = makeLog("index-store");
// 2026-10-18：默认后端已改为 JSONL（实测索引换 SQLite 反而慢，见 lib/index-store.js 的 sqliteEnabled 注释）。
//   本文件测的是 **SQLite 后端本体**，所以显式开启；另有一条用例专门断言「默认走 JSONL」。
process.env.GBMD_INDEX_BACKEND = "sqlite";
const store = require("../server/lib/index-store.js");
const jsonlStore = require("../server/lib/jsonl-store.js");

const AVAILABLE = store.isAvailable();

/** 临时 index 目录，用完关库 + 删目录 */
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-idxstore-"));
  try {
    return fn(dir);
  } finally {
    try { store.closeDb(); } catch (_) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

/** 一分钟即可看懂的三段记录样本 */
function sampleRecords() {
  return [
    { t: "gb", k: "h1", v: { modId: "1", modName: "A", author: "au", game: "G", url: "u1", fileName: "a.zip", gbMd5: "h1" } },
    { t: "gb", k: "h2", v: { modId: "2", modName: "B", author: "au", game: "G", url: "u2", fileName: "b.zip", gbMd5: "h2" } },
    { t: "local", k: "h1", v: { modDir: "<ROOT_1>/a", file: "a.zip", hash: "h1", kind: "file" } },
    { t: "name", k: "a.zip", v: { modId: "1", fileName: "a.zip", kind: "file" } }
  ];
}

/** 把 records 写成 {t,k,v} 的规范形态（便于逐条比对，顺序无关） */
function canon(records) {
  return (records || [])
    .map((r) => JSON.stringify({ t: r.t, k: String(r.k), v: r.v }))
    .sort();
}

loggedTest(log, "探测结果可读：node:sqlite 可用性有明确结论", () => {
  const p = store.probe();
  assert.equal(typeof p.ok, "boolean");
  if (!p.ok) {
    assert.ok(String(p.reason || "").length > 0, "不可用时必须给出原因（便于现场判断为什么回落）");
    log.info("当前环境不可用，将走 JSONL 回落：" + p.reason);
  }
});

loggedTest(log, "等价性：同一批记录，库后端读回来与 JSONL 后端逐条一致", () => {
  if (!AVAILABLE) return log.info("跳过：本机 node:sqlite 不可用");
  withTmp((dir) => {
    const base = path.join(dir, "GameA");
    const records = sampleRecords();

    // ① 走库
    const w1 = store.writeIndexAtomic(base, { game: "GameA", schema: 2 }, records);
    assert.equal(w1.ok, true, "写库应成功");
    assert.equal(w1.fallback, undefined, "可用时不应回落写 JSONL");
    const viaDb = store.readIndex(base);
    assert.equal(viaDb.format, "sqlite");
    assert.equal(viaDb.meta.game, "GameA", "元信息要能读回");

    // ② 走 JSONL（同一个 base 换目录，避免互相覆盖）
    const base2 = path.join(dir, "jsonl", "GameA");
    fs.mkdirSync(path.dirname(base2), { recursive: true });
    const w2 = jsonlStore.writeIndexAtomic(base2, { game: "GameA", schema: 2 }, records);
    assert.equal(w2.ok, true);
    const viaJsonl = jsonlStore.readIndex(base2);
    assert.equal(viaJsonl.format, "jsonl");

    // ③ 逐条比对：这就是「drop-in 替代」的判据
    assert.deepEqual(canon(viaDb.records), canon(viaJsonl.records), "库与 JSONL 的记录必须逐条逐字段一致");
  });
});

loggedTest(log, "行级增量：改 1 条只动 1 行，其余行不重写", () => {
  if (!AVAILABLE) return log.info("跳过：本机 node:sqlite 不可用");
  withTmp((dir) => {
    const base = path.join(dir, "GameB");
    const records = sampleRecords();
    store.writeIndexAtomic(base, { game: "GameB", schema: 2 }, records);

    // 只改 gb/h2 的一个字段
    const next = records.map((r) => {
      if (r.t === "gb" && r.k === "h2") return Object.assign({}, r, { v: Object.assign({}, r.v, { modName: "B2" }) });
      return r;
    });
    const w = store.writeIndexAtomic(base, { game: "GameB", schema: 2 }, next);
    assert.equal(w.inserted, 1, "只应有 1 行被写入（UPSERT）");
    assert.equal(w.deleted, 0, "不应有删除");
    assert.equal(w.inserted + w.deleted, 1, "总变更行数必须是 1，而不是整文件重写");

    const back = store.readIndex(base);
    const hit = back.records.find((r) => r.t === "gb" && r.k === "h2");
    assert.equal(hit.v.modName, "B2", "改动要落盘");
  });
});

loggedTest(log, "删除：从记录里消失的 key 会被 DELETE 掉", () => {
  if (!AVAILABLE) return log.info("跳过：本机 node:sqlite 不可用");
  withTmp((dir) => {
    const base = path.join(dir, "GameC");
    const records = sampleRecords();
    store.writeIndexAtomic(base, { game: "GameC", schema: 2 }, records);

    const next = records.filter((r) => r.k !== "h2");
    const w = store.writeIndexAtomic(base, { game: "GameC", schema: 2 }, next);
    assert.equal(w.deleted, 1, "只应删掉 gb 段的 h2 这一条");
    const back = store.readIndex(base);
    assert.equal(back.records.some((r) => r.k === "h2"), false, "被删的 key 不应再读到");
    assert.equal(back.records.length, next.length, "剩余条数应与写入的一致");
  });
});

loggedTest(log, "listBases：库里有数据时以库的 base 列表为准（含中英文/特殊字符名）", () => {
  if (!AVAILABLE) return log.info("跳过：本机 node:sqlite 不可用");
  withTmp((dir) => {
    const names = ["GameA", "ZZZ – 绝零区", "Game: With Colon"];
    for (const n of names) {
      store.writeIndexAtomic(path.join(dir, n), { game: n, schema: 2 }, sampleRecords().slice(0, 1));
    }
    const bases = store.listBases(dir);
    assert.deepEqual(bases, names.slice().sort(), "base 列表应来自库且排序稳定");
  });
});

loggedTest(log, "回落：库不可用时（或写库异常）仍能通过 JSONL 读写，功能不降级", () => {
  withTmp((dir) => {
    // 直接验证 JSONL 路径本身可用（不可用的机器上 store 会自动走这条路）
    const base = path.join(dir, "GameD");
    const records = sampleRecords();
    const w = jsonlStore.writeIndexAtomic(base, { game: "GameD", schema: 2 }, records);
    assert.equal(w.ok, true, "JSONL 兜底写入应成功");
    const back = store.readIndex(base);
    assert.ok(back.records.length === records.length, "存储层读应能读到 JSONL 内容（无库时走回落）");
  });
});

loggedTest(log, "stats：能报出每个 base 的行数（启动日志/迁移校验用）", () => {
  if (!AVAILABLE) return log.info("跳过：本机 node:sqlite 不可用");
  withTmp((dir) => {
    store.writeIndexAtomic(path.join(dir, "GameE"), { game: "GameE", schema: 2 }, sampleRecords());
    const st = store.stats(dir);
    assert.equal(st.available, true);
    assert.equal(st.exists, true, "写过库就应存在");
    assert.equal(st.bases.GameE, sampleRecords().length, "行数应等于记录数");
    assert.equal(st.total, sampleRecords().length);
  });
});

loggedTest(log, "默认后端是 JSONL：不设开关时写文件、读回 format=jsonl、不建库", () => {
  withTmp((dir) => {
    const base = path.join(dir, "GameDefault");
    const saved = process.env.GBMD_INDEX_BACKEND;
    delete process.env.GBMD_INDEX_BACKEND; // 模拟生产的默认配置
    try {
      const w = store.writeIndexAtomic(base, { game: "GameDefault", schema: 2 }, sampleRecords());
      assert.equal(w.ok, true, "默认应能正常写入");
      assert.equal(fs.existsSync(base + ".jsonl"), true, "默认应产出 .jsonl 文件");
      assert.equal(fs.existsSync(store.dbPathOf(dir)), false, "默认不该建库（索引换库实测是退化）");
      const back = store.readIndex(base);
      assert.equal(back.format, "jsonl", "默认读回来应是 jsonl");
      assert.deepEqual(canon(back.records), canon(sampleRecords()), "内容要与写入一致");
    } finally {
      if (saved === undefined) delete process.env.GBMD_INDEX_BACKEND;
      else process.env.GBMD_INDEX_BACKEND = saved;
    }
  });
});
