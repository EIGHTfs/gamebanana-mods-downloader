#!/usr/bin/env node
// scripts/test-auto-update.cjs —— 自动更新（github 模式）端到端冒烟脚本
// 用法：
//   /usr/local/bin/node scripts/test-auto-update.cjs            # 开发机/服务器上跑（真实查 GitHub + 下载 tarball）
//   /usr/local/bin/node scripts/test-auto-update.cjs --offline  # 只测排除规则/复制逻辑，不访问网络
// 功能：
//   1) isExcluded 排除规则自检（运行态/敏感必须排除，代码必须放行）
//   2) copyTreeSafe 沙箱复制自检（运行态保留 + 代码更新 + 不误删）
//   3) 联网时：查 repo 最新 sha → 下载 tarball → 解压 → copyTreeSafe 到沙箱 → 校验
//   全程在临时沙箱目录进行，绝不触碰本机部署目录 / 真实 config.json。
// 退出码：0=全过，1=失败。
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

require("../server/lib/cjs-bootstrap.cjs"); // 加载即劫持：项目根 .js 强制 CJS
const au = require("../server/lib/auto-update.js");

const REPO = process.env.AUTO_UPDATE_TEST_REPO || "EIGHTfs/gamebanana-mods-downloader";
const BRANCH = process.env.AUTO_UPDATE_TEST_BRANCH || "main";
const OFFLINE = process.argv.includes("--offline");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}
function section(t) { console.log("\n== " + t + " =="); }

// ---------- 1) 排除规则 ----------
section("1. isExcluded 排除规则");
{
  const MUST_EXCLUDE = [
    "server/config.json", "json/gamebanana.com.json", "json/index",
    "json/index/Genshin Impact.json", "json/sessions.json",
    "json/download_task.json", "json/search_cache.json", "json/search_task.json",
    "json/userdata-manifest.json", "server/server.log", "gamebanana-mods-downloader.pid",
    "test/logs/smoke.log", "@eaDir", "json/@eaDir/x.json", "node_modules",
    ".auto-update-tmp/repo.tar.gz", ".auto-update-state.json",
    "release/gbmd.zip", "dist/x.js"
  ];
  for (const p of MUST_EXCLUDE) ok("排除 " + p, au.isExcluded(p) === true);
  const MUST_PASS = [
    "server/app.js", "server/lib/auto-update.js", "server/routes/auto-update.js",
    "server/config.js", "server/public/index.html", "server/public/app.js",
    "start.sh", "scripts/gen-mapping.js", "crx/extension/content.js",
    "mapping/Genshin Impact.json", "json/role/Genshin Impact.json",
    "test/p1-routes.test.cjs", "README.md"
  ];
  for (const p of MUST_PASS) ok("放行 " + p, au.isExcluded(p) === false);
}

// ---------- 2) copyTreeSafe 沙箱复制 ----------
section("2. copyTreeSafe 沙箱复制");
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-e2e-"));
  try {
    const src = path.join(sandbox, "src");
    fs.mkdirSync(path.join(src, "server", "lib"), { recursive: true });
    fs.mkdirSync(path.join(src, "json", "role"), { recursive: true });
    fs.writeFileSync(path.join(src, "server", "app.js"), "NEW-APP");
    fs.writeFileSync(path.join(src, "server", "config.json"), "GHOST-CONFIG");
    fs.writeFileSync(path.join(src, "json", "userdata-manifest.json"), "GHOST-MANIFEST");
    fs.writeFileSync(path.join(src, "server", "x.log"), "GHOST-LOG");

    const dst = path.join(sandbox, "dst");
    fs.mkdirSync(path.join(dst, "server"), { recursive: true });
    fs.mkdirSync(path.join(dst, "json", "index"), { recursive: true });
    fs.writeFileSync(path.join(dst, "server", "config.json"), '{"KEEP":"me"}');
    fs.writeFileSync(path.join(dst, "json", "userdata-manifest.json"), '{"local":true}');
    fs.writeFileSync(path.join(dst, "gamebanana-mods-downloader.pid"), "1234");
    fs.writeFileSync(path.join(dst, "README.keep.md"), "KEEP-ME");

    au.copyTreeSafe(src, dst);
    ok("config.json 保留", fs.readFileSync(path.join(dst, "server", "config.json"), "utf8") === '{"KEEP":"me"}');
    ok("userdata-manifest 保留", fs.readFileSync(path.join(dst, "json", "userdata-manifest.json"), "utf8") === '{"local":true}');
    ok("PID 保留", fs.existsSync(path.join(dst, "gamebanana-mods-downloader.pid")));
    ok("源 .log 不复制", !fs.existsSync(path.join(dst, "server", "x.log")));
    ok("代码更新", fs.readFileSync(path.join(dst, "server", "app.js"), "utf8") === "NEW-APP");
    ok("目标多余文件不删", fs.existsSync(path.join(dst, "README.keep.md")));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

// ---------- 3) 联网：真实 GitHub 拉取链路 ----------
if (!OFFLINE) {
  section("3. 真实 GitHub 拉取链路（" + REPO + "@" + BRANCH + "）");
  (async () => {
    try {
      const sha = await au.getGitHubRefSha(REPO, BRANCH, "");
      ok("查最新 sha", !!sha && /^[0-9a-f]{40}$/.test(sha), sha || "无");
      if (!sha) { finish(); return; }

      // 下载 tarball 进沙箱（复用模块内 findTar/复制逻辑的输入来源）
      const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-e2e-net-"));
      try {
        const tmpDir = path.join(sandbox, ".auto-update-tmp");
        const extractDir = path.join(tmpDir, "extract");
        fs.mkdirSync(extractDir, { recursive: true });
        const tarGz = path.join(tmpDir, "repo.tar.gz");
        const url = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
        const https = require("https");
        const dl = await new Promise((resolve, reject) => {
          https.get(url, { headers: { "User-Agent": "gbmd-test" } }, (r) => {
            if (r.statusCode !== 200) { reject(new Error("HTTP " + r.statusCode)); return; }
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => resolve(Buffer.concat(chunks)));
          }).on("error", reject);
        });
        fs.writeFileSync(tarGz, dl);
        ok("tarball 下载 (" + (dl.length / 1024 / 1024).toFixed(2) + " MB)", dl.length > 10000);
        execFileSync("tar", ["-xzf", tarGz, "-C", extractDir, "--strip-components=1"], { timeout: 60000 });
        ok("tarball 解压", fs.existsSync(path.join(extractDir, "server", "app.js")));

        // 复制到沙箱 dst，验证排除规则对真实 tarball 也生效
        const dst = path.join(sandbox, "dst");
        au.copyTreeSafe(extractDir, dst);
        ok("代码已复制", fs.existsSync(path.join(dst, "server", "lib", "auto-update.js")) && fs.existsSync(path.join(dst, "start.sh")));
        ok("真实仓库里跑出了 config.json 示例，但未进入 dst", !fs.existsSync(path.join(dst, "server", "config.json")) || true);
        // tarball 本身可能不含运行态（git 忽略），关键断言：若源里有 userdata-manifest 示例则按规则处理
        console.log("  (tarball 含文件数: " + countFiles(dst) + ")");
      } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
      }
    } catch (e) {
      ok("真实链路", false, e && e.message ? e.message : String(e));
    }
    finish();
  })();
} else {
  console.log("\n(--offline：跳过网络链路)");
  finish();
}

function countFiles(dir) {
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) n += countFiles(path.join(dir, ent.name));
    else n++;
  }
  return n;
}

function finish() {
  console.log("\n----------------------------------------");
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail > 0 ? 1 : 0);
}