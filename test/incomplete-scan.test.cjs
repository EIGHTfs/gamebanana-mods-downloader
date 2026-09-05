// test/incomplete-scan.test.cjs —— ② HTML 建索引时 part 文件整理 + 导出/导入 + 链接提取（一键追加下载用）
// scanModDir/toTaskJson/extractLinks 纯函数，用夹具（临时 mod 目录）实测，不依赖 cfg/网络
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const log = makeLog("incomplete-scan");

const { buildIndexBlock } = require("../server/utils/index-html");
const { scanModDir, toTaskJson, extractLinks } = require("../server/lib/incomplete-scan");

// 造假 mod 目录：description.html 内嵌索引块 + 指定文件落盘（其余即「缺失」）
function makeModDir(obj, existFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-scan-"));
  const html = "<!DOCTYPE html><html><body>" + buildIndexBlock(obj) + "</body></html>";
  fs.writeFileSync(path.join(dir, "description.html"), html, "utf8");
  for (const f of existFiles || []) fs.writeFileSync(path.join(dir, f), "x");
  return dir;
}

loggedTest(log, "scanModDir：.part 拋留 + 缺失文件 → 整理出未完成任务", () => {
  const obj = { schema: 1, modId: "54321", name: "TestMod", author: "Tester", game: "TestGame", url: "https://gamebanana.com/mods/54321", files: [{ file: "a.zip" }, { file: "b.png" }], gifs: [] };
  const dir = makeModDir(obj, ["a.zip", "a.gbmd.part"]); // a.zip 在，b.png 缺，a.gbmd.part 拋留
  try {
    const info = scanModDir(dir);
    assert.ok(info, "有 part + 缺失 → 返回未完成信息");
    assert.deepEqual(info.partFiles, ["a.gbmd.part"]);
    assert.deepEqual(info.missingFiles, ["b.png"]);
    assert.equal(info.modId, "54321");
    assert.equal(info.url, "https://gamebanana.com/mods/54321");
    assert.equal(info.recordedCount, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "scanModDir：完整 mod（无 part 无缺失）→ null", () => {
  const obj = { schema: 1, modId: "1", name: "C", author: "A", game: "G", url: "https://gamebanana.com/mods/1", files: [{ file: "x.zip" }], gifs: [] };
  const dir = makeModDir(obj, ["x.zip"]);
  try { assert.equal(scanModDir(dir), null, "完整 → null"); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "scanModDir：无 description.html → null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-noscan-"));
  try { assert.equal(scanModDir(dir), null, "无 html → null"); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

loggedTest(log, "toTaskJson + extractLinks：导出→序列化→反序列化→链接提取 round-trip（一键追加下载用）", () => {
  const o1 = { schema: 1, modId: "111", name: "M1", author: "A1", game: "G1", url: "https://gamebanana.com/mods/111", files: [{ file: "a.zip" }], gifs: [] };
  const o2 = { schema: 1, modId: "222", name: "M2", author: "A2", game: "G2", url: "https://gamebanana.com/mods/222", files: [{ file: "c.zip" }, { file: "d.png" }], gifs: [] };
  const d1 = makeModDir(o1, []); // a.zip 缺失
  const d2 = makeModDir(o2, []); // c.zip + d.png 缺失
  try {
    const r1 = scanModDir(d1), r2 = scanModDir(d2);
    const taskJson = toTaskJson([r1, r2]);
    assert.equal(taskJson.schema, "gbmd-tasks-v1");
    assert.equal(taskJson.count, 2);
    assert.equal(taskJson.tasks.length, 2);
    assert.deepEqual(taskJson.tasks[0].missingFiles, ["a.zip"]);
    assert.deepEqual(taskJson.tasks[1].missingFiles, ["c.zip", "d.png"]);
    // round-trip：导出的 json 经序列化/反序列化后仍能提取链接（供一键追加 /api/download）
    const roundTripped = JSON.parse(JSON.stringify(taskJson));
    assert.deepEqual(extractLinks(roundTripped), ["https://gamebanana.com/mods/111", "https://gamebanana.com/mods/222"]);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

loggedTest(log, "extractLinks：纯 modId（无 url）→ 提取 modId 作链接", () => {
  assert.deepEqual(extractLinks({ tasks: [{ modId: "999", url: "" }] }), ["999"]);
});

loggedTest(log, "extractLinks：去重（同 url 两次 → 一条）", () => {
  const u = "https://gamebanana.com/mods/5";
  assert.deepEqual(extractLinks({ tasks: [{ url: u }, { url: u }] }), [u]);
});
