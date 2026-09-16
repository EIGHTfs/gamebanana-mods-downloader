// ============================================================
// data-backup.js —— 用户数据备份/恢复
//   导出：按源码 //userdata-manifest.json 注释生成清单 → 打包 zip
//   导入：上传 zip → 按清单白名单校验路径 → 解压写回
//   清单生成由 framework/marker-manifest 统一提供（与自动更新的运行态清单同一套逻辑）
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile, execFileSync } = require("child_process");
const { markerManifest } = require("../framework");

const jsonDir = require("./json-dir");
const APP_ROOT = path.join(__dirname, "..", "..");
const APP_NAME = "gamebanana-mods-downloader";
const MANIFEST_FILE = jsonDir.jsonFile("userdata-manifest.json");

const toolCache = new Map();

// 探测 tool/bin 下的二进制在本机能否执行（群晖专用 zip 依赖 libsynosdk.so.7，
// 非群晖系统会报共享库缺失 → 回退系统 PATH 的 zip/unzip）
function toolUsable(local) {
  if (toolCache.has(local)) return toolCache.get(local);
  let ok = false;
  try {
    execFileSync(local, ["-v"], { stdio: "ignore", timeout: 3000 });
    ok = true;
  } catch (_) {
    ok = false;
  }
  toolCache.set(local, ok);
  return ok;
}

function findTool(name) {
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const e of exts) {
    const local = path.join(APP_ROOT, "tool", "bin", name + e);
    if (fs.existsSync(local) && toolUsable(local)) return local;
  }
  return name; // 回退系统 PATH
}
const ZIP_BIN = () => findTool("zip");
const UNZIP_BIN = () => findTool("unzip");

function buildManifest() {
  // 清单生成统一走 framework/marker-manifest（与 auto-update 的运行态清单同一套扫描）
  const m = markerManifest.buildManifest({
    root: APP_ROOT,
    json: "userdata-manifest.json",
    app: APP_NAME,
  });
  // 导出清单自身不入包（避免自引用）
  m.files = m.files.filter((f) => f.rel !== "json/userdata-manifest.json");
  return m;
}

function writeManifest(m) {
  jsonDir.ensureJsonDir();
  const tmp = MANIFEST_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, MANIFEST_FILE);
  return m;
}

function generateManifest() {
  return writeManifest(buildManifest());
}

function readManifest() {
  try {
    if (fs.existsSync(MANIFEST_FILE)) {
      const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
      if (m && m.schema === 1) return m;
    }
  } catch (_) {}
  return generateManifest();
}

function collectFiles(mOpt) {
  const m = mOpt || readManifest();
  const files = [];
  for (const f of m.files || []) {
    const abs = path.join(APP_ROOT, f.rel);
    if (fs.existsSync(abs)) files.push(f.rel);
  }
  for (const d of m.dirs || []) {
    const dirAbs = path.join(APP_ROOT, d.rel);
    if (!fs.existsSync(dirAbs)) continue;
    let names;
    try { names = fs.readdirSync(dirAbs); } catch (_) { continue; }
    for (const n of names) {
      if (d.suffix && !n.endsWith(d.suffix)) continue;
      const abs = path.join(dirAbs, n);
      try {
        if (fs.statSync(abs).isFile()) files.push(d.rel + "/" + n);
      } catch (_) {}
    }
  }
  files.sort();
  return files;
}

function exportZip() {
  const m = generateManifest();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-backup-"));
  const zipPath = path.join(tmpDir, "gbmd-userdata.zip");
  const files = collectFiles(m);
  fs.writeFileSync(path.join(tmpDir, "userdata-manifest.json"), JSON.stringify(m, null, 2) + "\n", "utf8");
  for (const rel of files) {
    const src = path.join(APP_ROOT, rel);
    const dst = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return new Promise((resolve, reject) => {
    execFile(ZIP_BIN(), ["-r", "-q", zipPath, "userdata-manifest.json"].concat(files), { cwd: tmpDir, maxBuffer: 1024 * 1024 * 512 }, (err) => {
      const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
      if (err) { cleanup(); return reject(err); }
      try { const buf = fs.readFileSync(zipPath); cleanup(); resolve(buf); }
      catch (e) { cleanup(); reject(e); }
    });
  });
}

function importZip(zipPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-restore-"));
  const outDir = path.join(tmpDir, "out");
  let manifest = null;
  try { manifest = readManifest(); } catch (_) {}
  return new Promise((resolve, reject) => {
    execFile(UNZIP_BIN(), ["-o", "-q", zipPath, "-d", outDir], { maxBuffer: 1024 * 1024 * 512 }, (err) => {
      const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
      if (err) { cleanup(); return reject(err); }
      try { const r = restoreFromDir(outDir, manifest); cleanup(); resolve(r); }
      catch (e) { cleanup(); reject(e); }
    });
  });
}

// 安全相对路径校验（伪造清单/zip slip 防护）：拒绝绝对路径、Windows 盘符、
// 父目录穿越（..）、以及 resolve 后越出项目根。合法返回 true。
function safeRelPath(rel) {
  if (typeof rel !== "string" || !rel.trim()) return false;
  const s = rel.replace(/\\/g, "/");
  if (s.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  if (s.split("/").some((seg) => seg === "..")) return false;
  return path.resolve(APP_ROOT, s).startsWith(APP_ROOT + path.sep);
}

function restoreFromDir(outDir, manifest) {
  // bug#4：始终以本地清单为准（readManifest 从源码 //userdata-manifest.json 标记生成，可信）；
  //   忽略 zip 内 userdata-manifest.json——防伪造清单越权白名单（如把 server/app.js 列入白名单覆盖代码）。
  //   zip 内文件只在「本地白名单 + 安全路径」双重校验下才恢复。
  let m = manifest;
  if (!m) { try { m = readManifest(); } catch (_) {} }
  if (!m || m.schema !== 1) throw new Error("未找到本地 userdata-manifest.json（无法校验白名单）");
  if (!m.files || !m.dirs) throw new Error("清单格式无效");

  // 安全校验（本地清单理论上可信，仍防磁盘篡改）：files/dirs 的 rel 必须是项目内相对安全路径，
  // 拒绝绝对路径 / 父目录穿越 / 越出项目根，否则整个导入拒绝。
  for (const f of m.files || []) {
    if (!safeRelPath(f.rel)) throw new Error("清单含非法文件路径: " + f.rel);
  }
  for (const d of m.dirs || []) {
    if (!safeRelPath(d.rel)) throw new Error("清单含非法目录路径: " + d.rel);
  }

  const allowedExact = new Set(m.files.map((f) => f.rel));
  const allowedDirSuffix = (m.dirs || []).map((d) => ({ dir: d.rel, suffix: d.suffix || "" }));
  const isAllowed = (rel) => {
    if (allowedExact.has(rel)) return true;
    for (const { dir, suffix } of allowedDirSuffix) {
      const prefix = dir + "/";
      if (rel.startsWith(prefix) && (!suffix || rel.endsWith(suffix))) return true;
    }
    return false;
  };

  const restored = [];
  const skipped = [];
  const walk = (dir, prefix) => {
    for (const n of fs.readdirSync(dir)) {
      const abs = path.join(dir, n);
      const rel = prefix ? prefix + "/" + n : n;
      if (fs.statSync(abs).isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!isAllowed(rel)) { skipped.push(rel); continue; }
      // 二次防线：zip 内文件 rel 也必须是安全路径（zip slip 防护）
      if (!safeRelPath(rel)) { skipped.push(rel); continue; }
      const dst = path.join(APP_ROOT, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(abs, dst);
      restored.push(rel);
    }
  };
  walk(outDir, "");

  return {
    ok: true,
    restored,
    skipped,
    note: "导入完成。config / 下载任务如服务运行中，部分文件需重启服务后完全生效"
  };
}

module.exports = { readManifest, collectFiles, exportZip, importZip, generateManifest, buildManifest, restoreFromDir };
