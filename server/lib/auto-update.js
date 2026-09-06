// ============================================================
// gbmd - 自动更新（零依赖文件监控 + 优雅重启）
//
// 用户场景：开发机改完代码 → 推送 GitHub → 服务端自动拉取 + 重启
//   不需要每次手动同步代码重启。
//
// 两种模式：
//   1. watch 模式（默认）：监控 server/ 目录文件变更 → 防抖后重启
//   2. git 模式（可选）：定时 git pull → 有变更则重启
//
// 实现要点：
//   - 零依赖（Node.js 内置 fs.watch + child_process）
//   - 防抖 2 秒（连续保存不反复重启）
//   - 优雅关停（当前下载任务标记 paused，等重启后 resume）
//   - 配置可控（config.json autoUpdate: { enabled, mode, interval }）
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const SERVER_DIR = path.join(__dirname, "..");
const ROOT_DIR = path.join(SERVER_DIR, "..");
const PID_FILE = path.join(ROOT_DIR, path.basename(ROOT_DIR) + ".pid");

let watcher = null;
let debounceTimer = null;
let gitInterval = null;
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
  } else {
    startFileWatch();
  }
  return { enabled: true, mode, interval: cfg.interval || (mode === "git" ? 300 : null) };
}

/** 停止监控 */
function stop() {
  if (watcher) { try { watcher.close(); } catch (_) {} watcher = null; }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (gitInterval) { clearInterval(gitInterval); gitInterval = null; }
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

/** 执行重启 */
async function doRestart() {
  if (restarting) return;
  restarting = true;
  _log("开始重启...");
  try {
    if (_onRestart) await _onRestart();
  } catch (e) {
    _log("重启回调异常: " + (e.message || String(e)));
  }
  // 延迟 500ms 让 shutdown 完成
  setTimeout(() => {
    _log("执行 process.exit(0) 让 start.sh 重启");
    process.exit(0);
  }, 500);
}

/** 获取状态 */
function getStatus() {
  return {
    enabled: !!watcher || !!gitInterval,
    mode: watcher ? "watch" : (gitInterval ? "git" : "none"),
    restarting,
    hasDebounce: !!debounceTimer
  };
}

function _log(msg) {
  console.log(`[auto-update] ${msg}`);
  if (_onStatus) _onStatus(msg);
}

module.exports = { start, stop, getStatus, scheduleRestart, doRestart };
