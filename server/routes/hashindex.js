// ============================================================
// gbmd - 路由：HTML 反查（双表：GB 信息表 + 本地表）
// P1 从 app.js 拆分。
// ============================================================
"use strict";

const { createRoute, sendJson, readBody } = require("../core/index.js");
const hashIndex = require("../lib/hash-index");

module.exports = createRoute({


  // GET /api/hash-query?hash=<md5> → 该 hash 所属 mod/目录/文件（O(1) 内存索引）
  //   source: "local"=本地表命中（有实际落盘路径）| "gb"=仅 GB 表命中（线上信息，未在本机下载）
  "GET /api/hash-query": (req, res, ctx) => {
    const h = String(ctx.query.hash || "").trim().toLowerCase();
    if (!h) return sendJson(res, { ok: false, error: "缺 hash 参数" }, 400);
    const hit = hashIndex.queryByHash(h);
    if (!hit) return sendJson(res, { ok: true, found: false, hash: h }, 200);
    return sendJson(res, {
      ok: true, found: true, hash: h, source: hit.source || "gb",
      mod: { name: hit.modName || "", url: hit.url || "", author: hit.author || "", game: hit.game || "", modId: hit.modId || "" },
      file: { name: hit.file || hit.fileName || "", gbMd5: hit.gbMd5 || "", hash: hit.hash || "", kind: hit.kind || "file" },
      modDir: hit.modDir || ""
    }, 200);
  },

  // GET /api/hash-index-status → 双表状态（GB 表 / 本地表 大小、上次构建耗时）
  "GET /api/hash-index-status": (req, res) => {
    return sendJson(res, { ok: true, ...hashIndex.status() }, 200);
  },

  // POST /api/hash-rebuild → 后台重建索引（body.game 指定只重建该游戏，不传或空 = 全部）
  //   2026-10-12 新增两个可选动作（**都默认关**，由设置面板的两个勾选控制）：
  //     body.html = true → 遍历时顺带重写存量 description.html（描述区 GB 图片外链本地化等生成侧修复）
  //     body.md5  = true → 顺带补算图片内容 md5 写回索引（⚠️ 重活：逐个读图片内容，见 lib/rebuild-html.js）
  //   两者都在 rebuild 的同一遍遍历里完成（不二次走盘），且 rebuild 本身单飞。
  "POST /api/hash-rebuild": async (req, res) => {
    const body = await readBody(req);
    const game = String((body && body.game) || "").trim();
    const wantHtml = !!(body && body.html);
    const wantMd5 = !!(body && body.md5);
    hashIndex.rebuild(game || undefined, {
      html: wantHtml,
      md5: wantMd5,
      // ⑤ 断续：复用进度文件（只影响「重写 HTML」这一步；索引构建照常走完）
      resume: !!(body && body.resume),
    }).then(() => {}).catch(() => {});
    return sendJson(res, { ok: true, running: true, game: game || "all", html: wantHtml, md5: wantMd5 }, 200);
  },

  // GET /api/hash-index-search?q=<关键词>&game=<游戏名可选> → GB 表模糊搜索
  "GET /api/hash-index-search": (req, res, ctx) => {
    const q = String(ctx.query.q || "").trim();
    if (q.length < 2) return sendJson(res, { ok: true, results: [], hint: "关键词至少 2 个字符" }, 200);
    const game = String(ctx.query.game || "").trim();
    const results = hashIndex.searchGb(q, game);
    return sendJson(res, { ok: true, count: results.length, results }, 200);
  },
});
