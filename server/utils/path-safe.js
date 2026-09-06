// ============================================================
// gbmd - 路径安全（2026-09-06 黑名单实现）
// 局域网项目不需要白名单收敛，只需拉黑各平台系统关键目录。
// ============================================================
"use strict";

const path = require("path");
const os = require("os");

// 系统关键目录黑名单（绝对路径前缀）
// 按平台区分：Linux/macOS vs Windows
const BLOCKED_ROOTS = (() => {
  const isWin = os.platform() === "win32";
  if (isWin) {
    return [
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      "C:\\ProgramData",
      "C:\\Users\\Public",
    ];
  }
  // Linux / macOS
  return [
    "/etc",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/run",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/lib32",
    "/libx32",
    "/snap",
    "/media",
    "/mnt",
    "/opt",
    "/srv",
    "/root",
  ];
})();

/** 判断 abs 路径是否命中黑名单（精确匹配或子路径） */
function isBlocked(abs) {
  const resolved = path.resolve(String(abs || ""));
  for (const root of BLOCKED_ROOTS) {
    const rr = path.resolve(root);
    if (resolved === rr || resolved.startsWith(rr + path.sep)) return true;
  }
  return false;
}

/**
 * dir 是否可浏览：不在黑名单内即放行。
 * 局域网自用项目，无需白名单收敛到下载根。
 */
function isBrowsableDir(dir) {
  return !isBlocked(dir);
}

module.exports = { isBrowsableDir, isBlocked, BLOCKED_ROOTS };
