// test/auto-update-github.test.cjs —— 自动更新 github 模式核心逻辑单测
//   1) isExcluded：运行态/敏感路径必须被排除，代码路径必须放行
//   2) copyTreeSafe：沙箱复制后运行态保留、代码更新、不误删目标多余文件
//   零网络依赖（不访问 GitHub），node --test 自动发现
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const log = makeLog("auto-update-github");
const au = require("../server/lib/auto-update.js");

// ---------- 1) isExcluded 排除规则 ----------
loggedTest(log, "isExcluded: 运行态/敏感路径必须排除", () => {
  const MUST_EXCLUDE = [
    "server/config.json",              // 服务配置（密码/Cookie）
    "json/gamebanana.com.json",        // 真实游戏配置（本地下载路径）
    "json/index",                      // HTML 反查索引目录
    "json/index/Genshin Impact.json",  // 索引内文件
    "json/sessions.json",              // 会话
    "json/download_task.json",         // 任务状态
    "json/search_cache.json",          // 搜索缓存
    "json/search_task.json",           // 搜索任务
    "json/userdata-manifest.json",     // 用户数据清单（SA6400 权威）
    "server/server.log",               // 日志（.log 后缀）
    "gamebanana-mods-downloader.pid",  // PID（.pid 后缀）
    "test/logs/smoke.log",             // 测试日志目录
    "@eaDir",                          // 群晖元数据
    "json/@eaDir/x.json",
    "node_modules",                    // 依赖
    ".auto-update-tmp/repo.tar.gz",    // 本模式临时目录
    ".auto-update-state.json",         // 状态文件
    "release/gbmd.zip",                // 构建产物
    "dist/x.js"
  ];
  for (const p of MUST_EXCLUDE) {
    assert.equal(au.isExcluded(p), true, "应当排除: " + p);
    log.pass("排除: " + p);
  }
});

loggedTest(log, "isExcluded: 代码/资源路径必须放行", () => {
  const MUST_PASS = [
    "server/app.js",
    "server/lib/auto-update.js",
    "server/routes/auto-update.js",
    "server/config.js",
    "server/public/index.html",
    "server/public/app.js",
    "start.sh",
    "start-linux.sh",
    "scripts/gen-mapping.js",
    "scripts/installer",
    "crx/extension/content.js",
    "crx/native-host/host.cjs",
    "mapping/Genshin Impact.json",       // 角色映射是代码资源，要更新
    "json/role/Genshin Impact.json",     // 角色缓存要更新
    "json/gamebanana.com.json.example",  // 示例配置要更新
    "json/userdata-manifest.json.example", // 示例（若存在）
    "docs/screenshots/01-login.jpg",
    "tool/bin/tar",                      // 静态工具二进制
    "test/p1-routes.test.cjs",           // 测试代码
    "test/helpers/test-log.cjs",
    "README.md"
  ];
  for (const p of MUST_PASS) {
    assert.equal(au.isExcluded(p), false, "应当放行: " + p);
    log.pass("放行: " + p);
  }
});

loggedTest(log, "isExcluded: .log/.pid 只按后缀排除（json/index 是目录前缀）", () => {
  // 精确规则不误伤同名前缀
  assert.equal(au.isExcluded("server/app.js"), false);
  assert.equal(au.isExcluded("json/indexer.js"), false);   // 不是 json/index 目录
  assert.equal(au.isExcluded("logs/README.md"), false);    // 不含 .log 后缀
  assert.equal(au.isExcluded("server/app.log.bak"), true); // 含 .log 子串后缀匹配
});

// ---------- 2) copyTreeSafe 沙箱复制 ----------
loggedTest(log, "copyTreeSafe: 运行态保留 + 代码更新 + 不误删目标多余文件", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-aut-test-"));
  try {
    // 源：模拟 tarball 解压出的代码树
    const src = path.join(sandbox, "src");
    fs.mkdirSync(path.join(src, "server", "lib"), { recursive: true });
    fs.mkdirSync(path.join(src, "json", "role"), { recursive: true });
    fs.writeFileSync(path.join(src, "server", "app.js"), "NEW-APP");
    fs.writeFileSync(path.join(src, "server", "lib", "auto-update.js"), "NEW-AU");
    fs.writeFileSync(path.join(src, "json", "role", "Genshin Impact.json"), "NEW-ROLE");
    fs.writeFileSync(path.join(src, "start.sh"), "NEW-START");
    fs.writeFileSync(path.join(src, "server", "config.json"), "GHOST-CONFIG"); // 源里也不该有（tarball 不含），但验证即使有也不覆盖
    fs.writeFileSync(path.join(src, "json", "gamebanana.com.json"), "GHOST-GAME");
    fs.writeFileSync(path.join(src, "json", "userdata-manifest.json"), "GHOST-MANIFEST");
    fs.writeFileSync(path.join(src, "server", "x.log"), "GHOST-LOG");

    // 目标：模拟 SA6400 部署目录（含运行态 + 一个源里没有的多余文件）
    const dst = path.join(sandbox, "dst");
    fs.mkdirSync(path.join(dst, "server"), { recursive: true });
    fs.mkdirSync(path.join(dst, "json", "index"), { recursive: true });
    fs.writeFileSync(path.join(dst, "server", "config.json"), '{"KEEP":"me"}');
    fs.writeFileSync(path.join(dst, "json", "gamebanana.com.json"), '{"KEEP":true}');
    fs.writeFileSync(path.join(dst, "json", "userdata-manifest.json"), '{"local":true}');
    fs.writeFileSync(path.join(dst, "json", "index", "Genshin Impact.json"), '{"idx":1}');
    fs.writeFileSync(path.join(dst, "gamebanana-mods-downloader.pid"), "1234");
    fs.writeFileSync(path.join(dst, "server", "server.log"), "LOG");
    fs.writeFileSync(path.join(dst, "README.keep.md"), "KEEP-ME"); // 目标多余文件

    au.copyTreeSafe(src, dst);

    // 运行态必须保留原值
    assert.equal(fs.readFileSync(path.join(dst, "server", "config.json"), "utf8"), '{"KEEP":"me"}', "config.json 不得覆盖");
    assert.equal(fs.readFileSync(path.join(dst, "json", "gamebanana.com.json"), "utf8"), '{"KEEP":true}', "gamebanana.com.json 不得覆盖");
    assert.equal(fs.readFileSync(path.join(dst, "json", "userdata-manifest.json"), "utf8"), '{"local":true}', "userdata-manifest 不得覆盖");
    assert.equal(fs.readFileSync(path.join(dst, "json", "index", "Genshin Impact.json"), "utf8"), '{"idx":1}', "json/index 不得覆盖");
    assert.equal(fs.readFileSync(path.join(dst, "gamebanana-mods-downloader.pid"), "utf8"), "1234", "pid 不得覆盖");
    assert.equal(fs.existsSync(path.join(dst, "server", "x.log")), false, "源里的 .log 不得复制");

    // 代码必须更新
    assert.equal(fs.readFileSync(path.join(dst, "server", "app.js"), "utf8"), "NEW-APP", "app.js 应更新");
    assert.equal(fs.readFileSync(path.join(dst, "server", "lib", "auto-update.js"), "utf8"), "NEW-AU", "auto-update.js 应更新");
    assert.equal(fs.readFileSync(path.join(dst, "json", "role", "Genshin Impact.json"), "utf8"), "NEW-ROLE", "角色缓存应更新");
    assert.equal(fs.readFileSync(path.join(dst, "start.sh"), "utf8"), "NEW-START", "start.sh 应更新");

    // 目标多余文件不得删除
    assert.equal(fs.existsSync(path.join(dst, "README.keep.md")), true, "目标多余文件不得删除");

    log.pass("运行态保留 / 代码更新 / 不误删");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

loggedTest(log, "copyTreeSafe: 嵌套排除（json/index 下所有文件都不复制）", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-aut-test2-"));
  try {
    const src = path.join(sandbox, "src");
    fs.mkdirSync(path.join(src, "json", "index"), { recursive: true });
    fs.mkdirSync(path.join(src, "json", "role"), { recursive: true });
    fs.writeFileSync(path.join(src, "json", "index", "a.json"), "IDX-A");
    fs.writeFileSync(path.join(src, "json", "role", "b.json"), "ROLE-B");
    const dst = path.join(sandbox, "dst");
    fs.mkdirSync(path.join(dst, "json"), { recursive: true });
    au.copyTreeSafe(src, dst);
    assert.equal(fs.existsSync(path.join(dst, "json", "index", "a.json")), false, "json/index 不得复制");
    assert.equal(fs.readFileSync(path.join(dst, "json", "role", "b.json"), "utf8"), "ROLE-B", "json/role 应复制");
    log.pass("嵌套排除正常");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
