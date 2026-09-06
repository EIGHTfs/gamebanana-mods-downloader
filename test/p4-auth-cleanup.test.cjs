// ============================================================
// P4 测试：auth 清过期 token + fs-async 工具
// ============================================================
"use strict";
require("./helpers/test-log.cjs");

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

// 隔离测试目录（不污染真实 json/）
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-p4-"));
process.env.GBMD_DATA_DIR = TEST_DIR;

// 清除 require 缓存，让 auth.js 用新的 GBMD_DATA_DIR
delete require.cache[require.resolve("../server/lib/json-dir")];
delete require.cache[require.resolve("../server/auth")];

const auth = require("../server/auth");
const fsAsync = require("../server/utils/fs-async");

test.after(() => {
  auth.stopCleanup();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GBMD_DATA_DIR;
});

test("P4 auth: cleanupExpired 删除过期 session", async () => {
  // 插入一个已过期的 session（expiresAt = 过去）
  auth.sessions.set("expired-token", { expiresAt: Date.now() - 1000 });
  // 插入一个有效 session
  auth.sessions.set("valid-token", { expiresAt: Date.now() + 3600 * 1000 });

  const removed = await auth.cleanupExpired();
  assert.equal(removed, 1);
  assert.equal(auth.sessions.has("expired-token"), false);
  assert.equal(auth.sessions.has("valid-token"), true);
});

test("P4 auth: cleanupExpired 无过期时返回 0", async () => {
  auth.sessions.clear();
  auth.sessions.set("valid-token", { expiresAt: Date.now() + 3600 * 1000 });

  const removed = await auth.cleanupExpired();
  assert.equal(removed, 0);
  assert.equal(auth.sessions.has("valid-token"), true);
});

test("P4 auth: startCleanup/stopCleanup 管理 timer", async () => {
  auth.sessions.clear();

  const timer = auth.startCleanup(60000);
  assert.ok(timer && typeof timer === "object", "startCleanup 返回 timer 对象");

  auth.stopCleanup();
  // stopCleanup 后 timer 已清除（不阻塞测试）
});

test("P4 auth: createSession 异步返回 token 并写入磁盘", async () => {
  auth.sessions.clear();
  const token = await auth.createSession(72);
  assert.ok(token && token.length === 64, "token 为 64 位 hex");
  assert.equal(auth.sessions.has(token), true);
  // 验证写盘
  const sessionFile = path.join(TEST_DIR, "..", "json", "sessions.json");
  assert.equal(fs.existsSync(sessionFile), true, "sessions.json 已写入磁盘");
});

test("P4 auth: isValidSession 过期 token 返回 false 并删除", async () => {
  auth.sessions.set("expired-token", { expiresAt: Date.now() - 1000 });
  const valid = await auth.isValidSession("expired-token");
  assert.equal(valid, false);
  assert.equal(auth.sessions.has("expired-token"), false);
});

test("P4 auth: destroySession 异步删除并写盘", async () => {
  auth.sessions.clear();
  await auth.createSession(72);
  const token = auth.sessions.keys().next().value;
  await auth.destroySession(token);
  assert.equal(auth.sessions.has(token), false);
});

test("P4 fs-async: readJson/writeJson 往返", async () => {
  const file = path.join(TEST_DIR, "test-data.json");
  const data = { name: "gbmd", version: "4.7.1", items: [1, 2, 3] };
  await fsAsync.writeJson(file, data);
  const read = await fsAsync.readJson(file, null);
  assert.deepEqual(read, data);
});

test("P4 fs-async: readJson 文件不存在返回 fallback", async () => {
  const read = await fsAsync.readJson("/nonexistent/path.json", { default: true });
  assert.deepEqual(read, { default: true });
});

test("P4 fs-async: exists 检查", async () => {
  const file = path.join(TEST_DIR, "exists-test.txt");
  assert.equal(await fsAsync.exists(file), false);
  await fsAsync.writeText(file, "hello");
  assert.equal(await fsAsync.exists(file), true);
});

test("P4 fs-async: readText/writeText 往返", async () => {
  const file = path.join(TEST_DIR, "test.txt");
  await fsAsync.writeText(file, "hello world");
  const txt = await fsAsync.readText(file);
  assert.equal(txt, "hello world");
});

test("P4 fs-async: readdir 空目录返回 []", async () => {
  const dirs = await fsAsync.readdir(TEST_DIR);
  assert.ok(Array.isArray(dirs));
});
