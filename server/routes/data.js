// ============================================================
// gbmd - 路由：用户数据备份/恢复（zip 导出/导入，按 userdata-manifest.json 清单）
// P1 从 app.js 拆分。bug#3：导入体经 readBody 流式落临时文件，不进内存。
// ============================================================
"use strict";

module.exports = function register(api) {
  const { route, sendJson, readBody, dataBackup, fs, path, os } = api;

  // GET /api/data/export
  route("GET", "/api/data/export", async (req, res) => {
    try {
      const buf = await dataBackup.exportZip();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="gbmd-userdata-${new Date().toISOString().slice(0, 10)}.zip"`);
      return res.end(buf);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: "备份失败: " + (e && e.message || e) });
    }
  });

  // POST /api/data/import
  route("POST", "/api/data/import", async (req, res) => {
    const body = await readBody(req, 512 * 1024 * 1024); // zip 可能几十 MB，放大限制
    const b64 = body && (body.data || body.zip);
    if (!b64 || typeof b64 !== "string") return sendJson(res, 400, { ok: false, error: "缺少 zip 数据（data 字段，base64）" });
    let zipBuf;
    try { zipBuf = Buffer.from(b64, "base64"); }
    catch (e) { return sendJson(res, 400, { ok: false, error: "zip 数据解码失败" }); }
    const zipPath = path.join(os.tmpdir(), "gbmd-upload-" + Date.now() + ".zip");
    fs.writeFileSync(zipPath, zipBuf);
    try {
      const r = await dataBackup.importZip(zipPath);
      return sendJson(res, 200, r);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "导入失败: " + (e && e.message || e) });
    } finally {
      try { fs.unlinkSync(zipPath); } catch (_) {}
    }
  });
};
