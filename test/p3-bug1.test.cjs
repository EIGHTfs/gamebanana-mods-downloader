// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码
// test/p3-bug1.test.cjs —— P3 bug#1：finalizeHtmls 接线 ingestModDir（下载完成→入反查索引）
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// 2026-10-18：必须隔离 —— hash-index 在**模块加载期**就解析 GBMD_JSON_DIR，不设会直接写项目真实的
//   json/index/。以前只产 .jsonl（用例末尾删掉就干净），现在索引可能落在 json/index/index.db，
//   跨次运行残留会让「新增条数」断言变成 0（实测踩到：第二次跑 gbAdded=0）。
//   这里统一指向临时目录，进程退出时清理。
const TMP_JSON = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-p3-json-"));
process.env.GBMD_JSON_DIR = TMP_JSON;
process.on("exit", () => {
  try { fs.rmSync(TMP_JSON, { recursive: true, force: true }); } catch (_) {}
});
const log = makeLog("p3-bug1");

// 2026-10-11 修：utils/index-html → lib/index-html
const indexHtml = require("../server/lib/index-html");
const hashIndex = require("../server/lib/hash-index");
const DOWNLOADER_SRC = fs.readFileSync(path.join(__dirname, "..", "server", "lib", "downloader.js"), "utf8");

loggedTest(log, "bug#1 接线：downloader require hash-index + finalizeHtmls 调 ingestModDir（批量延迟落盘）", () => {
  assert.match(DOWNLOADER_SRC, /require\("\.\/hash-index"\)/, "downloader 应 require hash-index");
  // 2026-10-12：收尾改为「批量期间只更新内存 + 结束后统一落盘」——每目录写一次索引会写几十 GB
  assert.match(DOWNLOADER_SRC, /hashIndex\.ingestModDir\(finalDir,\s*\{\s*deferSave:\s*true\s*\}\)/, "finalizeHtmls 应以 deferSave 调 ingestModDir");
  assert.match(DOWNLOADER_SRC, /hashIndex\.flushDirtyGames\(\)/, "收尾结束应统一 flushDirtyGames 落盘");
  assert.equal(typeof hashIndex.ingestModDir, "function", "ingestModDir 是函数");
  assert.equal(typeof hashIndex.flushDirtyGames, "function", "flushDirtyGames 是函数");
});

loggedTest(log, "bug#1 行为：ingestModDir 读 description.html 入索引（saved:1）", () => {
  const tmp = path.join(os.tmpdir(), "gbmd-p3-" + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  const obj = {
    schema: 1, game: "TestGameP3", modId: "999", name: "T", author: "A",
    url: "https://gamebanana.com/mods/999",
    files: [{ file: "a.zip", gbMd5: "deadbeefdeadbeefdeadbeefdeadbeef", hash: "deadbeefdeadbeefdeadbeefdeadbeef" }]
  };
  fs.writeFileSync(path.join(tmp, "description.html"), "<x>" + indexHtml.buildIndexBlock(obj) + "</x>");
  const r = hashIndex.ingestModDir(tmp);
  assert.equal(r.saved, 1);
  assert.ok(r.gbAdded >= 1, "应入 GB 表");
  fs.rmSync(tmp, { recursive: true, force: true });
  // 索引副作用随 TMP_JSON 一起在进程退出时清理（见文件头说明），不再动项目真实 json/index/
});
