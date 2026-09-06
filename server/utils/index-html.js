// utils/index-html.js —— description.html 内嵌「机器可读索引块」的读写（P2 去重）
//   块格式：<script id="gbmd-index" type="application/json">{ schema:1, ... }</script>
//   原 4 处重复（downloader/organize/hash-index/incomplete-scan）合一，逻辑原样搬。
"use strict";

const fs = require("fs");
const path = require("path");

const INDEX_TAG_ID = "gbmd-index";

// 写索引块（供 downloader.buildHtmlContent 内嵌）
function buildIndexBlock(obj) {
  return `<script id="${INDEX_TAG_ID}" type="application/json">\n` +
    JSON.stringify(obj, null, 2) +
    `\n</script>`;
}

// 解析索引块（schema!==1 视为无效）
function parseIndexObj(html) {
  if (!html) return null;
  const re = new RegExp(`<script id="${INDEX_TAG_ID}"[^>]*>([\\s\\S]*?)<\\/script>`);
  const m = html.match(re);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    if (obj && obj.schema === 1) return obj;
  } catch (_) {}
  return null;
}

// 读 modDir/description.html 并解析（不存在/解析失败返回 null）
function readIndexObj(modDir) {
  const p = path.join(modDir, "description.html");
  if (!fs.existsSync(p)) return null;
  try { return parseIndexObj(fs.readFileSync(p, "utf8")); } catch (_) { return null; }
}

module.exports = { INDEX_TAG_ID, buildIndexBlock, parseIndexObj, readIndexObj };
