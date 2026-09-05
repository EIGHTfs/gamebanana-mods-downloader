// ============================================================
// gbmd - 路径安全（bug#2 修复）
// downloadRoots：收集全部下载根（各游戏 downloadPath + defaultDownloadPath）
// isWithinRoots：abs 是否在某根内（resolve + startsWith，防目录穿越/越权浏览）
// ============================================================
"use strict";

const path = require("path");

function downloadRoots(cfg) {
  const roots = Object.values(cfg.readGame()).map((e) => e && e.downloadPath).filter((r) => r && String(r).trim());
  const def = String(cfg.readConfig().defaultDownloadPath || "").trim();
  if (def) roots.push(def);
  return roots;
}

function isWithinRoots(target, roots) {
  const abs = path.resolve(String(target || ""));
  return (roots || []).some((r) => {
    const rr = path.resolve(String(r || ""));
    return abs === rr || abs.startsWith(rr + path.sep);
  });
}

// dir 是否在「下载根 + 祖先 + 后代」可浏览范围（bug#2：browse 收敛到下载根分支）。
// 祖先放行：前端从 "/" 起步下钻到下载根；后代放行：在下载根内继续下钻选子目录。
// 其余分支（/etc、/home 等与下载无关）一律不列、不可进。
function isBrowsableDir(dir, roots) {
  const list = roots || [];
  if (!list.length) return true; // 无任何下载根时无法收敛，不限制
  const abs = path.resolve(String(dir || ""));
  return list.some((r) => {
    const rr = path.resolve(String(r || ""));
    return abs === rr || abs.startsWith(rr + path.sep) || rr.startsWith(abs + path.sep);
  });
}

module.exports = { downloadRoots, isWithinRoots, isBrowsableDir };
