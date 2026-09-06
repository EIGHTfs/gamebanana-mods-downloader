// ============================================================
// gbmd-v3 - 鉴权（零依赖，自旧项目保留）
// 密码 scrypt 哈希存储；登录成功签发随机 session token
// 存内存 Map + HttpOnly Cookie；持久化 session 到磁盘（重启免登录）
// ============================================================
"use strict";

const crypto = require("crypto");
const path = require("path");
const fsAsync = require("./utils/fs-async");

const jsonDir = require("./lib/json-dir");
const SESSION_FILE = jsonDir.migrateRuntimeJson("sessions.json");
const sessions = new Map(); // token -> { expiresAt }

async function loadSessions() {
  try {
    const exists = await fsAsync.exists(SESSION_FILE);
    if (!exists) return;
    const data = await fsAsync.readJson(SESSION_FILE, {});
    const now = Date.now();
    for (const [token, s] of Object.entries(data)) {
      if (s.expiresAt > now) sessions.set(token, { expiresAt: s.expiresAt });
    }
  } catch (_) {}
}

async function saveSessions() {
  const data = {};
  for (const [token, s] of sessions) data[token] = { expiresAt: s.expiresAt };
  try {
    await fsAsync.writeJson(SESSION_FILE, data);
  } catch (_) {}
}

async function createSession(hours) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + (hours || 72) * 3600 * 1000;
  sessions.set(token, { expiresAt });
  await saveSessions();
  return token;
}

async function isValidSession(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    await saveSessions();
    return false;
  }
  return true;
}

async function destroySession(token) {
  if (token) sessions.delete(token);
  await saveSessions();
}

function extractToken(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? m[1] : null;
}

/**
 * 清理过期 session（内存 + 磁盘）
 * 返回删除数量
 */
async function cleanupExpired() {
  const now = Date.now();
  let removed = 0;
  for (const [token, s] of sessions) {
    if (s.expiresAt <= now) {
      sessions.delete(token);
      removed++;
    }
  }
  if (removed > 0) {
    await saveSessions();
    console.log(`[auth] 清理 ${removed} 个过期 session`);
  }
  return removed;
}

let cleanupTimer = null;

/**
 * 启动定期清理（默认每小时）
 * 返回 timer 引用以便测试停止
 */
function startCleanup(intervalMs) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  const ms = intervalMs || 3600 * 1000; // 1 小时
  cleanupTimer = setInterval(async () => { await cleanupExpired(); }, ms);
  cleanupTimer.unref(); // 不阻止进程退出
  return cleanupTimer;
}

function stopCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

module.exports = {
  loadSessions,
  createSession,
  isValidSession,
  destroySession,
  extractToken,
  cleanupExpired,
  startCleanup,
  stopCleanup,
  sessions // 测试用
};
