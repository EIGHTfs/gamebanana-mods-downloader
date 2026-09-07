// ============================================================
// gbmd - 自动更新（零依赖文件监控 + 优雅重启）
//
// 用户场景：开发机改完代码 → 推送 GitHub → 服务端自动拉取 + 重启
//   不需要每次手动同步代码重启。
//
// 三种模式：
//   1. watch 模式（默认）：监控 server/ 目录文件变更 → 防抖后重启
//   2. git 模式（可选）：定时 git pull → 有变更则重启
//   3. github 模式（2026-09-07 新增）：定时从 GitHub 拉取更新，
//      不需要服务端有 .git（裸目录部署也能用）
//
// 实现要点：
//   - 零依赖（Node.js 内置 fs / https / child_process）
//   - 防抖 2 秒（连续保存不反复重启）
//   - 优雅关停（当前下载任务标记 paused，等重启后 resume）
//   - 配置可控（config.json autoUpdate: { enabled, mode, interval, ... }）
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn, execSync } = require("child_process");

const SERVER_DIR = path.join(__dirname, "..");
const ROOT_DIR = path.join(SERVER_DIR, "..");
const PID_FILE = path.join(ROOT_DIR, path.basename(ROOT_DIR) + ".pid");
// github 模式状态文件（记录上次应用的 commit sha，不入库）
const STATE_FILE = path.join(ROOT_DIR, ".auto-update-state.json");
// github 模式默认仓库/分支（公开仓库，匿名 API 足够；可通过 config 覆盖）
const DEFAULT_REPO = "EIGHTfs/gamebanana-mods-downloader";
const DEFAULT_BRANCH = "main";
// github 模式下禁止覆盖的运行态/敏感文件（相对项目根，前缀或精确匹配）
// 排除规则分三类（isExcluded 按类匹配，避免「以 . 开头一律当后缀」的误判）：
//   GITHUB_EXCLUDE        —— 精确文件路径 / 目录前缀（含运行态配置，SA6400 权威，绝不覆盖）
//   GITHUB_EXCLUDE_DIR    —— 任意层级目录名（路径中任一段等于该名即排除，如群晖 @eaDir）
//   GITHUB_EXCLUDE_SUFFIX —— 后缀规则（任意路径段结尾匹配）
const GITHUB_EXCLUDE = [
  // 运行态配置（含密码/gbCookie/下载路径，SA6400 权威，绝不覆盖）
  "server/config.json",
  "json/gamebanana.com.json",
  // 运行态索引/任务/会话
  "json/index",
  "json/sessions.json",
  "json/download_task.json",
  "json/search_cache.json",
  "json/search_task.json",
  "json/userdata-manifest.json",
  // 测试日志目录 / 本模式状态文件
  "test/logs",
  ".auto-update-state.json"
];
// 任意层级目录名（群晖元数据 / 依赖 / 构建产物 / 本模式临时目录）
const GITHUB_EXCLUDE_DIR = ["@eaDir", "node_modules", "_test-download", "dist", "release", ".auto-update-tmp"];
// 后缀规则（日志 / PID / 备份残留）
const GITHUB_EXCLUDE_SUFFIX = [".log", ".pid", ".bak"];

let watcher = null;
let debounceTimer = null;
let gitInterval = null;
let githubInterval = null;
let restarting = false;
let _onRestart = null;
let _onStatus = null;

/** 启动监控 */
function start(cfg, onRestart, onStatus) {
  _onRestart = onRestart;
  _onStatus = onStatus;
  stop(); // 先清旧
  if (!cfg || !cfg.enabled) {
    _log("autoUpdate 未启用");
    return { enabled: false };
  }
  const mode = cfg.mode || "watch";
  _log(`autoUpdate 启动: mode=${mode}`);
  if (mode === "git") {
    startGitWatch(cfg);
  } else if (mode === "github") {
    startGitHubWatch(cfg);
  } else {
    startFileWatch();
  }
  return { enabled: true, mode, interval: cfg.interval || (mode !== "watch" ? 300 : null) };
}

/** 停止监控 */
function stop() {
  if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (gitInterval) { clearInterval(gitInterval); gitInterval = null; }
  if (githubInterval) { clearInterval(githubInterval); githubInterval = null; }
  restarting = false;
}

/** watch 模式：监控 server/ 目录文件变更 */
function startFileWatch() {
  // 忽略 json/ 目录（运行时数据，频繁变更）+ node_modules + .git
  watcher = fs.watch(SERVER_DIR, { recursive: false }, (event, filename) => {
    if (!filename) return;
    // 只关心 .js .cjs .html .css .json 变更
    if (!/\.(js|cjs|html|css|json)$/i.test(filename)) return;
    // 忽略 json/ 子目录（运行时数据）
    if (filename.startsWith("json/") || filename.startsWith("json\\")) return;
    _log(`检测到变更: ${filename}`);
    scheduleRestart();
  });
  // 递归监控 server/ 子目录（routes/ lib/ utils/ public/）
  watchRecursive(path.join(SERVER_DIR, "routes"));
  watchRecursive(path.join(SERVER_DIR, "lib"));
  watchRecursive(path.join(SERVER_DIR, "utils"));
  watchRecursive(path.join(SERVER_DIR, "public"));
}

function watchRecursive(dir) {
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
    fs.watch(dir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      if (!/\.(js|cjs|html|css|json)$/i.test(filename)) return;
      if (filename.startsWith("json/") || filename.startsWith("json\\")) return;
      _log(`检测到变更: ${filename}`);
      scheduleRestart();
    });
  } catch (_) { /* 目录不存在 */ }
}

/** git 模式：定时 git pull → 有变更则重启 */
function startGitWatch(cfg) {
  const intervalMin = cfg.interval || 300; // 秒
  const doGitPull = () => {
    if (restarting) return;
    try {
      const before = execSync("git rev-parse HEAD", { cwd: ROOT_DIR, timeout: 5000 }).toString().trim();
      execSync("git pull --ff-only", { cwd: ROOT_DIR, timeout: 30000 });
      const after = execSync("git rev-parse HEAD", { cwd: ROOT_DIR, timeout: 5000 }).toString().trim();
      if (before !== after) {
        _log(`git pull 检测到更新: ${before.slice(0, 8)} → ${after.slice(0, 8)}`);
        scheduleRestart();
      }
    } catch (e) {
      _log("git pull 失败: " + (e.message || String(e)).slice(0, 100));
    }
  };
  // 首次立即执行
  doGitPull();
  gitInterval = setInterval(doGitPull, intervalMin * 1000);
}

// ------------------------------------------------------------
// github 模式：利用 GitHub 拉取更新，服务端不需要 .git
// 流程：查最新 commit sha（api.github.com）→ 与上次应用 sha 比较
//       → 变化则下载 tarball（codeload.github.com）→ 解压
//       → 安全复制代码（排除运行态/敏感文件）→ 记录 sha → 优雅重启
// ------------------------------------------------------------

/** github 模式：定时检查 GitHub 更新 */
function startGitHubWatch(cfg) {
  const intervalSec = cfg.interval || 300;
  const doCheck = () => { checkGitHubUpdate(cfg); };
  doCheck(); // 首次立即检查
  githubInterval = setInterval(doCheck, intervalSec * 1000);
}

/** 检查一次 GitHub 更新（可被 /api/auto-update/check 手动触发） */
function checkGitHubUpdate(cfg) {
  if (restarting) return;
  const repo = (cfg && cfg.githubRepo) || DEFAULT_REPO;
  const branch = (cfg && cfg.githubBranch) || DEFAULT_BRANCH;
  const token = (cfg && cfg.githubToken) || "";
  _log(`github 模式检查更新: ${repo}@${branch}`);
  const state = readState();
  getGitHubRefSha(repo, branch, token).then((sha) => {
    if (!sha) return;
    if (state.lastSha === sha) {
      _log(`github 无新版本（${sha.slice(0, 8)}）`);
      return;
    }
    _log(`github 检测到新版本: ${(state.lastSha || "无").slice(0, 8)} → ${sha.slice(0, 8)}`);
    applyGitHubUpdate(repo, branch, token).then(() => {
      saveState({ lastSha: sha, updatedAt: Date.now() });
      _log("github 代码已更新，2 秒后重启");
      scheduleRestart();
    }).catch((e) => {
      _log("github 更新应用失败: " + (e && e.message || String(e)).slice(0, 200));
    });
  }).catch((e) => {
    _log("github 检查失败: " + (e && e.message || String(e)).slice(0, 200));
  });
}

/** 查仓库指定分支最新 commit sha（api.github.com Git Data API） */
function getGitHubRefSha(repo, branch, token) {
  const url = `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`;
  const headers = {
    "User-Agent": "gbmd-auto-update",
    "Accept": "application/vnd.github+json"
  };
  if (token) headers["Authorization"] = "token " + token;
  return httpsGet(url, headers).then((buf) => {
    try {
      const j = JSON.parse(buf.toString("utf8"));
      return j && j.object && j.object.sha ? j.object.sha : null;
    } catch (_) { return null; }
  });
}

/** 下载 tarball → 解压 → 安全复制到项目根 */
function applyGitHubUpdate(repo, branch, token) {
  const tmpDir = path.join(ROOT_DIR, ".auto-update-tmp");
  const tgzPath = path.join(tmpDir, "repo.tar.gz");
  const extractDir = path.join(tmpDir, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  const tarUrl = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
  const headers = { "User-Agent": "gbmd-auto-update", "Accept": "application/octet-stream" };
  if (token) headers["Authorization"] = "token " + token;
  return httpsGet(tarUrl, headers).then((buf) => {
    fs.writeFileSync(tgzPath, buf);
    _log(`tarball 下载完成: ${buf.length} bytes`);
    // 解压（strip 顶层 EIGHTfs-gamebanana-mods-downloader-<sha>/ 目录）
    const tar = findTar();
    execSync(`"${tar}" -xzf "${tgzPath}" -C "${extractDir}" --strip-components=1`, { timeout: 60000 });
    _log("tarball 解压完成");
    // 安全复制：覆盖/新增代码，绝不触碰运行态与敏感文件，也不删除目标多余文件
    copyTreeSafe(extractDir, ROOT_DIR);
    // 恢复脚本可执行位（git 模式不需要，tarball 里 *.sh 可能是 644）
    chmodScripts(ROOT_DIR);
    // 清理临时目录
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });
}

/** 找到系统 tar（github 模式解压用） */
function findTar() {
  const candidates = ["/usr/bin/tar", "/bin/tar", "/usr/local/bin/tar", "tar"];
  for (const c of candidates) {
    try {
      execSync(`"${c}" --version >/dev/null 2>&1`, { timeout: 3000 });
      return c;
    } catch (_) { /* 下一个 */ }
  }
  return "tar";
}

/** 安全复制：把 src 下的代码树复制到 dst（覆盖/新增），跳过运行态与敏感路径 */
function copyTreeSafe(src, dst, relBase) {
  // dst 可能不存在（顶层首个条目是文件时 copyFileSync 会 ENOENT），先建目录
  try { fs.mkdirSync(dst, { recursive: true }); } catch (_) {}
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    // 相对路径要累积（排除规则按完整相对路径匹配，如 json/userdata-manifest.json）
    const rel = relBase ? relBase + "/" + ent.name : ent.name;
    if (isExcluded(rel)) { _log("跳过(排除): " + rel); continue; }
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTreeSafe(s, d, rel);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/** 判断相对路径是否命中排除清单（精确匹配或前缀匹配） */
/** 是否排除：任意层级目录名 / 后缀 / 精确路径或目录前缀 */
function isExcluded(relPath) {
  const p = relPath.replace(/\\/g, "/");
  // 1) 任意层级目录名：路径中任一段等于该名（如 json/@eaDir/x.json 里的 @eaDir）
  const segs = p.split("/");
  if (GITHUB_EXCLUDE_DIR.some((d) => segs.includes(d))) return true;
  // 2) 后缀规则：任意路径段结尾匹配
  if (GITHUB_EXCLUDE_SUFFIX.some((s) => p.endsWith(s))) return true;
  // 3) 精确文件路径 / 目录前缀
  return GITHUB_EXCLUDE.some((rule) => p === rule || p.startsWith(rule + "/"));
}

/** 恢复 *.sh 与 scripts/installer 可执行位（tarball 里可能丢失） */
function chmodScripts(rootDir) {
  const scripts = ["start.sh", "start-linux.sh", "start-macos.sh", "scripts/installer",
    "crx/native-host/install-linux.sh", "crx/native-host/host-wrapper.sh"];
  for (const rel of scripts) {
    const f = path.join(rootDir, rel);
    try { if (fs.existsSync(f)) fs.chmodSync(f, 0o755); } catch (_) {}
  }
}

/** 读取 github 模式状态（上次应用的 sha） */
function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {};
    }
  } catch (_) {}
  return {};
}

/** 保存 github 模式状态 */
function saveState(obj) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2), "utf8"); } catch (_) {}
}

/** 零依赖 HTTPS GET，跟随 301/302（最多 5 跳），返回 Buffer */
function httpsGet(url, headers, redirects) {
  redirects = redirects || 0;
  if (redirects > 5) return Promise.reject(new Error("重定向次数过多"));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: headers || {} }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        const next = new URL(loc, url).toString();
        httpsGet(next, headers, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("HTTP " + res.statusCode + " " + url));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("请求超时")); });
  });
}

/** 防抖重启（2 秒内多次变更只触发一次） */
function scheduleRestart() {
  if (restarting) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  _log("防抖 2s 后重启...");
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    doRestart();
  }, 2000);
}

/** 执行重启：触发 ./start.sh restart 后退出本进程 */
async function doRestart() {
  if (restarting) return;
  restarting = true;
  _log("开始重启...");
  try {
    if (_onRestart) await _onRestart();
  } catch (e) {
    _log("重启回调异常: " + (e.message || String(e)));
  }
  // 重启走 start.sh restart（项目唯一启停入口）：
  //   延迟 detached 触发 `./start.sh restart` → stop(杀本进程) → start(拉起新进程)。
  //   不能本进程 exit(0) 后指望外部拉起——start.sh 无守护循环；也不能自己 spawn——
  //   与 start.sh 的 PID 管理冲突。先触发再退出，两不冲突。
  const startSh = path.join(ROOT_DIR, "start.sh");
  const logFile = path.join(SERVER_DIR, "server.log");
  let launched = false;
  try {
    if (fs.existsSync(startSh)) {
      fs.mkdirSync(SERVER_DIR, { recursive: true });
      const out = fs.openSync(logFile, "a");
      const child = spawn("sh", ["-c", `sleep 1; exec "${startSh}" restart >> "${logFile}" 2>&1`], {
        cwd: ROOT_DIR,
        detached: true,
        stdio: ["ignore", out, out],
        env: process.env
      });
      fs.closeSync(out);
      child.unref();
      launched = true;
      _log(`已触发 ./start.sh restart（1 秒后执行，日志 ${logFile}）`);
    } else {
      _log("未找到 start.sh，跳过自动重启");
    }
  } catch (e) {
    _log("触发 start.sh 失败: " + (e.message || String(e)));
  }
  // 延迟 500ms 让 shutdown 完成；start.sh restart 的 stop 阶段会 SIGTERM 本进程
  setTimeout(() => {
    _log("执行 process.exit(0)");
    process.exit(0);
  }, 500);
}

/** 获取状态 */
function getStatus() {
  const state = readState();
  return {
    enabled: !!watcher || !!gitInterval || !!githubInterval,
    mode: watcher ? "watch" : (gitInterval ? "git" : (githubInterval ? "github" : "none")),
    restarting,
    hasDebounce: !!debounceTimer,
    // github 模式：上次应用 sha / 检查时间
    lastSha: state.lastSha || "",
    lastUpdatedAt: state.updatedAt || 0
  };
}

function _log(msg) {
  console.log(`[auto-update] ${msg}`);
  if (_onStatus) _onStatus(msg);
}

module.exports = { start, stop, getStatus, scheduleRestart, doRestart, checkGitHubUpdate, getGitHubRefSha, applyGitHubUpdate, isExcluded, copyTreeSafe };
