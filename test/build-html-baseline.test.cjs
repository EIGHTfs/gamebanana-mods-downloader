// test/build-html-baseline.test.cjs —— 2026-10-15 新增：description.html 输出等价性基准
//
// 用途：**拆 genIndexHtml（59）/ finalizeHtmls（67）之前**先钉死最终产物。
//   这两个大函数的复杂度来自"编排"（多步骤/多分支），真正产出 HTML 的是纯函数
//   buildHtmlContent(obj, absDir)。所以基准钉在它身上：同一份 fixture → 同一段 HTML，
//   编排怎么拆都不该让 HTML 变样（页面上看不出来，只有逐字节基准能挡住）。
//
// 确定性说明：buildHtmlContent 不取当前时间（时间来自 obj.dateAdded/dateModified），
//   且 fixture 不传 absDir、文件状态显式给 exists ⇒ 输出与磁盘/时钟无关。
//
// 基准更新（仅在**故意**改 HTML 时）：BUILD_HTML_SHOW=1 node --test test/build-html-baseline.test.cjs
// 确定性（2026-10-18 修）：buildHtmlContent 用 toLocaleDateString("zh-CN") 渲染日期
//   （见 server/lib/downloader.js 的 fmtDate），结果**随宿主时区变化** ⇒
//   实测同一份夹具：TZ=UTC 得 d5b7bff8…、TZ=Asia/Shanghai 得 d77a827a…，
//   原基线常量是在别的时区采集的，换台机器就必红。
//   产品侧按本地时区显示是正确行为，所以在这里**钉死测试时区**，而不是去改产品。
//   必须在任何 Date 使用之前设置（模块加载期就生效）。
process.env.TZ = "Asia/Shanghai";
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const log = makeLog("build-html-baseline");

// 基准值（14 个夹具，时区已钉死在 Asia/Shanghai ⇒ 与宿主无关、可跨机复跑）。
// 拆 genIndexHtml / finalizeHtmls 后必须保持一致。
const EXPECTED_SHA = "d77a827a995154e6b19b55f7deea83a9d6f7643c21f5916b4aa07960c7578452";

/** 覆盖 buildHtmlContent 各分支的 fixture（都不传 absDir，文件状态显式给，避免依赖磁盘） */
function fixtures() {
  return [
    ["最小对象", { name: "A", author: "B" }],
    ["空集合", { name: "A", author: "B", files: [], images: [], text: "" }],
    ["文件三态（已下载/未下载/未知）", {
      name: "A", files: [
        { file: "a.zip", size: 1024, gbMd5: "abc", exists: true },
        { file: "b.zip", size: 2048, exists: false },
        { file: "c.zip", size: 0, hash: "h", exists: undefined }
      ]
    }],
    ["图片网格", { name: "A", images: [{ file: "a.png" }, { file: "b.gif" }] }],
    ["gif 外链本地化（有 localFile）", {
      name: "A", gifs: [{ url: "https://x/y.gif", localFile: "y_1.20MB.gif" }],
      text: '<img src="https://x/y.gif">'
    }],
    ["gif 无 localFile 兜底命名", { name: "A", gifs: [{ url: "https://x/z.gif" }], text: "see https://x/z.gif end" }],
    ["图片外链精确替换（有 url）", {
      name: "A", images: [{ file: "p.png", url: "https://f/g/p.png" }], text: '<img src="https://f/g/p.png">'
    }],
    ["图片外链按名兜底替换", {
      name: "A", images: [{ file: "q.png" }], text: '<img src="https://files.gamebanana.com/img/ss/mods/q.png">'
    }],
    ["分类拼接", { name: "A", category: "UI", superCategory: "Mods" }],
    ["仅 superCategory", { name: "A", superCategory: "Mods" }],
    ["HTML 转义", {
      name: '<A & "B">', author: "<b>", text: "<script>x</script>",
      files: [{ file: "<f>.zip", size: 1, gbMd5: "<m>", exists: true }]
    }],
    ["时间字段（秒级与毫秒级）", { name: "A", dateAdded: 1700000000, dateModified: 1700000000000 }],
    ["无描述占位", { name: "A", text: "" }],
    ["绝对 dir 触发磁盘存在性检查", {
      name: "A", dir: "/tmp", files: [{ file: "gbmd-baseline-not-exist-9f3a.zip", size: 1 }]
    }]
  ];
}

loggedTest(log, "description.html 逐字节基准（拆编排函数前后必须一致）", () => {
  const { buildHtmlContent } = require("../server/lib/downloader.js");
  assert.equal(typeof buildHtmlContent, "function", "downloader 应导出 buildHtmlContent");

  const parts = [];
  for (const [name, obj] of fixtures()) {
    const html = buildHtmlContent(obj, undefined);
    assert.equal(typeof html, "string", name + " 应返回字符串");
    assert.ok(html.startsWith("<!DOCTYPE html>"), name + " 应是完整 HTML 文档");
    parts.push(name + "\u0000" + html);
  }
  const sha = crypto.createHash("sha256").update(parts.join("\u0001"), "utf8").digest("hex");
  console.log("[build-html-baseline] sha256 = " + sha + "  （夹具 " + parts.length + " 例）");
  if (process.env.BUILD_HTML_SHOW === "1") return;   // 采集模式：只打印
  assert.equal(sha, EXPECTED_SHA, "description.html 输出与基准不一致（HTML 被改动了）");
});
