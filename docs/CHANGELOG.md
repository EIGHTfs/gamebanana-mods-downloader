# 版本列表

> 本文件是**版本记录的唯一维护位置**（README 只留一句指向这里）。
>
> 维护方式：由 dsh-git-push 插件的 `scripts/doc-version.mjs` 从 **git log** 聚合生成 ——
> `gen` 打印 / `apply` 写盘 / `check` 查漂移（有漂移非零退出，可接 CI）。
> 规则：**提交标题里带版本号**（如 `fix: 1.3.6 — 修 xxx`）才会进下面的自动表；不带版本号的提交不进表。
>
> 下面「历史版本」是启用该工具之前手写的记录，原样保留（在标记块之外，不会被 `apply` 覆盖）。

<!-- dshgp-version:start -->
## 版本列表

| 版本 | 内容 |
|------|------|
| 4.5.0 | 油猴脚本改为模板组装产物（基于 4.5.0 重做）+ boot.cjs 进程级兜底 |
| 1.5.0 | 版本记录 1.5.0 |
| 1.3.6 | 1.3.6 — 版本列表外置到 docs/CHANGELOG.md（由 git-push 的 doc-version 维护）；同步版本列表（doc-version apply，收进 1.3.6 行） |
| 1.3.2 | 下载优先级/列表折叠/记住设备（v1.3.2） |

<!-- dshgp-version:end -->

## 历史版本（工具启用前，人工维护）

| 版本 | 内容 |
|---|---|
| 1.0.0 | 独立仓库初始化（重构 P0–P4：routes/ 拆分、utils/ 去重、auth 异步、crx/ 整合） |
| 1.1.0 | P5 改密校验旧密码 + P6 导入=纯追加、任务事件日志、便携测试、文档重写 |
| 1.2.0 | 自动更新（watch / git / github 三模式 + 防抖重启 + 前端开关 UI）；github 模式无需服务端 .git，定时从 GitHub 拉取并安全更新代码 |
| 1.2.1 | bugfix：GB 登录检测修复——GB 会话绑定浏览器完整 UA（OS+版本号），保存 Cookie 时自动同步当前浏览器 UA 到 `gbUserAgent`，解决 UA 不匹配导致 `_bIsLoggedIn` 始终返回 false 的问题 |
| 1.3.0 | 三种独立搜索通道 + 设置页搜游戏：① 搜索页拆成「按关键词 / 按角色 / 按时间」三条独立通道（以前只有时间、关键词两种，「角色」实际走的就是关键词搜索，只按标题匹配会漏）；② 新增 `GET /api/role-mods`——角色 → 香蕉网分类网址 → `catId` → `_aFilters[Generic_Category]` 抓该角色**全量** mod（拿不到网址时自动刷新角色列表补网址，仍无则明确报错并指引，不再回退关键词搜索）；③ `json/role/<游戏>.json` 的 `characters` 改为对象数组 `[{name,url}]`（旧格式读取自动归一化 + 首次用到该游戏时懒迁移补网址）；④ 角色列表抓取由**一层**改为**两层下探**（修 bug：原神这类 `Skins → Characters → 角色` 两层结构原先一个角色都取不到），实测原神 144 个角色、130 个带分类网址；⑤ 设置页「➕ 添加游戏」新增「搜游戏」——按游戏名搜香蕉网游戏返回 id 候选，点选填入表单（新增 `GET /api/gb-search-games`）；⑥ 新增 `test/gb-role-category.test.cjs`（10 项）与联网实测脚本 `test/gb-verify.cjs`；README 测试章节同步真实结果（42/54，12 项为模板化遗留，见待办第 3 条） |
| 1.3.1 | 接入模板通用网页截图脚本：`assemble.json` 增加 `templates/tools/page-shot.mjs → scripts/page-shot.mjs`（模板侧新增该脚本，下游按需接入）。用法：`node scripts/page-shot.mjs [--base URL] [--password 密码] [--tabs a,b] [--plan shots.json]`——自动推导端口、自动登录、自动发现 `.tab[data-tab=…]` 逐标签截图并收集 `console.error`/`pageerror`，输出到系统临时目录（`--out` 可改）。另把本轮改动的三个模板下发件（`js/app.js`、`html/tab-panel/panel-search.html`、`panel-settings.html`）同步回模板仓库，避免下次组装覆盖 |
| 1.3.2 | README 新增「界面预览」六图（登录 / 下载 / 下载进度 / 搜索三通道 / 设置 / 搜游戏）——此前 `docs/screenshots/` 里的图从未被 README 引用；全部改由模板截图脚本在部署端实测生成（含真实下载进行中的进度页），旧图移入 `docs/screenshots/.trash/`（`.trash` 已被忽略）。`scripts/page-shot.mjs` 同步模板最新版（新增 `select`/`scroll` 步骤与单张截图 `full:false` 只截视口） |
| 1.3.3 | 界面预览改为**夜间模式**为主（设置页给白天/夜间两张对照），进度页**打码**后再出图（模糊 mod 名/URL/目标路径/缩略图，保留进度条与速度 —— 对外宣传「看得出在下载、看不出下的具体是什么」）。配套：`scripts/page-shot.mjs` 新增 `--theme dark\|light` 与打码四件套（`--redact`/`--redact-text`/`--redact-images`/`--redact-exclude`）；`login.html` 补 `<script src="theme-init.js">`（此前登录页不跟随已选主题，永远白天） |
| 1.3.4 | 文档与仓库元数据优化：① 界面预览图片改用 **jsDelivr CDN** 绝对地址 —— GitHub 默认图片域名 `raw.githubusercontent.com` 在国内多数网络不可达（实测 HTTP 000），用相对路径时 README 裂图；② README 开篇重写（点明零依赖/单进程/自托管，并把「按角色分类全量抓取」「四步下载」提到亮点位置），核心能力表首行改为「三种搜索通道」；③ 仓库简介与 GitHub topics 由自动生成的占位改为实际内容（16 个关键词：gamebanana / mod-downloader / game-mod / nodejs / zero-dependency / self-hosted / web-ui / downloader / nsfw / nas / synology / hoyoverse / genshin-impact / honkai-star-rail / userscript / chrome-extension） |
| 1.3.5 | 修油猴脚本「添加密码报 HTTP 200」：脚本管理器（Tampermonkey/Violentmonkey）默认隐藏响应头 `Set-Cookie`，旧逻辑要求解析到它才算登录成功 → 密码正确也判失败。现 `POST /api/login` 在响应体回传 `token` + `cookieName`，脚本按「响应体 token → 响应头 Set-Cookie → GM_cookie → `/api/status` authed 兜底」取会话。同时修面板文案：把「有凭证但 GB 会话失效」与「未配置凭证」分开显示（原来都显示「○ 服务器未配置凭证」，明明 `cookieSet=true` 却报未配置，误导排查）。实测：无头 chromium 跑真实脚本 + 假 gamebanana 页面 + 本地沙箱服务端，7/7 断言通过，「🔄 注入登录态到浏览器」注入前后 cookie jar 0 → 27 项（含 HttpOnly 的 sess/rmc） |
| 1.3.0 | 代码质量重构：crx/background.js 拆分（432→105行，提取 constants/settings/probe/cookie/search/download 6个模块）；server/lib/downloader.js prepareMod 拆分（298→82行，提取 step2FindAndMove/step3TrashRestore/step4MarkExists）；空 catch 块加注释；魔数提取为常量；删除冗余 docs/ 副本 |
| 1.3.1 | 代码质量重构续：server/public/app.js bindSettings 拆分（430→17行，提取 bindSettingsGames/SettingsCookie/SettingsScanIncomplete/SettingsTaskIO/SettingsSecurity/SettingsHashQuery/SettingsHashSearch 7个子函数）；bindMerge 拆分（227→8行，提取 bindMergeMapping/bindMergeAutoUpdate 2个子函数） |
| 1.2.5 | **同步模板：自动更新间隔治理 + 失败退避** —— `github` 模式默认间隔 300 → **3600 秒（1 小时）**；连续失败按设定值 ×2 退避（最多 3 次：1h→2h→4h→8h，成功后立即复位）；三种模式的区别写进前端下拉与卡片说明；间隔统一钳制到 `[30, 86400]`。验证脚本 `test/auto-update-interval.test.cjs`（13 项）+ `test/auto-update-backoff.test.cjs`（10 项）全通过 |
| 1.2.4 | **同步模板：自动更新不再排除 `server/boot.cjs`** —— 该文件的进程级异常兜底（`uncaughtException` / `unhandledRejection`）此前因排除规则永远下发不到部署端，现可经自动更新生效。仍保留 `start*.sh` / `server/setup.sh` / `server/config.json` 等启停入口与运行态配置的排除 |
| 1.2.3 | **油猴脚本改为模板组装产物（基于 4.5.0 重做）**：`scripts/gamebanana-cookie-userscript.user.js` 改由 bench-template 组装生成（通用片段 `templates/userscript/cookie-fetch/` ＋ 本项目特化片段 `templates/_downloader/_gamebanana-mods/userscript/`）；`assemble.json` 加 `commands` 后，`bash bench-template/setup.sh --to assemble.json` 会自动重建脚本。顺带修：三处会话 cookie 名硬编码 `"session="` 改用内核 `sessionHeaders()`（服务端会话名是 `gbmd_session`，硬编码会导致服务端登录后带不上会话）；`server/boot.cjs` 补进程级兜底（`uncaughtException` / `unhandledRejection` 记日志而不让进程退出）。验证：产物 `node --check` 通过、端到端回归 5/5 |
| 1.2.2 | **凭证卡 JS 绑定补齐（修 `2a61b4d` 的遗漏）**：`2a61b4d` 已把凭证卡改为系级 `@frag` 片段（提供 `cookieInput`/`saveCookieBtn`/`cookieStatus`），但 `server/public/app.js` 仍在查旧 id（`$("#gbCookie")`）与旧名（`#gbLoginCheckBtn`/`#gbLoginStatus`），导致设置页凭证输入框读不到、保存按钮空转（片段与绑定对不上）。本次把 `app.js` 绑定对齐片段 id；顺带把两个下载器项目共用的 toast 类名中性化（`gbmdToast`→`appToast`、`gbmd-toast`→`app-toast`，它本就通用、命名不该带 gbmd 前缀）。后端 API 字段名 `gbCookie` 保持不变 |
| 1.3.2 | 新功能：①下载优先级——图片/gif 排前优先下载；②下载列表分组折叠/展开（默认展开，状态记忆）；③登录页「记住此设备」——勾选后 30 天免登录（默认勾选，解决登录太频繁），时长可配置 `sessionRememberHours` |
| 1.5.1 | **日期范围模块归位 `framework/search/`**：模板把「按时间搜索的日期窗口解析」从 `framework/assemble/` 拆出独立 `search/` 子目录（assemble/ 只管页面片段装配）。本项目同步：`server/assemble/search-date-range.cjs` → `server/search/search-date-range.cjs`，`routes/search.js` 引用随之更新。同时清掉 `server/lib/search-date-range.cjs`——它是同内容的孤儿副本（原先 routes 引的是它、assembly 那份反而没人用），易误改错文件；删除前确认 git 有历史可恢复。README 目录结构段落同步实际布局：删掉写了但实际不存在的 `server/utils/` 行；`framework/` 平铺描述改为 8 个功能子目录（core/route/auth/http/config/store/update/assemble/search）；`lib/` 清单补上实际存在的 index-html / json-dir / auto-update / cjs-bootstrap，并把已归框架 `store/` 的 data-backup 从清单移除 |
| 1.5.0 | **框架目录迁移对接模板新结构**：`server/framework/` 平铺 22 个文件 → 8 个按功能分子目录（`core/` `route/` `auth/` `http/` `config/` `store/` `update/` `assemble/`）+ `lib/`。①`assemble.json` 由整目录条目改为逐文件条目，`start.sh` 与 `cjs-bootstrap.cjs` 落位到项目根与 `server/lib/`；②引用改写 34 处（19 个文件）——含 12 个 `server/routes/*.js` 业务路由：它们不在清单里、却 require 框架模块，迁移工具原先只处理「清单提到的文件」，会漏掉这批，表现为迁移后启动报 `Cannot find module '../framework'`；③`.gitignore` 补 `server/templates/` 与 `server/project/blueprint/`（组装来源素材，非本项目源码）；④README 正文框架路径同步为实际结构。本项目业务代码除引用路径外无改动。启动验证：`/`→302、`/api/images`→401（正常鉴权） |
| 1.4.3 | **修复下载中途整进程崩溃**（SA6400 上「服务莫名消失」的真因）：`server/lib/downloader.js` 的 `doFetch` 里 `const stallTimer` 声明在响应回调内，却在兄弟作用域 `req.on("error")` 中 `clearInterval(stallTimer)`——请求在响应到达前就失败（网络中断 / TLS 错误 / 超时）时抛 `ReferenceError: stallTimer is not defined`，未捕获异常直接打死整个 Node 进程，日志停在栈回溯、无任何优雅退出记录。现将声明提升到 `doFetch` 作用域（`let stallTimer = null`），并对未赋值场景加空值防护。同步模板 v1.6.2 的 `start.sh`（端口精确匹配 + 启动前等端口释放） |
| 1.4.2 | 下载列表 gif 预览：原 `isImgOk` 显式排除 `item.isGif`，gif 行没有缩略图；服务端 `/api/image` 本就返回 `image/gif`，故去掉排除条件，gif 与静态图同样预览，右下角加 GIF 角标区分。顶栏「油猴脚本」入口补 `btn` 类——它是 `<a>`，此前按钮规则限定 `button.` 前缀，拿不到边框底色 |
| 1.4.1 | 同步模板 1.5.0：①顶栏徽章元素 id 由 `gbUserBadge` 统一为 `UserBadge`（`topbar/badge.html` + `app.js` 三处选择器），CSS 不再需要按项目名分支；②补上 `style.css` 漏引的 `mod-group.css` / `grid-map.css` 片段——下载列表分组折叠样式此前未进入组装产物，点击分组表头无折叠动画；③框架 `app.js` 新增 `server.drain()` 优雅关停：自动更新重启前等在途响应写完，避免静态资源被截断（表现为「刚更新完页面样式不对」）；④`auto-update` 复制新版本期间挂起文件监听，避免复制途中的中间态触发误重启 |
| 1.4.0 | 服务端模板化改造：HTTP 层改用 dl-server-template 通用框架——`server/framework/` 提供 createServer（鉴权门/静态文件/setup 跳转/HTML 资源注入钩子）与 createRoute（`{"METHOD /path": handler}` 表式路由 + ctx.query/params）；11 个 routes 全部改写为表式导出；`app.js` 从 234 行降到 150 行的纯装配层；framework 补齐通用能力（公开路由白名单、未设密码放行、cookie 名可配、定时清理会话、API 日志过滤） |
| 1.4.1 | bugfix：①github 模式自动更新首次运行误判「有新版本」——无状态文件时只记录基线，不再全量覆盖并重启（原逻辑 `undefined !== sha` 恒为真）；start.sh/boot.cjs/setup.sh 加入更新排除列表，保护重启入口；②静态资源版本号 `mtimeMs \| 0` 32 位溢出成负数，改 `Math.floor`；③framework `readBody` 二次读同一请求流导致 POST 请求永久挂起，加结果缓存 |
| 1.5.0 | 备份恢复改用框架层 `createBackup`（配置驱动），删除项目内 `lib/data-backup.js`（框架层原实现改为复用 `marker-manifest`，修正带引号的 `desc="..."` 被原样输出的问题）；`userdata-manifest.json` 改为不入库（导出时自动生成，缺失时自动重建） |
| 1.6.0 | 下载列表预览图点击放大（灯箱）：缩略图此前固定 56×56，GIF 缩略图看不出内容。现点缩略图弹出大图查看，点遮罩空白处 / Esc / 滚轮关闭，点图片本身不关闭（便于细看）；大图与缩略图同源（服务端 `/api/image` 直接回原图），无需新增接口。CSS 落在模板片段 `blueprint/fragments/styles/row-thumb.css`——此前误写在风格层 `style.css`（那只是 26 行 `@frag` 骨架，运行期由 framework/fragment-assembler 展开），写在骨架里的规则不会进入组装产物。同时补齐模板里早有、本项目一直缺的 `a.mm-play-btn` 按钮外观（+8 行）：播放按钮是 `<a>`，不显式补样式会回落成裸链接 |
