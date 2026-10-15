// test/index-html-merge.test.cjs —— 2026-10-15 新增
//
// 覆盖 genIndexHtml 拆分出来的**纯合并逻辑**（原先是 92 行函数里的两个内联 IIFE，
// 圈复杂度 59 的审计 blocker 大头就在这里）：
//   · mergeHtmlFiles  —— 旧 HTML 文件记录 + 网上新文件记录 的合并规则
//   · mergeHtmlImages —— 图片记录（gbFile 保留原名、hash 从旧记录继承）
// 拆成纯函数后才可能被单测覆盖；这些规则直接决定"作者删掉的文件还能不能寻回"，
// 所以必须钉死，而不是只靠拆分后"看起来没变"。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");

const log = makeLog("index-html-merge");

loggedTest(log, "mergeHtmlFiles：旧记录只留带下载地址的；新记录同名更新、新名追加、保留旧 hash", () => {
  const { mergeHtmlFiles } = require("../server/lib/downloader.js");
  const existing = {
    files: [
      { file: "old-keep.zip", url: "https://gamebanana.com/dl/1", size: 10, gbMd5: "AAA", hash: "h1" },
      { file: "old-no-url.zip", size: 20 },                        // 无 url ⇒ 不写进新 HTML
      { file: "dup.zip", url: "https://gamebanana.com/dl/2", size: 30, hash: "h2" },
      { file: "DUP.zip", url: "https://gamebanana.com/dl/3", size: 31 }   // 大小写重复 ⇒ 丢弃
    ]
  };
  const mod = {
    files: [
      { file: "dup.zip", url: "https://gamebanana.com/dl/new", size: 99, md5: "BBB", description: "d" },
      { file: "brand-new.zip", url: "https://gamebanana.com/dl/9", size: 5, md5: "CCC" }
    ]
  };
  const out = mergeHtmlFiles(existing, mod);

  assert.equal(out.length, 3, "应是 old-keep + dup(更新) + brand-new 三条");
  const keep = out.find((x) => x.file === "old-keep.zip");
  assert.ok(keep, "带 url 的旧记录必须保留");
  assert.equal(keep.legacy, true, "旧记录应标 legacy");
  assert.equal(keep.hash, "h1");

  const dup = out.find((x) => x.file === "dup.zip");
  assert.equal(dup.url, "https://gamebanana.com/dl/new", "同名应更新为网上最新记录");
  assert.equal(dup.size, 99);
  assert.equal(dup.gbMd5, "bbb", "md5 统一小写");
  assert.equal(dup.hash, "h2", "更新时必须保留旧记录的内容 hash（重下据此判断内容已在库）");
  assert.equal(dup.legacy, undefined, "更新后的记录不再是 legacy");

  const fresh = out.find((x) => x.file === "brand-new.zip");
  assert.equal(fresh.hash, "", "全新记录无旧 hash");
  assert.equal(fresh.url, "https://gamebanana.com/dl/9");
});

loggedTest(log, "mergeHtmlFiles：无旧记录 / 空集合时安全返回", () => {
  const { mergeHtmlFiles } = require("../server/lib/downloader.js");
  assert.deepEqual(mergeHtmlFiles(null, {}), [], "无旧记录且无新文件 ⇒ 空数组");
  const onlyNew = mergeHtmlFiles(undefined, { files: [{ file: "a.zip", url: "u", size: 1 }] });
  assert.equal(onlyNew.length, 1);
  assert.equal(onlyNew[0].file, "a.zip");
});

loggedTest(log, "mergeHtmlImages：gbFile 保留 GB 原名；hash 从旧记录继承（file 或 gbFile 命中）", () => {
  const { mergeHtmlImages } = require("../server/lib/downloader.js");
  const existing = {
    images: [
      { file: "a.png", gbFile: "a.png", hash: "hA" },
      { file: "renamed-md5.png", gbFile: "b.png", hash: "hB" }   // file 被整理改名，靠 gbFile 命中
    ]
  };
  const mod = {
    images: [
      { file: "a.png", url: "u1" },
      { file: "b.png", url: "u2" },
      { file: "c.png", url: "u3" },
      { url: "https://files.gamebanana.com/img/ss/mods/z.png?x=1" }   // 无 file ⇒ 从 URL 取 basename
    ]
  };
  const out = mergeHtmlImages(existing, mod);

  assert.equal(out.length, 4);
  assert.equal(out[0].file, "a.png");
  assert.equal(out[0].gbFile, "a.png", "gbFile 必须保留 GB 原名");
  assert.equal(out[0].hash, "hA", "同 file 命中旧记录 ⇒ 继承 hash");
  assert.equal(out[1].hash, "hB", "靠 gbFile 命中旧记录 ⇒ 也要继承 hash");
  assert.equal(out[2].hash, "", "无旧记录 ⇒ 空 hash");
  assert.equal(out[3].file, "z.png", "无 file 时应从 URL 取 basename 并去掉 query");
});
