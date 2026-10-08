// test/gb-verify.cjs —— 联网实测脚本（**不参与** `node --test` 自动发现：文件名不带 .test）
//
// 验证「三种搜索通道」里**按角色**那条链路的四个能力，全部打真实 GameBanana API：
//   ① 搜游戏          searchGames(keyword)                  → 设置页「搜索游戏」用
//   ② 角色列表        fetchGameCharacterList(gameId, game)   → 两层下探 + 分类网址
//   ③ 角色名 → 网址   fetchRoleUrl(gameId, game, role)       → 分类页 https://gamebanana.com/mods/cats/<id>
//   ④ 按分类抓 mod    fetchModsByCategory(gameId, catId)     → 该角色分类下的全量 mod
//
// 用法（参数派生，无硬编码绝对路径）：
//   node test/gb-verify.cjs                                  # 默认 Genshin Impact(8552) / Aether，读缓存不写盘
//   node test/gb-verify.cjs --refresh                        # 额外强制重抓角色列表（补分类网址，会写 json/role/<游戏>.json）
//   node test/gb-verify.cjs 20357 "Wuthering Waves" 长离       # 指定 游戏id / 游戏名 / 角色名
//   环境变量同名可覆盖：GB_GAME_ID / GB_GAME / GB_ROLE
//
// 退出码：0 四项全通过；1 有任一项失败（详情见输出）。需要能访问 gamebanana.com。
"use strict";

const path = require("node:path");
require(path.join(__dirname, "..", "server", "lib", "cjs-bootstrap.cjs"));
const gbApi = require(path.join(__dirname, "..", "server", "lib", "gb-api"));

const argv = process.argv.slice(2);
const REFRESH = argv.includes("--refresh");
const rest = argv.filter((a) => !a.startsWith("--"));
const GAME_ID = Number(rest[0] || process.env.GB_GAME_ID || 8552);
const GAME = rest[1] || process.env.GB_GAME || "Genshin Impact";
const ROLE = rest[2] || process.env.GB_ROLE || "Aether";

let failed = 0;
function ok(label, cond, detail) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
}

(async () => {
  console.log(`═══ 联网实测：游戏「${GAME}」(id ${GAME_ID}) / 角色「${ROLE}」${REFRESH ? " / --refresh" : ""} ═══`);

  // ① 搜游戏：关键词 → id 候选
  console.log("\n① 搜游戏 searchGames()");
  const games = await gbApi.searchGames(GAME.split(/[\s–-]/)[0] || GAME, 5);
  for (const g of games) console.log(`   · ${g.id}  ${g.name}${g.abbr ? "  (" + g.abbr + ")" : ""}  ${g.profileUrl}`);
  ok("搜到游戏候选", games.length > 0, `命中 ${games.length} 条`);

  // ② 角色列表：两层下探 + 分类网址
  console.log(`\n② 角色列表 fetchGameCharacterList(refresh=${REFRESH})`);
  const t0 = Date.now();
  const chars = await gbApi.fetchGameCharacterList(GAME_ID, GAME, REFRESH);
  const withUrl = chars.filter((c) => c.url);
  console.log(`   角色 ${chars.length} 个，带分类网址 ${withUrl.length} 个，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const c of chars.slice(0, 5)) console.log(`   · ${c.name} → ${c.url || "(无分类网址)"}`);
  ok("角色列表非空", chars.length > 0, `${chars.length} 个`);
  ok("存在带分类网址的角色", withUrl.length > 0, `${withUrl.length} 个（旧缓存无网址时加 --refresh）`);

  // ③ 角色名 → 分类网址
  console.log(`\n③ 角色名 → 分类网址 fetchRoleUrl("${ROLE}")`);
  const url = await gbApi.fetchRoleUrl(GAME_ID, GAME, ROLE);
  console.log("   " + (url || "(未取到)"));
  ok("取到分类网址", /\/mods\/cats\/\d+$/.test(url || ""), url);

  // ④ 按分类抓 mod
  const catId = gbApi.catIdFromUrl(url);
  console.log(`\n④ 按分类抓 mod fetchModsByCategory(catId=${catId})`);
  if (catId) {
    const { records, hasMore } = await gbApi.fetchModsByCategory(GAME_ID, catId, 1, 5);
    for (const r of records) console.log(`   · ${r.id}  ${String(r.name).slice(0, 52)}  ${r.profileUrl}`);
    ok("抓到该分类下的 mod", records.length > 0, `首页 ${records.length} 条，还有更多=${hasMore}`);
  } else {
    ok("抓到该分类下的 mod", false, "没有 catId（先看 ③）");
  }

  console.log(failed ? `\n❌ 有 ${failed} 项未通过` : "\n✅ 四项全部通过");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL: " + ((e && e.stack) || e)); process.exit(1); });
