// test/index-jsonl-parity.test.cjs —— 2026-10-15 新增（索引改 JSONL 的等价性测试）
//
// 目的：证明「旧 JSON 索引」与「新 JSONL 索引」被 hash-index 解析出的三段表**逐键逐值一致**，
//       并证明启动迁移（JSON → JSONL）确实发生、旧文件可回收站找回、迁移后再加载结果不变。
//
// 隔离手法：hash-index 支持 GBMD_JSON_DIR 环境变量指定 json 根目录（hash-index.js:17）——
//   本测试把它指向 os.tmpdir() 下的临时目录，绝不碰项目真实的 json/。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const log = makeLog("index-jsonl-parity");

/** 用临时 json 目录加载一份**全新的** hash-index（清缓存 + 临时环境变量，避免模块级状态串味） */
function freshIndex(jsonDir) {
  const modPath = require.resolve("../server/lib/hash-index.js");
  delete require.cache[modPath];
  const storePath = require.resolve("../server/lib/jsonl-store.js");
  delete require.cache[storePath];
  const oldEnv = process.env.GBMD_JSON_DIR;
  process.env.GBMD_JSON_DIR = jsonDir;
  try {
    return { idx: require(modPath), store: require(storePath) };
  } finally {
    if (oldEnv === undefined) delete process.env.GBMD_JSON_DIR;
    else process.env.GBMD_JSON_DIR = oldEnv;
  }
}

/** 临时 json 目录（含 index/ 子目录），用完整棵删掉 */
function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-index-"));
  fs.mkdirSync(path.join(root, "index"), { recursive: true });
  try { return fn(root); } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
}

/** 一份典型的三段旧索引（取自部署端真实结构：hash→元信息 / hash→本地文件 / 原名→元信息） */
function legacyGame(game) {
  return {
    game,
    gb: {
      h1: { modId: "1", modName: "A", author: "au", game, url: "u1", fileName: "a.zip", gbMd5: "h1" },
      h2: { modId: "2", modName: "B", author: "au", game, url: "u2", fileName: "b.zip", gbMd5: "h2" }
    },
    local: {
      h1: { modDir: "/p/a", file: "a.zip", hash: "h1", gbMd5: "h1", kind: "file", modId: "1" }
    },
    name: {
      "a.zip": { modId: "1", modName: "A", game, fileName: "a.zip", kind: "file" },
      "b.zip": { modId: "2", modName: "B", game, fileName: "b.zip", kind: "file" }
    }
  };
}

loggedTest(log, "启动迁移：只有旧 JSON 时 load() 能读，并把它迁成 .jsonl（旧文件进 .trash）", () => {
  withTmp((root) => {
    const indexDir = path.join(root, "index");
    const legacy = legacyGame("ParityTest");
    fs.writeFileSync(path.join(indexDir, "ParityTest.json"), JSON.stringify(legacy));

    const { idx } = freshIndex(root);
    const r1 = idx.load();

    // ① 读到了数据（三段表规模对得上）
    assert.equal(r1.games, 1, "应加载到 1 个游戏");
    assert.equal(r1.gb, 2);
    assert.equal(r1.local, 1);
    assert.equal(r1.name, 2);

    // ② 迁移确实发生：.jsonl 出现、旧 .json 移入 .trash（可回滚）
    assert.ok(fs.existsSync(path.join(indexDir, "ParityTest.jsonl")), "应产出 .jsonl");
    assert.equal(fs.existsSync(path.join(indexDir, "ParityTest.json")), false, "旧 .json 应已移走");
    const trash = fs.readdirSync(path.join(indexDir, ".trash"));
    assert.equal(trash.length, 1, "旧文件应进 .trash（可恢复）");
    assert.match(trash[0], /ParityTest\.json$/, "回收站里应是原文件名（带时间戳前缀）");
  });
});

loggedTest(log, "双读等价：迁移后再 load()（走 .jsonl）结果与首次（走 .json）逐项一致", () => {
  withTmp((root) => {
    const indexDir = path.join(root, "index");
    fs.writeFileSync(path.join(indexDir, "ParityTest.json"), JSON.stringify(legacyGame("ParityTest")));
    const { idx } = freshIndex(root);

    const before = idx.load();          // 走旧 JSON + 触发迁移
    const after = idx.load();           // 此刻盘上只有 .jsonl
    assert.deepEqual(after, before, "两种格式解析出的索引规模与内容必须一致");

    // 查询行为也一致（本地表优先命中 h1）
    const hit = idx.queryByHash("h1");
    assert.ok(hit, "h1 应能反查到");
    assert.equal(hit.source, "local");
    assert.equal(hit.file, "a.zip");
  });
});

loggedTest(log, "结构等价：.jsonl 还原出的三段条目与旧 JSON 逐键逐值相同", () => {
  withTmp((root) => {
    const indexDir = path.join(root, "index");
    const legacy = legacyGame("ParityTest");
    fs.writeFileSync(path.join(indexDir, "ParityTest.json"), JSON.stringify(legacy));
    const { idx, store } = freshIndex(root);
    idx.load();

    const r = store.readIndex(path.join(indexDir, "ParityTest"));
    assert.equal(r.format, "jsonl");
    assert.equal(r.badLines, 0, "转换不应产生坏行");
    assert.equal(r.meta.game, "ParityTest", "meta 应保留游戏名");
    for (const sec of ["gb", "local", "name"]) {
      const got = [...store.mapOf(r.records, sec).entries()].sort();
      const want = Object.entries(legacy[sec]).sort();
      assert.deepEqual(got, want, sec + " 段必须逐键逐值一致");
    }
  });
});

loggedTest(log, "只有 .jsonl（无旧 JSON）时也能直接加载；空目录加载得到零值不抛错", () => {
  withTmp((root) => {
    const indexDir = path.join(root, "index");
    const { idx, store } = freshIndex(root);

    // 空目录：0 游戏，不抛错
    const empty = idx.load();
    assert.equal(empty.games, 0);
    assert.equal(empty.gb, 0);

    // 直接手写一份 .jsonl（模拟迁移后的部署）
    const recs = [];
    for (const sec of ["gb", "local", "name"]) {
      for (const [k, v] of Object.entries(legacyGame("JsonlOnly")[sec])) recs.push({ t: sec, k, v });
    }
    const w = store.writeIndexAtomic(path.join(indexDir, "JsonlOnly"), { game: "JsonlOnly", schema: 2 }, recs);
    assert.ok(w.ok, "应能写入 .jsonl");
    const r = idx.load();
    assert.equal(r.games, 1);
    assert.equal(r.gb, 2);
    assert.equal(r.name, 2);
  });
});

loggedTest(log, "迁移幂等：已迁移的目录再次 load() 不会重复迁移、不产生新回收站条目", () => {
  withTmp((root) => {
    const indexDir = path.join(root, "index");
    fs.writeFileSync(path.join(indexDir, "ParityTest.json"), JSON.stringify(legacyGame("ParityTest")));
    const { idx } = freshIndex(root);
    idx.load();
    const trashAfterFirst = fs.readdirSync(path.join(indexDir, ".trash")).length;

    const r2 = idx.load();
    assert.equal(r2.games, 1, "第二次加载仍应有该游戏");
    assert.equal(fs.readdirSync(path.join(indexDir, ".trash")).length, trashAfterFirst,
      "第二次不应再产生回收站条目（幂等）");
    assert.ok(fs.existsSync(path.join(indexDir, "ParityTest.jsonl")), ".jsonl 应保持存在");
  });
});
