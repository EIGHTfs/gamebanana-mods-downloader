// test/download-headers.test.cjs —— 下载请求头回归门禁
//
// 背景（2026-10-12 实测）：
//   ① `downloadToFile` 原来**写死** Chrome/120 的 UA，忽略配置里的 gbUserAgent——而 GB 的会话与
//      「登录浏览器的完整 UA」绑定（README 常见问题），UA 不一致会被判未登录。
//   ② 带 cookie 收到 403 时去掉 cookie 重试一次。
//      （早期归因为「cookie 过期」，2026-10-12 **更正**：GB 的 403 实测与 cookie 无关——
//       同一 URL 带/不带 cookie 都是 403；真正决定登录态的是 UA 是否与换取 cookie 的浏览器一致：
//       配置 UA + cookie → _bIsLoggedIn=true，Chrome UA + 同一 cookie → false。
//       本重试保留为「cookie 被顶掉/真过期」的兜底。）
//
// 测试隔离：起本地 http 服务（不碰外网、不碰真实 json/），目标文件写在 os.tmpdir() 派生目录里。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("node:http");

const log = makeLog("download-headers");
const downloader = require(path.join(__dirname, "..", "server", "lib", "downloader.js"));

loggedTest(log, "下载请求头：UA 取配置 gbUserAgent；带 cookie 被 403 时去 cookie 重试成功", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-dlua-"));
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ ua: req.headers["user-agent"] || "", cookie: req.headers.cookie || "" });
    if (req.headers.cookie) { res.writeHead(403); res.end("forbidden"); return; }   // 模拟「过期 cookie → 403」
    res.writeHead(200, { "content-length": "4" });
    res.end("data");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const UA = "Mozilla/5.0 (X11; Linux x86_64) GBMD-TEST-UA";
    const item = { url: `http://127.0.0.1:${port}/f.bin`, path: path.join(dir, "f.bin") };
    const r = await downloader.downloadToFile(item, { gbUserAgent: UA, gbCookie: "sess=stale" }, () => {});

    assert.equal(r.size, 4, "去掉 cookie 后应 200 并下载成功");
    assert.equal(seen[0].ua, UA, "首次请求的 UA 必须来自配置 gbUserAgent（不再写死）");
    assert.equal(seen[0].cookie, "sess=stale", "首次请求应带上配置的 cookie");
    assert.ok(seen.length >= 2, "带 cookie 被 403 后应去掉 cookie 重试一次");
    assert.equal(seen[1].cookie, "", "重试请求不应再带 cookie");
    assert.equal(seen[1].ua, UA, "重试请求仍应使用配置 UA");
    log.info(`请求次数=${seen.length}；UA 取自配置 ✓；403 后去 cookie 重试成功 ✓`);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
