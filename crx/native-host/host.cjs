"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const PROJECT_DIR = process.env.GAMEBANANA_MODS_DOWNLOADER_CRX_DIR || path.join(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config.json");
const MAPPING_DIR = path.join(PROJECT_DIR, "mapping");

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (_) {}
  return {};
}
function writeConfig(obj) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), "utf8");
}

let buf = Buffer.alloc(0);
const waiters = [];
process.stdin.on("data", (chunk) => { buf = Buffer.concat([buf, chunk]); pump(); });
function pump() {
  while (waiters.length) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const body = buf.slice(4, 4 + len).toString("utf8");
    buf = buf.slice(4 + len);
    waiters.shift().resolve(body);
  }
}
function readMessage() {
  return new Promise((resolve) => { waiters.push({ resolve }); pump(); });
}
function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function safeMappingName(name) {
  const base = path.basename(String(name || "")).replace(/[^A-Za-z0-9._ \-\u4e00-\u9fff]/g, "");
  if (!base.toLowerCase().endsWith(".json")) return "";
  if (base.includes("..")) return "";
  return base;
}

function listMapping() {
  fs.mkdirSync(MAPPING_DIR, { recursive: true });
  return fs.readdirSync(MAPPING_DIR).filter((n) => n.toLowerCase().endsWith(".json"));
}

function writeMappingFile(name, text) {
  const n = safeMappingName(name);
  if (!n) throw new Error("非法文件名");
  JSON.parse(text);
  fs.mkdirSync(MAPPING_DIR, { recursive: true });
  fs.writeFileSync(path.join(MAPPING_DIR, n), text, "utf8");
  return n;
}

function deleteMappingFile(name) {
  const n = safeMappingName(name);
  if (!n) throw new Error("非法文件名");
  const p = path.join(MAPPING_DIR, n);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return n;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function downloadFile(url, destPath, cookie) {
  destPath = String(destPath || "");
  ensureDir(path.dirname(destPath));
  const tmp = destPath + ".part";
  return new Promise((resolve, reject) => {
    function go(u, left) {
      const mod = u.startsWith("https:") ? https : http;
      const headers = {
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
        Referer: "https://gamebanana.com/"
      };
      if (cookie) headers.Cookie = cookie;
      const req = mod.get(u, { headers, timeout: 120000 }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) return reject(new Error("重定向过多"));
          return go(new URL(res.headers.location, u).toString(), left - 1);
        }
        if (code >= 400) { res.resume(); return reject(new Error("HTTP " + code)); }
        const file = fs.createWriteStream(tmp);
        res.pipe(file);
        res.on("end", () => file.close(() => {
          fs.renameSync(tmp, destPath);
          resolve({ ok: true, path: destPath });
        }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
    }
    go(url, 8);
  });
}

async function main() {
  process.stdin.on("end", () => process.exit(0));
  while (true) {
    let raw;
    try { raw = await readMessage(); } catch (_) { process.exit(0); }
    let msg;
    try { msg = JSON.parse(raw); } catch (_) {
      sendMessage({ type: "error", error: "invalid json" });
      continue;
    }
    const rid = msg.requestId;
    try {
      if (msg.type === "ping") sendMessage({ requestId: rid, type: "pong" });
      else if (msg.type === "readConfig") sendMessage({ requestId: rid, type: "config", config: readConfig() });
      else if (msg.type === "writeConfig") {
        writeConfig(msg.config || {});
        sendMessage({ requestId: rid, type: "configWritten" });
      } else if (msg.type === "listMapping") {
        sendMessage({ requestId: rid, type: "mappingList", files: listMapping() });
      } else if (msg.type === "writeMappingFile") {
        const n = writeMappingFile(msg.name, msg.text);
        sendMessage({ requestId: rid, type: "mappingWritten", name: n });
      } else if (msg.type === "deleteMappingFile") {
        const n = deleteMappingFile(msg.name);
        sendMessage({ requestId: rid, type: "mappingDeleted", name: n });
      } else if (msg.type === "download") {
        const r = await downloadFile(msg.url, msg.path, msg.cookie);
        sendMessage(Object.assign({ requestId: rid, type: "downloaded" }, r));
      } else if (msg.type === "selectFolder") {
        sendMessage({ requestId: rid, type: "folder", path: "", error: "headless: 无文件夹对话框" });
      } else {
        sendMessage({ requestId: rid, type: "error", error: "unknown " + msg.type });
      }
    } catch (e) {
      sendMessage({ requestId: rid, type: "error", error: e.message || String(e) });
    }
  }
}

main();
