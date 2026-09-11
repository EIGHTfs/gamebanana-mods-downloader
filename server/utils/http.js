// ============================================================
// gbmd - HTTP 工具（P1 从 app.js 抽出）
// sendJson：统一 JSON 响应；readBody：流式读请求体（bug#3 修复：chunk 落临时文件，
//   不累积内存，避免大 body O(n²) 字符串拼接与 512MB OOM）
// parseCredentialText / cleanCookie：cookie 脏值清洗（bug#6 写读边界 unwrap）
// ============================================================
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 请求体大小限制：10MB

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req, limit = BODY_SIZE_LIMIT) {
  return new Promise((resolve, reject) => {
    const tmpPath = path.join(os.tmpdir(), "gbmd-body-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2));
    const ws = fs.createWriteStream(tmpPath);
    let size = 0;
    let settled = false;
    let draining = false;
    const cleanup = () => fs.unlink(tmpPath, () => {});
    const fail = (err) => {
      if (settled) return;
      settled = true;
      ws.destroy();
      cleanup();
      reject(err);
    };
    ws.on("error", fail);
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        settled = true;
        ws.destroy();
        cleanup();
        req.destroy();
        reject(new Error("请求体过大"));
        return;
      }
      const ok = ws.write(c);
      if (!ok && !draining) {
        draining = true;
        req.pause();
        ws.once("drain", () => { draining = false; req.resume(); });
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      ws.end(() => {
        fs.readFile(tmpPath, "utf8", (err, data) => {
          cleanup();
          if (err) return reject(err);
          try { resolve(data ? JSON.parse(data) : {}); }
          catch (e) { reject(new Error("无效的 JSON")); }
        });
      });
    });
    req.on("error", fail);
  });
}

// 解析油猴/手填组合文本 "Cookie=xxx\nyyy" → 纯 cookie；非组合文本返回 null
function parseCredentialText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const m = text.split(/\r?\n/).find((l) => l.startsWith("Cookie="));
  if (!/(^|\n)(Cookie)=/.test("\n" + text)) return null;
  return { cookie: m ? m.slice("Cookie=".length).trim() : "" };
}

// cookie 脏值清洗（bug#6）：写/读边界统一 unwrap 为纯串
// 兼容三种脏形态：组合文本 "Cookie=xxx\nyyy"、JSON 串 '{"cookie":"xxx"}'、纯串
function cleanCookie(raw) {
  if (raw === undefined || raw === null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const combo = parseCredentialText(s);
  if (combo) return combo.cookie || "";
  if (s.startsWith("{")) {
    try { const o = JSON.parse(s); if (o && typeof o.cookie === "string") return o.cookie.trim(); } catch (_) { /* JSON 解析失败，回退返回原始字符串 */ }
  }
  return s;
}

module.exports = { sendJson, readBody, parseCredentialText, cleanCookie };
