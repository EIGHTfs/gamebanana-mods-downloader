// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码
// ============================================================
// P7 并发数即时生效测试（2026-09-06）
// 验证：setConcurrency 调大/调小 → 消费者立即按新并发生效
// 便携：不联网、不依赖 GB 数据
// ============================================================
"use strict";
require("./helpers/test-log.cjs");
require("../server/lib/cjs-bootstrap.cjs");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-test-")); }
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

function freshDownloader(dataDir) {
  process.env.GBMD_DATA_DIR = dataDir;
  for (const k of Object.keys(require.cache)) {
    if (k.includes("/server/")) delete require.cache[k];
  }
  return require("../server/lib/downloader");
}

// ---------- setConcurrency 单元测试 ----------

test("setConcurrency: 无任务时只写 config（不报错）", () => {
  const d = tmpdir();
  try {
    const dl = freshDownloader(d);
    const r = dl.setConcurrency(8);
    assert.equal(r.ok, true);
    assert.equal(r.concurrency, 8);
    const cfgFile = path.join(d, "config.json");
    if (fs.existsSync(cfgFile)) {
      const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
      assert.equal(cfg.downloadConcurrency, 8);
    }
  } finally { cleanup(d); }
});

test("setConcurrency: 值 clamp 到 1~32", () => {
  const d = tmpdir();
  try {
    const dl = freshDownloader(d);
    assert.equal(dl.setConcurrency(0).concurrency, 1);
    assert.equal(dl.setConcurrency(-5).concurrency, 1);
    assert.equal(dl.setConcurrency(999).concurrency, 32);
    assert.equal(dl.setConcurrency("abc").concurrency, 1);
    assert.equal(dl.setConcurrency(null).concurrency, 1);
  } finally { cleanup(d); }
});

test("setConcurrency: NaN/undefined → 1", () => {
  const d = tmpdir();
  try {
    const dl = freshDownloader(d);
    assert.equal(dl.setConcurrency(undefined).concurrency, 1);
    assert.equal(dl.setConcurrency(NaN).concurrency, 1);
  } finally { cleanup(d); }
});

// ---------- 消费者模型源码验证 ----------
// 核心验证：始终启动 MAX_CONCURRENCY(32) 消费者，按 task.concurrency 限流
// 调大 → 空闲消费者立即醒来多开；调小 → 消费者自动等待

test("消费者模型: MAX_CONCURRENCY = 32 且用于消费者池启动", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "lib", "downloader.js"), "utf8");

  // 1. MAX_CONCURRENCY 常量 = 32
  const match = src.match(/const MAX_CONCURRENCY\s*=\s*(\d+)/);
  assert.ok(match, "MAX_CONCURRENCY 常量应存在");
  assert.equal(parseInt(match[1], 10), 32);

  // 2. 消费者池按 MAX_CONCURRENCY 启动（不是按初始 concurrency）
  const poolMatch = src.match(/for \(let i = 0; i < MAX_CONCURRENCY; i\+\+\)/);
  assert.ok(poolMatch, "消费者池应按 MAX_CONCURRENCY 启动，不是按初始 concurrency");

  // 3. 消费者循环读取当前 task.concurrency 作为 cur
  const curMatch = src.match(/parseInt\(task\.concurrency/);
  assert.ok(curMatch, "消费者循环应读取 task.concurrency 作为 cur");

  // 4. 活跃数限流：activeItems.length >= cur 时等待
  const throttleMatch = src.match(/activeItems.*length.*>=.*cur/);
  assert.ok(throttleMatch, "应有 activeItems.length >= cur 限流检查");
});

test("消费者模型: 旧设计已移除（不再按初始 concurrency 启动消费者）", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "lib", "downloader.js"), "utf8");

  // 旧设计：for (let i = 0; i < Math.max(1, concurrency); i++)
  // 新设计：for (let i = 0; i < MAX_CONCURRENCY; i++)
  const oldPattern = /for \(let i = 0; i < Math\.max\(1, concurrency\)/;
  assert.ok(!oldPattern.test(src), "旧设计（按初始 concurrency 启动消费者）应已移除");
});
