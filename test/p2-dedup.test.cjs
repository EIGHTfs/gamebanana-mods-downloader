// test/p2-dedup.test.cjs —— P2 去重：parseIndexObj/buildIndexBlock/readIndexObj 抽 utils/index-html，escapeHtml 抽 utils/html
//   1) 往返行为不变（build→parse→原对象；readIndexObj 读 description.html）
//   2) organize.parseIndexObj 同源 utils（去重生效，非本地副本）
//   3) escapeHtml 转义不变
//   4) organize/hash-index/incomplete-scan 加载即验证无 ReferenceError（downloader 由 live smoke 覆盖）
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const log = makeLog("p2-dedup");

const indexHtml = require("../server/utils/index-html");
const { escapeHtml } = require("../server/utils/html");
const organize = require("../server/lib/organize");
require("../server/lib/hash-index");   // 加载即验证：parseIndexObj/readIndexObj 来自 utils 无 ReferenceError
require("../server/lib/incomplete-scan");

loggedTest(log, "parseIndexObj/buildIndexBlock 往返一致（原行为不变）", () => {
  const obj = { schema: 1, name: "test", files: [{ file: "a.zip" }] };
  const html = "<html>" + indexHtml.buildIndexBlock(obj) + "</html>";
  assert.deepEqual(indexHtml.parseIndexObj(html), obj);
  assert.equal(indexHtml.parseIndexObj(""), null);           // 空输入
  assert.equal(indexHtml.parseIndexObj("<html></html>"), null); // 无索引块
  assert.equal(indexHtml.parseIndexObj('<script id="gbmd-index" type="application/json">{"x":1}</script>'), null); // schema!==1 无效
});

loggedTest(log, "readIndexObj 读 description.html（原行为不变）", () => {
  const tmp = path.join(os.tmpdir(), "gbmd-p2-" + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  const obj = { schema: 1, name: "rt" };
  fs.writeFileSync(path.join(tmp, "description.html"), "<x>" + indexHtml.buildIndexBlock(obj) + "</x>");
  assert.deepEqual(indexHtml.readIndexObj(tmp), obj);
  assert.equal(indexHtml.readIndexObj(path.join(tmp, "nope")), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

loggedTest(log, "organize.parseIndexObj 同源 utils（去重生效）", () => {
  assert.equal(organize.parseIndexObj, indexHtml.parseIndexObj, "organize 应 re-export utils 版本");
  assert.equal(organize.readIndexObj, indexHtml.readIndexObj, "organize 应 re-export utils 版本");
});

loggedTest(log, "escapeHtml 转义（原行为不变）", () => {
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(0), "0");
});
