// 数据备份/恢复（框架层，配置驱动）
// 扫源码 //userdata-manifest.json 注释自动生成清单 → zip 导出
// 导入 zip → 按清单白名单校验 → 解压写回
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile, execFileSync } = require("child_process");

const jsonDir = require("./json-dir");

const MARKER = "//userdata-manifest.json";
const MANIFEST_NAME = "userdata-manifest.json";
const TOOL_TIMEOUT_MS = 3000;
const ZIP_MAX_BUFFER = 512 * 1024 * 1024;
const toolCache = new Map();

// ---------- 工具函数（不依赖实例状态） ----------

function toolUsable(local) {
  if (toolCache.has(local)) return toolCache.get(local);
  let ok = false;
  try { execFileSync(local, ["-v"], { stdio: "ignore", timeout: TOOL_TIMEOUT_MS }); ok = true; }
  catch (_) { /* 工具不可用 */ }
  toolCache.set(local, ok);
  return ok;
}

function findTool(ctx, name) {
  const binDir = ctx.toolDir || path.join(ctx.appRoot, "tool", "bin");
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const ext of exts) {
    const local = path.join(binDir, name + ext);
    if (fs.existsSync(local) && toolUsable(local)) return local;
  }
  return name;
}

function safeRelPath(ctx, rel) {
  if (typeof rel !== "string" || !rel.trim()) return false;
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.split("/").some((seg) => seg === "..")) return false;
  return path.resolve(ctx.appRoot, normalized).startsWith(ctx.appRoot + path.sep);
}

function parseMarker(line) {
  const idx = String(line || "").indexOf(MARKER);
  if (idx < 0) return null;
  const rest = String(line).slice(idx + MARKER.length).trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts[0] === "file" && parts[1]) {
    return { kind: "file", rel: parts[1], desc: parts.slice(2).join(" ") };
  }
  if (parts[0] === "dir" && parts[1]) {
    let suffix = "";
    let descParts = parts.slice(2);
    if (descParts[0] && descParts[0].charAt(0) === ".") {
      suffix = descParts[0];
      descParts = descParts.slice(1);
    }
    return { kind: "dir", rel: parts[1], suffix, desc: descParts.join(" ") };
  }
  return null;
}

// ---------- 清单生成 ----------

function walkJs(dir, hits) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of names) {
    if (name === "node_modules" || name === "public" || name === "thumbs" || name.charAt(0) === ".") continue;
    const abs = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(abs); } catch (_) { continue; }
    if (stat.isDirectory()) { walkJs(abs, hits); continue; }
    if (!/\.(js|cjs)$/.test(name)) continue;
    let text;
    try { text = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    for (const line of text.split(/\r?\n/)) {
      const hit = parseMarker(line);
      if (hit) hits.push(hit);
    }
  }
}

function buildManifest(ctx) {
  const hits = [];
  walkJs(path.join(ctx.appRoot, "server"), hits);
  const files = [];
  const dirs = [];
  const seenFile = new Set();
  const seenDir = new Set();
  for (const hit of hits) {
    if (hit.kind === "file") {
      if (!hit.rel || seenFile.has(hit.rel) || hit.rel === "json/" + MANIFEST_NAME) continue;
      seenFile.add(hit.rel);
      files.push({ rel: hit.rel, desc: hit.desc || "" });
    } else if (hit.kind === "dir") {
      const key = hit.rel + "\0" + (hit.suffix || "");
      if (!hit.rel || seenDir.has(key)) continue;
      seenDir.add(key);
      const entry = { rel: hit.rel, desc: hit.desc || "" };
      if (hit.suffix) entry.suffix = hit.suffix;
      dirs.push(entry);
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  dirs.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    schema: 1,
    app: ctx.appName,
    generatedAt: new Date().toISOString(),
    note: "导出时根据源码 //" + MANIFEST_NAME + " 注释自动生成，不要手改。",
    files,
    dirs,
  };
}

function writeManifest(ctx, manifest) {
  jsonDir.ensureJsonDir();
  const tmp = ctx.manifestFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, ctx.manifestFile);
  return manifest;
}

function generateManifest(ctx) { return writeManifest(ctx, buildManifest(ctx)); }

function readManifest(ctx) {
  try {
    if (fs.existsSync(ctx.manifestFile)) {
      const data = JSON.parse(fs.readFileSync(ctx.manifestFile, "utf8"));
      if (data && data.schema === 1) return data;
    }
  } catch (_) { /* 文件损坏，重新生成 */ }
  return generateManifest(ctx);
}

// ---------- 收集 / 导出 / 导入 ----------

function collectFiles(ctx, manifestOpt) {
  const manifest = manifestOpt || readManifest(ctx);
  const result = [];
  for (const file of manifest.files || []) {
    const abs = path.join(ctx.appRoot, file.rel);
    if (fs.existsSync(abs)) result.push(file.rel);
  }
  for (const dir of manifest.dirs || []) {
    const dirAbs = path.join(ctx.appRoot, dir.rel);
    if (!fs.existsSync(dirAbs)) continue;
    let names;
    try { names = fs.readdirSync(dirAbs); } catch (_) { continue; }
    for (const name of names) {
      if (dir.suffix && !name.endsWith(dir.suffix)) continue;
      const abs = path.join(dirAbs, name);
      try { if (fs.statSync(abs).isFile()) result.push(dir.rel + "/" + name); }
      catch (_) { /* 文件不可读，跳过 */ }
    }
  }
  result.sort();
  return result;
}

function exportZip(ctx) {
  const manifest = generateManifest(ctx);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), ctx.appName + "-backup-"));
  const zipPath = path.join(tmpDir, ctx.appName + "-userdata.zip");
  const files = collectFiles(ctx, manifest);
  fs.writeFileSync(path.join(tmpDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  for (const rel of files) {
    const src = path.join(ctx.appRoot, rel);
    const dst = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return new Promise((resolve, reject) => {
    const args = ["-r", "-q", zipPath, MANIFEST_NAME].concat(files);
    execFile(findTool(ctx, "zip"), args, { cwd: tmpDir, maxBuffer: ZIP_MAX_BUFFER }, (err) => {
      const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
      if (err) { cleanup(); return reject(err); }
      try { const buf = fs.readFileSync(zipPath); cleanup(); resolve(buf); }
      catch (readErr) { cleanup(); reject(readErr); }
    });
  });
}

function importZip(ctx, zipPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), ctx.appName + "-restore-"));
  const outDir = path.join(tmpDir, "out");
  let manifest = null;
  try { manifest = readManifest(ctx); } catch (_) { /* 无清单，用 zip 内的 */ }
  return new Promise((resolve, reject) => {
    execFile(findTool(ctx, "unzip"), ["-o", "-q", zipPath, "-d", outDir], { maxBuffer: ZIP_MAX_BUFFER }, (err) => {
      const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };
      if (err) { cleanup(); return reject(err); }
      try { const result = restoreFromDir(ctx, outDir, manifest); cleanup(); resolve(result); }
      catch (restoreErr) { cleanup(); reject(restoreErr); }
    });
  });
}

function restoreFromDir(ctx, outDir, manifest) {
  let m = manifest;
  if (!m) { try { m = readManifest(ctx); } catch (_) {} }
  if (!m || m.schema !== 1) throw new Error("未找到本地 " + MANIFEST_NAME + "（无法校验白名单）");
  if (!m.files || !m.dirs) throw new Error("清单格式无效");

  for (const file of m.files || []) {
    if (!safeRelPath(ctx, file.rel)) throw new Error("清单含非法文件路径: " + file.rel);
  }
  for (const dir of m.dirs || []) {
    if (!safeRelPath(ctx, dir.rel)) throw new Error("清单含非法目录路径: " + dir.rel);
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
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = prefix ? prefix + "/" + name : name;
      if (fs.statSync(abs).isDirectory()) { walk(abs, rel); continue; }
      if (!isAllowed(rel) || !safeRelPath(ctx, rel)) { skipped.push(rel); continue; }
      const dst = path.join(ctx.appRoot, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(abs, dst);
      restored.push(rel);
    }
  };
  walk(outDir, "");

  return { ok: true, restored, skipped };
}

/**
 * 创建数据备份管理器。
 * @param {object} opts
 * @param {string} opts.appName   项目名
 * @param {string} opts.appRoot   项目根目录（绝对路径）
 * @param {string} [opts.toolDir] 工具目录（默认 appRoot/tool/bin）
 */
function createBackup(opts) {
  const ctx = {
    appName: opts.appName,
    appRoot: opts.appRoot,
    toolDir: opts.toolDir,
    manifestFile: jsonDir.jsonFile(MANIFEST_NAME),
  };
  return {
    readManifest: () => readManifest(ctx),
    collectFiles: (m) => collectFiles(ctx, m),
    exportZip: () => exportZip(ctx),
    importZip: (p) => importZip(ctx, p),
    generateManifest: () => generateManifest(ctx),
    buildManifest: () => buildManifest(ctx),
    restoreFromDir: (out, m) => restoreFromDir(ctx, out, m),
  };
}

module.exports = { createBackup };