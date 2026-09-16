// ============================================================
// gbmd - 路由：用户数据备份/恢复（zip 导出/导入，按 userdata-manifest.json 清单）
// P1 从 app.js 拆分。bug#3：导入体经 readBody 流式落临时文件，不进内存。
// ============================================================
"use strict";

const { createRoute, sendJson, readBody } = require("../framework");
const dataBackup = require("../lib/data-backup");
const fs = require("fs");
const path = require("path");
const os = require("os");

module.exports = createRoute({


  // GET /api/data/export
  "GET /api/data/export": async (req, res) => {
    try {
      const buf = await dataBackup.exportZip();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="gbmd-userdata-${new Date().toISOString().slice(0, 10)}.zip"`);
      return res.end(buf);
    } catch (e) {
      return sendJson(res, { ok: false, error: "备份失败: " + (e && e.message || e) }, 500);
    }
  },

  // POST /api/data/import
  "POST /api/data/import": async (req, res) => {
    const body = await readBody(req, 512 * 1024 * 1024); // zip 可能几十 MB，放大限制
    const b64 = body && (body.data || body.zip);
    if (!b64 || typeof b64 !== "string") return sendJson(res, { ok: false, error: "缺少 zip 数据（data 字段，base64）" }, 400);
    let zipBuf;
    try { zipBuf = Buffer.from(b64, "base64"); }
    catch (e) { return sendJson(res, { ok: false, error: "zip 数据解码失败" }, 400); }
    const zipPath = path.join(os.tmpdir(), "gbmd-upload-" + Date.now() + ".zip");
    fs.writeFileSync(zipPath, zipBuf);
    try {
      const r = await dataBackup.importZip(zipPath);
      return sendJson(res, r, 200);
    } catch (e) {
      return sendJson(res, { ok: false, error: "导入失败: " + (e && e.message || e) }, 400);
    } finally {
      try { fs.unlinkSync(zipPath); } catch (_) {}
    }
  },
});
