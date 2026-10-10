// test/index-html-status.test.cjs —— HTML 文件表格「状态」列必须有真实数据来源
//
// 背景（2026-10-11 实测）：description.html 的文件表格有 `<th>状态</th>`，但单元格读的是 `f.exists`，
//   而 f 来自 GB 索引（obj.files[]）、从来没有 exists 字段 ⇒ 该列**恒为空**（表面有表头无数据）。
//   修复：接真实数据源——文件是否已落在该 mod 的下载目录（obj.dir）下。
//
// 测试隔离：临时目录用 os.tmpdir() + mkdtempSync 派生，不碰真实项目 json/ 与真实下载目录。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const log = makeLog("index-html-status");
const downloader = require(path.join(__dirname, "..", "server", "lib", "downloader.js"));

loggedTest(log, "HTML 文件表格状态列：按磁盘真实存在与否输出 已下载/未下载", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-idxhtml-"));
  try {
    fs.writeFileSync(path.join(dir, "present.zip"), "x");
    // 忠实于真实数据：obj.dir 是**相对**路径（仅供展示），绝对目录通过第 2 参数传入
    const obj = {
      name: "M", author: "A", game: "G", url: "https://gamebanana.com/mods/1", dir: "G/M",
      files: [
        { file: "present.zip", size: 1024, gbMd5: "abc" },
        { file: "missing.zip", size: 2048, gbMd5: "" }
      ],
      images: [], gifs: [], text: ""
    };
    const html = downloader.buildHtmlContent(obj, dir);
    assert.match(html, /<th>状态<\/th>/, "表头应含状态列");
    // 已存在文件 → 已下载；缺失文件 → 未下载（旧实现两行都是空单元格）
    const rows = html.split("<tr>").filter((r) => r.includes("present.zip") || r.includes("missing.zip"));
    assert.equal(rows.length, 2, "应有两行文件");
    assert.match(rows[0], /<td>已下载<\/td>/, "present.zip 应显示「已下载」");
    assert.match(rows[1], /<td>未下载<\/td>/, "missing.zip 应显示「未下载」");
    assert.ok(!/<td><\/td>/.test(html), "不应再出现空状态单元格");

    // 收尾已回填 f.exists 时优先用该字段（不额外 stat）
    const html2 = downloader.buildHtmlContent(Object.assign({}, obj, {
      files: [{ file: "missing.zip", size: 1, exists: true }]
    }), dir);
    assert.match(html2, /<td>已下载<\/td>/, "f.exists=true 时应显示「已下载」");

    // 拿不到绝对目录（只有相对 obj.dir）时不能瞎猜：如实显示 "-"
    const html3 = downloader.buildHtmlContent(Object.assign({}, obj, {
      files: [{ file: "present.zip", size: 1 }]
    }));
    assert.match(html3, /<td>-<\/td>/, "无绝对目录时应显示「-」而不是误判未下载");
    log.info("状态列已接真实数据源（绝对目录磁盘存在性 / f.exists 回填；无基准显示 -）");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
