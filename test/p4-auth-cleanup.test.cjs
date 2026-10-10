// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码；测试用 mock 凭据非真实凭据
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
// 2026-10-11 修：json-dir 已迁 server/store/、auth 模块实际文件是 server/auth/auth.js
delete require.cache[require.resolve("../server/store/json-dir")];
delete require.cache[require.resolve("../server/auth/auth")];

const auth = require("../server/auth/auth");
const fsAsync = require("../server/http/fs-async");

test.after(() => {
  auth.stopCleanup();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GBMD_DATA_DIR;
});

// 2026-10-11 重写：模板化后 auth 换成框架版，API 与旧版不同——
//   · 没有 auth.sessions 导出（用 loadSessions() 取当前条数）
//   · createSession({ hours }) 同步返回 { token }（旧写法 createSession(72) 返回裸 token）
//   · 清理方法名是 pruneExpired（旧名 cleanupExpired）；isValidSession/destroySession 同步
//   断言统一用「相对条数」，避免用例间共享内存会话导致相互污染。
test("P4 auth: pruneExpired 删除过期 session", () => {
  auth.init({ sessionFile: path.join(TEST_DIR, "sessions.json"), cookieName: "gbmd_test_session" });
  const expired = auth.createSession({ hours: -1 });   // 负数小时 → expiresAt 已是过去
  const valid = auth.createSession({ hours: 1 });
  const before = auth.loadSessions();

  const removed = auth.pruneExpired();
  assert.equal(removed, 1, "应清掉 1 个过期会话");
  assert.equal(auth.loadSessions(), before - 1);
  assert.equal(auth.isValidSession(valid.token), true, "有效会话必须保留");
  assert.equal(auth.isValidSession(expired.token), false, "过期会话必须失效");
});

test("P4 auth: pruneExpired 无过期时返回 0", () => {
  auth.createSession({ hours: 1 });
  assert.equal(auth.pruneExpired(), 0);
});

test("P4 auth: startCleanup/stopCleanup 管理 timer", () => {
  const timer = auth.startCleanup(60000);
  assert.ok(timer && typeof timer === "object", "startCleanup 返回 timer 对象");
  auth.stopCleanup();
  // stopCleanup 后 timer 已清除（不阻塞测试进程退出）
});

test("P4 auth: createSession 返回 64 位 hex token 并写入磁盘", () => {
  const sessionFile = path.join(TEST_DIR, "sessions-create.json");
  auth.init({ sessionFile, cookieName: "gbmd_test_session" });
  const { token } = auth.createSession({ hours: 72 });
  assert.ok(token && token.length === 64, "token 为 64 位 hex");
  assert.equal(auth.isValidSession(token), true);
  assert.equal(fs.existsSync(sessionFile), true, "会话文件已写入磁盘");
  const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  assert.ok(saved[token] && saved[token].expiresAt > Date.now(), "落盘内容含该 token 且未过期");
});

test("P4 auth: isValidSession 过期 token 返回 false 并删除", () => {
  const { token } = auth.createSession({ hours: -1 });
  const before = auth.loadSessions();
  assert.equal(auth.isValidSession(token), false);
  assert.equal(auth.loadSessions(), before - 1, "失效会话应被删除");
});

test("P4 auth: destroySession 删除并写盘", () => {
  const sessionFile = path.join(TEST_DIR, "sessions-destroy.json");
  auth.init({ sessionFile, cookieName: "gbmd_test_session" });
  const { token } = auth.createSession({ hours: 1 });
  const before = auth.loadSessions();
  auth.destroySession(token);
  assert.equal(auth.loadSessions(), before - 1);
  const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  assert.equal(saved[token], undefined, "落盘文件里已无该 token");
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
