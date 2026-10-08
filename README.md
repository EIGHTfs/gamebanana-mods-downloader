# GameBanana Mod Downloader

> **从 [GameBanana](https://gamebanana.com) 搜索、下载并自动整理 Mod 的零依赖 Node.js 服务** —— 单进程、无 npm 依赖（无 `package.json`）、自带网页界面，NAS / 小主机上跑一个进程、局域网浏览器直接用。
> 亮点：**按角色分类全量抓取**（关键词搜不到的同人 mod 也能一网打尽）、**四步下载**（断点续传 / 重试 / 停滞检测 / 自动归位）、**HTML 反查**，并附浏览器扩展与油猴脚本在 GB 页面**一键发送**到服务器。

**核心能力一览**

| 能力 | 说明 |
|---|---|
| 🔍 三种搜索通道 | ① 关键词（中文/别名自动归一为英文规范名）② **按角色**（直接抓该角色的香蕉网分类，全量不漏）③ 按时间（新增/修改/更新 OR） |
| ⬇ 四步下载流程 | 生成 HTML → 查重归位 → 整理 → 并发下载（断点续传/重试/跳过）；下载内容可选压缩包 / 预览图 |
| 📁 自动整理 | 按「仓库/角色（英文 – 中文）/作者」规范路径存放；旧目录自动归位、重复进回收站（`.trash` 可恢复） |
| 🔍 HTML 反查 | 输入文件 MD5 / 图片原始短名（GB 原名）反查所属 mod；三索引（GB 线上表 + 本地表 + HTML 原名表） |
| 🗂 文件夹合并 | 纯英文目录按映射重命名为「英文 – 中文」规范名；清理空目录 |
| ⚙️ 网页设置 | 游戏下载路径、GB Cookie、密码、映射管理、并发数，全部网页操作 |
| 🍌 油猴脚本 | 浏览器打开 GB 页面 → 一键把当前 mod 发送到服务器下载 |
| 🧩 浏览器扩展 | Chrome MV3 扩展 + 原生消息宿主（`crx/`），同样一键发送 |
| 🌗 主题 | 白天 / 夜间（香蕉风）一键切换 |

---

## 快速开始

**环境要求**：Node.js 20+（零 npm 依赖，无 package.json，无需安装任何包）。

```bash
# 1. 克隆仓库
git clone git@github.com:EIGHTfs/gamebanana-mods-downloader.git && cd gamebanana-mods-downloader

# 2. （可选）设置访问密码
./start.sh --set-password "你的密码"

# 3. 启动（无参默认 restart；未运行会直接启动）
./start.sh
# 浏览器打开 http://127.0.0.1:8642
```

> 未设置密码时**只警告、可直接使用**（局域网内任何人可访问，建议尽快设置）。
> 首次启动自动生成 `server/config.json`（默认端口 8642）。
> 零依赖纪律：**禁止在本项目内创建 package.json**；`.js` 通过 `boot.cjs` 强制按 CommonJS 加载（父目录若是 `"type":"module"` 也不会被误判）。

**启停（POSIX 用 `start.sh`，Windows 用 `start-windows.bat`）**

| 命令 | 作用 |
|---|---|
| `./start.sh` | 重启（默认；未运行则直接启动） |
| `./start.sh start [--port 8642]` | 启动 |
| `./start.sh stop` | 停止（先 TERM 后 KILL，只杀 PID 文件里的进程） |
| `./start.sh status` | 状态（进程 / HTTP 健康检查 / 日志） |
| `./start.sh --set-password "新密码"` | 设置访问密码（不启动服务） |

PID 文件：项目根 `gamebanana-mods-downloader.pid`（不入库）。日志超过 10MB 在 start/restart 时轮转。

---

## 网页界面

四个选项卡：**⬇ 下载 / 📊 下载进度 / 🔍 搜索 / ⚙ 设置**，右上角主题切换。

| 选项卡 | 功能 |
|---|---|
| 下载 | 批量输入 mod 链接或纯数字 id；可勾选「压缩包 / 预览图」（记住到设置）；一键开始；图片优先下载 |
| 下载进度 | 每个文件的实时状态（下载中/成功/跳过/失败）、进度条、预览图（点击缩略图放大查看，Esc/滚轮/点遮罩关闭）；失败可单独重试/跳过；并发数即时调节；任务 json 导入/导出；分组可折叠/展开（默认展开，状态记忆） |
| 搜索 | **三种独立搜索通道**：① 按关键词（中文/角色名/别号自动归一到英文）② 按角色（直接抓该角色的香蕉网分类，全量不漏）③ 按时间（新增/修改/更新任一命中）；结果勾选后一键下载 |
| 设置 | 游戏下载路径（可读取本地目录）、GB Cookie 与登录检测、映射管理、文件夹合并、HTML 反查、修改密码（需旧密码） |

### 界面预览

> 截图由模板的通用截图脚本生成：`node scripts/page-shot.mjs --password <访问密码> --theme dark`
> （自动登录 → 切主题 → 逐标签截图 → 收集前端错误；进度页可加 `--redact-text/--redact-images` 打码）。
>
> 图片走 jsDelivr CDN（`cdn.jsdelivr.net/gh/…`）：GitHub 默认的图片域名 `raw.githubusercontent.com` 在国内多数网络不可达，用相对路径时 README 会显示裂图。

| 登录（夜间） | 下载（夜间） |
|---|---|
| ![登录](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/01-login.jpg) | ![下载](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/02-download.jpg) |

| 下载进度（夜间，敏感信息已打码） | 搜索：三种独立通道（夜间） |
|---|---|
| ![下载进度](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/03-progress.jpg) | ![搜索](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/04-search.jpg) |

| 设置（夜间） | 设置（白天） |
|---|---|
| ![设置-夜间](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/05-settings-night.jpg) | ![设置-白天](https://cdn.jsdelivr.net/gh/EIGHTfs/gamebanana-mods-downloader@main/docs/screenshots/06-settings-day.jpg) |

---

## 目录结构（2026-09 模板化改造后）

> 服务端 HTTP 层改用 dl-server-template 模板的通用框架（`server/core/` 等 8 个按功能分层的子目录），
> 本项目只需提供配置、业务模块与路由表，不再自带 HTTP 服务/鉴权门/静态文件实现。

```
gamebanana-mods-downloader/
├── start.sh                  # 启停脚本（start/stop/restart/status/set-password）
├── server/
│   ├── boot.cjs              # 入口：CJS 强制引导（零依赖，解决 ESM 父目录问题）
│   ├── app.js                # 装配层：初始化配置/鉴权 + 挂载路由 + 启动钩子 + 资源版本注入
│   ├── core/ route/ auth/    # 通用框架（模板同步，勿手改；改模板后整体覆盖）
│   │   http/ config/ store/  #   按功能分层，不再是 framework/ 平铺
│   │   update/ assemble/ search/
│   │   ├── core/app.js       # createServer：HTTP 服务 + 鉴权门 + 静态文件 + setup 跳转
│   │   ├── route/route-factory.js # createRoute：{"METHOD /path": handler} 表式路由 + ctx(query/params)
│   │   ├── auth/auth.js      # 会话鉴权（scrypt 由项目侧提供；cookie 名可配；定时清理）
│   │   ├── config/config-loader.js # createConfig：schema 驱动配置读写
│   │   ├── update/auto-update.js   # 自动更新（watch/git/github 三模式 + 防抖重启）
│   │   ├── update/routes-auto-update.js # 自动更新通用路由
│   │   ├── search/search-date-range.cjs # 按时间搜索的日期窗口解析（前后端共用规则）
│   │   └── ...               # http/http-utils、core/app-log、http/fs-async、store/data-backup 等
│   ├── config.js             # 配置管理（config.json 自动初始化；读取游戏/映射；scrypt 密码）
│   ├── routes/               # API 路由：每个文件导出 createRoute({...}) 表
│   ├── lib/
│   │   ├── downloader.js     # 四步下载流程 + 并发/断点续传/重试/跳过 + 任务事件日志
│   │   ├── gb-api.js         # GameBanana API 封装（mod 解析/搜索/Cookie 清洗）
│   │   ├── mapping.js        # 映射与下载路径计算（仓库层/角色层/[作者] mod名）
│   │   ├── search.js         # 按时间搜索（三时间字段 OR）
│   │   ├── hash-index.js     # HTML 反查三表（GB 线上表 + 本地表 + HTML 原名表）
│   │   ├── organize.js       # 自动整理（外部遗留 → 垃圾桶）
│   │   ├── merge-dirs.js     # 文件夹合并（英文目录 → 英文 – 中文）
│   │   ├── incomplete-scan.js# 未完成任务扫描
│   │   ├── index-html.js     # index.html 生成
│   │   ├── app-log.js        # 日志：时间戳 + [task]/[api] 事件
│   │   ├── json-dir.js       # 数据目录入口（薄壳，转发框架 store/）
│   │   ├── auto-update.js    # 自动更新入口（薄壳，转发框架 update/）
│   │   └── cjs-bootstrap.cjs # CJS 强制（模板下发）
│   └── public/               # 前端（index.html + app.js）
├── crx/                      # 浏览器扩展（Chrome MV3）+ 原生消息宿主
├── json/
│   ├── gamebanana.com.json   # 游戏配置（id/cn/downloadPath，git 忽略）
│   ├── index/<游戏名>.json   # HTML 反查索引（每游戏一文件，git 忽略）
│   └── role/<游戏名>.json    # 角色列表缓存（每游戏一文件）
├── mapping/                  # 每个游戏的仓库/角色映射（如 Genshin Impact.json）
├── scripts/                  # 油猴脚本（/userscript 附件下载）
└── test/                     # node:test 测试（node --test 全绿）
```

---

## 游戏配置（json/gamebanana.com.json）

记录每个游戏：**英文名（key）+ 香蕉网 id + 中文名（cn）+ 下载路径（downloadPath）**。

```json
{
  "Genshin Impact": {
    "id": 8552,
    "cn": "原神",
    "downloadPath": "/path/to/your/Mods/Genshin Impact/"
  }
}
```

> ⚠️ **安全说明**：真实配置（含本机下载路径）保存在本地 `gamebanana.com.json`，已被 `.gitignore` 忽略，**不会上传**。网页「设置 → 添加游戏」中配置即可。

内置示例游戏（id 为香蕉网权威 id）：

| 游戏 | 香蕉网 id | 中文名 |
|---|---|---|
| Honkai Impact 3rd | 10349 | 崩坏 3 |
| Genshin Impact | 8552 | 原神 |
| Honkai Star Rail | 18366 | 星穹铁道 |
| Zenless Zone Zero | 19567 | 绝区零 |
| Wuthering Waves | 20357 | 鸣潮 |
| Arknights: Endfield | 21842 | 终末地 |

---

## 映射（mapping/<游戏名>.json）

映射决定下载路径怎么算。格式：

```json
{
  "warehouses": { "characters": "角色", "weapons": "武器", "skins": "角色/.角色" },
  "roles": { "Sandrone": "桑多涅", "Varesa": "瓦雷莎" },
  "variants": { "桑多涅": "Sandrone", "danhenglunae": "Dan Heng Imbibitor Lunae" }
}
```

- **warehouses**：香蕉网大仓库 → 本地目录（`skins: "角色/.角色"` 表示隐藏子目录，点开头）
- **roles**：角色英文 → 中文（目录名 = `英文 – 中文`）
- **variants**：搜索归一变体（中文/别名 → 规范英文）

映射可在网页「设置 → 映射管理」中**手动添加**（选游戏 → 选仓库 → 从香蕉网拉取角色列表 → 填中文名）。

### 角色列表缓存（json/role/&lt;游戏名&gt;.json）

搜索页「按角色」与设置页「映射管理」共用同一份角色列表，落盘格式：

```json
{
  "gameId": 8552,
  "characters": [
    { "name": "Aether", "url": "https://gamebanana.com/mods/cats/19510" }
  ],
  "at": 1759
}
```

- `url` = 该角色的香蕉网**分类页**（`apiv11/Mod/Categories` 记录里的 `_sUrl`）。「按角色」搜索就是取它的 `catId`，再走 `_aFilters[Generic_Category]` 抓该分类**全量** mod（原实现走关键词搜索，只按标题匹配、会漏）。
- 角色列表来源：游戏根分类里匹配 `/character|skin/i` 的根（如 `Skins`）→ 取其子分类；若子分类是**容器分区**（`Characters`/`Weapons` 等）则再下探一层取真角色。例：原神 `Skins(17510)` → `Characters(18140)` → 130 个角色分类（实测 144 个角色里 130 个带分类网址）。
- 旧格式（只有名字的字符串数组）读取时自动归一化，并在**首次用到该游戏时**重新抓取补网址（懒迁移）；本地 mapping 手加的角色在香蕉网没有对应分类，`url` 为空。

---

## 下载四步流程

输入 `https://gamebanana.com/mods/704164` 或纯数字 `704164`：

**① 生成 HTML**：拉取 GB ProfilePage，生成 `description.html`（作者/游戏/分类/文件 MD5/图片/gif），并计算下载路径：
`下载根目录 / 仓库层(映射) / 角色层(英文 – 中文) / [作者] mod名`

**② 查重归位**：全游戏根目录按文件名索引，搜索压缩包名/图片名——若已存在于其他文件夹 → 整个文件夹 `mv` 到计算出的规范路径（文件全部保留，HTML 覆盖）；重复残留目录进根目录 `.trash`（可恢复）。

**③ 整理阶段**：
- `.gbmd.part` 处理：主文件 + part 都存在 → 删 part；仅 part → 保留（断点续传）
- 文件名一律按 **GB 原名**保存（压缩包/图片/gif 都不重命名；图片就是 GB 短名 `_sFile`，不是内容 MD5）

**④ 正式下载**：按 HTML 文件列表并发下载缺失文件（Range 断点续传、失败重试、停滞检测）；不改原始文件名，非法字符用空格替换。

- **下载内容勾选**（下载页，写入 `config.json` 的 `downloadToggles`）：
  - **压缩包**：GB `_aFiles` + 归档文件。关掉则第四步不入队压缩包，HTML 仍记录文件表。
  - **预览图**：GB 原图 + 简介里的 gif。关掉则图片和 gif 都不下。gif 失败仍自动跳过（不强求）。
  - `description.html` **始终生成**（查重/反查依赖它，不提供关闭）。
- **归档文件**：GB 的旧归档版本（`_aArchivedFiles`）一并下载（受「压缩包」勾选控制）
- **gif 不强求**：下载失败自动跳过（不重试、不显示失败）；下载成功才以 GB 原名加入 HTML
- **垃圾桶找回**：下载时若 `.trash` 里有同名文件（含 `dup-归位-` 前缀目录），自动找回而非重新下载
- **任务事件日志**：暂停/继续/终止/完成/导入追加 都会写 `[task]` 日志（`server/server.log`，带时间戳）

### 任务导入 = 纯追加（不会覆盖）

导入/提交 mod 链接（网页、`/api/task/import`、`/api/receive`、油猴、扩展）**一律追加**，没有覆盖路径：

| 任务状态 | 导入行为 |
|---|---|
| 运行中 / 准备中 / 已暂停 | 直接追加到队列尾部，**已有列表不清空**（paused 会自动恢复下载） |
| 已完成（done） | 完成列表保留展示；新任务开始（导入）前清空旧批次 → 追加到空 |
| 已终止（点「终止」按钮） | 终止 = 清空队列；之后导入 = 新建任务（追加到空） |

> 看起来像「覆盖」的操作，实际都是「追加到空」——队列被终止/新任务清空后再追加。终止按钮是唯一清空队列的入口。

---

## HTML 反查（三索引）

网页「设置 → HTML 反查」：输入文件 MD5 **或图片原始短名**（GB 原名，如 `69b46e18405cc.jpg`），反查它属于哪个 mod。

索引按游戏分文件存 `json/index/<游戏名>.json`，每文件含三块：

| 索引 | 内容 |
|---|---|
| GB 线上信息表 | hash → mod 名/作者/游戏/链接/GB 文件名 |
| 本地信息表 | hash → 本机实际下载目录/文件名 |
| HTML 原名表 | GB 原名（图片短名/压缩包名）→ mod |

**查询行为**：
- **本地表命中**（本机下载过）→ 显示 mod 信息 + **本机实际目录**
- **仅 GB 表命中**（线上有、本机没下）→ 显示线上信息 + **「下载此 mod」按钮**
- **HTML 原名表命中**（输入图片短名）→ 从全部 description.html 反查所属 mod
- **离线目录搜索**：按 mod 名/作者模糊搜 GB 表（无需连香蕉网），未下载的可一键下载

**索引维护**：启动自动加载三表；每次新下载写完 HTML → **自动增量并入**（新 hash/原名立即可查）；全量重建用设置页「重建索引」。

---

## 浏览器扩展（crx/）

Chrome MV3 扩展 + 原生消息宿主，功能同油猴脚本（打开 GB mod 页面一键发送到服务器下载）。

```text
crx/
├── extension/      # MV3 扩展（manifest.json + content.js + background.js + popup）
└── native-host/    # 原生消息宿主（host.cjs + 安装脚本 install-linux.sh）
```

安装方式：浏览器加载已解压的 `crx/extension`；原生宿主按 `crx/native-host/install-linux.sh` 安装注册。

---

## 油猴脚本（scripts/）

页面顶部「📥 油猴脚本」按钮 → 下载 `scripts/gamebanana-cookie-userscript.user.js`（单一来源；入口 URL 必须是 `/gamebanana-cookie-userscript.user.js`——`.user.js` 后缀是油猴扩展弹安装的硬要求，`/userscript` 无后缀无效）。用途：浏览器打开 gamebanana.com 后点右下角 🍌，检测登录态/用户名 + 复制完整 Cookie（含 HttpOnly，供设置页填 `gbCookie`），并可把当前 mod 一键发送到服务器下载。

---

## 测试

零依赖 `node:test`，无 package.json：

```bash
node --test                     # 自动发现 test/**/*.test.cjs
node test/gb-verify.cjs         # 联网实测：按角色链路的四项能力（见下）
node test/gb-verify.cjs --refresh   # 同上，并强制重抓角色列表补分类网址（会写 json/role/<游戏>.json）
```

当前 **54 项：42 通过 / 12 失败**。新增 `test/gb-role-category.test.cjs`（10 项：分类网址解析、角色缓存新旧格式归一化、角色缓存数据、三通道接线守卫）与 `test/gb-verify.cjs`（联网实测脚本，不参与自动发现）均通过；覆盖还包括路由清单（P1）、去重工具（P2）、bug#1 接线（P3）、auth 清过期 token / fs-async（P4）、改密旧密码（P5）、导入=纯追加（P6）、数据导入 manifest、gif 命名、未完成扫描、CJS 加载冒烟。

> ⚠️ 那 12 项失败是**模板化改造遗留**：`p1-routes`/`p2-dedup`/`p3-bug1`/`p4-auth-cleanup`/`incomplete-scan`/`scripts/test-auto-update` 仍 `require("../server/utils/*")`，而该目录已拆成 `server/core|http|route|config|store|update|assemble/`。详见「待办」第 3 条。

测试日志落 `test/logs/<名>.log`。

---

## 常见问题

**Q: 未设置密码能直接用吗？**
A: 可以（只警告）。但局域网内任何人可访问，建议 `./start.sh --set-password "密码"`。

**Q: 下载的 mod 在哪？**
A: 按 `gamebanana.com.json` 里该游戏 `downloadPath` + 仓库/角色/[作者] 目录结构。

**Q: 重复文件会删吗？**
A: 不会删。整理时重复文件/目录统一移入游戏根目录 `.trash`（可恢复）。

**Q: NSFW/需登录的 mod 下不了？**
A: 在「设置」填入浏览器登录 gamebanana.com 后的完整 Cookie（`sess=...; rmc=...`），点「检测登录状态」验证。

**Q: Cookie 明明有效，为什么「检测登录状态」显示未登录？**
A: GameBanana 会话绑定了**登录时浏览器的完整 User-Agent**（含 OS + 浏览器版本号）。必须从**登录 GB 的那个浏览器**打开 GBMD 设置页保存 Cookie——保存时会自动同步该浏览器的 UA。如果从另一个浏览器打开设置页保存，UA 不匹配会导致登录检测失败。

**Q: 导入任务会不会把现有队列清掉？**
A: 不会。导入 = 纯追加；只有点「终止」才清空队列（终止后导入 = 新建任务）。

**Q: 登录太频繁 / 每次都要输密码？**
A: 登录页默认勾选「**记住此设备**」——勾选后签发 **30 天**长会话（cookie + session 同步失效时间），期间免登录。不勾选则按默认 `sessionHours`（72 小时）。长会话时长可在 `server/config.json` 的 `sessionRememberHours` 调整（小时）。

**Q: 下载时图片和压缩包哪个先下？**
A: 图片/gif 优先（每个 mod 的预览图先下载），压缩包后下——下载列表分组的全部项仍是同一组，整组完成后才从列表移除。

---

## 待办（进行中）

### 1. ✅ 已完成：设置页「搜索游戏」→ 返回游戏 id 候选

- 后端 `GET /api/gb-search-games?q=`（走 `apiv11/Util/Search/Results?_sModelName=Game`，返回 `{id,name,abbr,profileUrl}`）。
- 前端设置页「➕ 添加游戏」卡片内新增「搜游戏」输入框 + 候选列表，点候选 → 填入 `#addGameId` → 自动走既有「获取游戏名 → 预览 → 添加到游戏列表」流程。
- 实测：`Genshin` → `8552 Genshin Impact (GI)`。

### 2. ✅ 已完成：三种独立搜索通道（按关键词 / 按角色 / 按时间）

- 以前只有两种通道（按时间、按关键词），「角色」实际上走的就是关键词搜索（只按标题匹配）。
- 现在拆成三条独立通道，各有独立按钮：
  - ① 按关键词：`GET /api/keyword-search`（保留，浏览器扩展 crx 也走它）
  - ② 按角色：`GET /api/role-mods`（角色网址 → catId → `_aFilters[Generic_Category]` 抓全量；拿不到网址时自动刷新角色列表补网址，仍无则明确报错并指引，**不再回退关键词搜索**）
  - ③ 按时间：`POST /api/search`（原有）
- `json/role/<游戏>.json` 的 `characters` 由字符串数组改为对象数组 `[{name,url}]`（旧格式读取自动归一化 + 懒迁移补网址）。
- 实测（原神）：角色 144 个、带分类网址 130 个；`Aether → /mods/cats/19510` → 抓出该分类真实 mod 列表。

### 3. 存量测试未跟上模板化改造（12 项红）

- 状态：待处理
- 现象：`node --test` 有 12 项失败，全部集中在 6 个**模板化改造前**的测试文件。
- 根因：这些文件仍 `require("../server/utils/*")`，而该目录在 2026-09 模板化改造中已拆成 `server/core|http|route|config|store|update|assemble/`（例：`utils/path-safe` → `http/path-safe.js`、`utils/index-html` → `lib/index-html.js`、`utils/fs-async` → `http/fs-async.js`；`utils/http`、`utils/html` 需进一步定位对应模块）。
- 涉及文件：`test/p1-routes.test.cjs`、`test/p2-dedup.test.cjs`、`test/p3-bug1.test.cjs`、`test/p4-auth-cleanup.test.cjs`、`test/incomplete-scan.test.cjs`、`scripts/test-auto-update.cjs`（另 `bug#5`/`isExcluded`/`copyTreeSafe` 等用例随这些文件一起红）。

### 4. 两个文件已超 400 行，待按功能拆分

- 状态：待处理
- `server/lib/gb-api.js` 601 行（香蕉网 API 封装：抓取/分类/角色/搜索混在一起）、`server/public/app.js` 2009 行（前端单体：下载/搜索/设置/进度全在一个文件）。
- 拆分建议：`gb-api.js` 按「游戏信息 / 分类与角色 / mod 搜索与解析」拆成 `lib/gb-*.js` 由 `gb-api.js` 再导出（保持调用方导入路径不变）；前端按「下载 / 搜索 / 设置 / 进度」拆成 `public/js/*.js` 由 `index.html` 按序引入。

---

## 版本

> 版本记录已**外置**到 **[docs/CHANGELOG.md](docs/CHANGELOG.md)** —— 由 dsh-git-push 插件的 `doc-version`
> 从 git log 聚合（`apply` 更新 / `check` 查漂移，可接 CI），启用该工具前的历史版本一并保留在该文件里。

当前版本：**1.3.6**
