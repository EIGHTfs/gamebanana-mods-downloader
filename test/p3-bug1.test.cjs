// dsh-skip-residue 服务端 Node.js 测试，非浏览器代码
// test/p3-bug1.test.cjs —— P3 bug#1：finalizeHtmls 接线 ingestModDir（下载完成→入反查索引）
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const log = makeLog("p3-bug1");

const indexHtml = require("../server/utils/index-html");
const hashIndex = require("../server/lib/hash-index");
const DOWNLOADER_SRC = fs.readFileSync(path.join(__dirname, "..", "server", "lib", "downloader.js"), "utf8");

loggedTest(log, "bug#1 接线：downloader require hash-index + finalizeHtmls 调 ingestModDir", () => {
  assert.match(DOWNLOADER_SRC, /require\("\.\/hash-index"\)/, "downloader 应 require hash-index");
  assert.match(DOWNLOADER_SRC, /hashIndex\.ingestModDir\(finalDir\)/, "finalizeHtmls 应调 ingestModDir");
  assert.equal(typeof hashIndex.ingestModDir, "function", "ingestModDir 是函数");
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
  // 清 saveGameFile 副作用（json/index/TestGameP3*.json，gitignored）
  try {
    const idxDir = path.resolve(__dirname, "..", "json", "index");
    for (const n of fs.readdirSync(idxDir)) if (n.startsWith("TestGameP3")) fs.unlinkSync(path.join(idxDir, n));
  } catch (_) {}
});
