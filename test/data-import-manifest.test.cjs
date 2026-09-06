// test/data-import-manifest.test.cjs —— 数据导入安全：伪造 userdata-manifest.json 文件列表不被通过
//   bug#4 完整修复：zip 内清单被忽略，一律以本地清单为白名单；
//   伪造清单（绝对路径/父目录穿越/越权合法路径如 server/app.js）一律不恢复。
const { makeLog, loggedTest } = require("./helpers/test-log.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dataBackup = require("../server/lib/data-backup");
const log = makeLog("data-import-manifest");

// 本地清单（可信白名单）：只放行 json/gamebanana.com.json
const LOCAL_M = { schema: 1, app: "gamebanana-mods-downloader", files: [{ rel: "json/gamebanana.com.json" }], dirs: [] };

// 造一个解压目录：内含伪造清单 + 可选伪造文件（不写真实 APP_ROOT）
function makeOut(forgedFiles, forgedDirs, forgedFilesInZip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gbmd-test-"));
  const outDir = path.join(tmp, "out");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "userdata-manifest.json"), JSON.stringify({
    schema: 1, app: "gamebanana-mods-downloader", files: forgedFiles || [], dirs: forgedDirs || []
  }));
  for (const f of (forgedFilesInZip || [])) {
    const p = path.join(outDir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "forged");
  }
  return { tmp, outDir };
}

loggedTest(log, "伪造清单被忽略：绝对/穿越/越权代码路径文件一律不恢复", () => {
  const { tmp, outDir } = makeOut(
    [{ rel: "/etc/passwd" }, { rel: "../../etc/passwd" }, { rel: "server/app.js" }, { rel: "../secret" }],
    [{ rel: "../.." }],
    ["server/app.js", "etc/passwd"]
  );
  const r = dataBackup.restoreFromDir(outDir, LOCAL_M);
  assert.equal(r.ok, true);
  assert.equal(r.restored.length, 0, "伪造清单列的文件都不应恢复");
  fs.rmSync(tmp, { recursive: true, force: true });
});

loggedTest(log, "无本地白名单文件时不写盘（空恢复）", () => {
  const { tmp, outDir } = makeOut([{ rel: "/etc/passwd" }], [], []);
  const r = dataBackup.restoreFromDir(outDir, LOCAL_M);
  assert.equal(r.ok, true);
  assert.deepEqual(r.restored, []);
  fs.rmSync(tmp, { recursive: true, force: true });
});
