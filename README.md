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
| 下载进度 | 每个文件的实时状态（下载中/成功/跳过/失败）、进度条、预览图（点击缩略图放大查看，Esc/滚轮/点遮罩关闭）；失败可单独重试/跳过；并发数即时调节；任务 json 导入/导出；分组可折叠/展开（默认展开，状态记忆）；**列表移除方式可选**（设置页 `taskListRemoval`：整组完成才一起移除（默认）/ 每个文件完成即移除）—— 默认模式下预览图下完后仍留在列表里可见，直到该 mod 的压缩包也下完才整组消失 |
| 搜索 | **三种独立搜索通道**：① 按关键词（中文/角色名/别号自动归一到英文）② 按角色（直接抓该角色的香蕉网分类，全量不漏）③ 按时间（新增/修改/更新任一命中）；结果勾选后一键下载 |
| 设置 | 游戏下载路径（可读取本地目录）、GB Cookie 与登录检测、映射管理、文件夹合并、HTML 反查、修改密码（需旧密码） |

### 界面预览

> 截图由模板的通用截图脚本生成：`node scripts/page-shot.mjs --password <访问密码> --theme dark`
> （自动登录 → 切主题 → 逐标签截图 → 收集前端错误；进度页可加 `--redact-text/--redact-images` 打码）。
>
> **进度页配图用固化脚本**（元素选择不再现推，避免漏掉文件名）：
> `GB_BASE=http://<本机IP>:8642 GB_PWD=<访问密码> bash scripts/shot-progress.sh`
> —— 打码覆盖分组头的 mod 标识/香蕉网 URL、目标目录、行内文件名、进行中文件名（按扩展名）、缩略图与 `/volume` 路径；
> 保留进度条、统计行、速度、状态文字与顶栏品牌（`--redact-exclude .brand-block`）。
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

> **2026-10-11 变更：不再自动回填「内容 md5」**（旧逻辑已注释保留）。
> 原因：反查的主键是 GB 自带的 `gbMd5`（随 HTML 落盘）与 **GB 原名**（图片短名本身即 GB 的 hash，
> 原名表还支持无后缀补全），内容 md5 只是第三层冗余键；而它要对每个「尚无 hash」的文件**读整份内容**算 md5
> —— 实测批次收尾持续 ≈7–8MB/s 读盘，连 `/api/task` 都被拖到无响应。
> 需要内容 hash 时：临时恢复 `server/lib/downloader.js`（finalizeHtmls）里注释的补算段即可 ——
> 「重建索引」只重建索引表（读 description.html 的 JSON 块），**不会**补算内容 md5。
>
> **遗留物无需处理**：旧 md5 命名的文件、以及 `im.hash` 相关分支（downloader.js 的 `md5name` 匹配等）都不必清理 ——
> 反查以 `gbMd5` 与 GB 原名为准；实测某图片条目 `hash` 为空也能正常按名反查（返回 `source:"html"`）。
> 重新下载旧文件亦无影响（新下载仍按下载流算 hash，只是额外信息，不再回填历史文件）。
> 另注：反查**不必写后缀** —— 输入 `69b46e18405cc` 与 `69b46e18405cc.jpg` 都能命中
> （按「忽略已记录名的后缀」匹配，大小写也不敏感；压缩包名同理）。

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

### 3. ✅ 已完成：存量测试跟上模板化改造（原 12 项红 → 86/86 全绿）

- 结果：`node --test` **86 项全绿**（改造前 64 项 / 52 通过 / 12 失败）。
- 修法：
  ① **require 路径按现结构改写**：`utils/index-html`→`lib/index-html`、`utils/http`→`http/http-utils`、`utils/path-safe`→`http/path-safe`、`utils/html`→`http/html-utils`、`utils/fs-async`→`http/fs-async`、`lib/json-dir`→`store/json-dir`；`routes/auth.js` 的 `../server/auth` 改为 `../server/auth/auth`（该目录无 index.js）。
  ② **测试收集方式随范式更新**：`createRoute` 改成表式导出后，旧写法「传假 api 对象拦截 `route`/`routePublic`」收集到 0 条。模板侧在工厂返回值上挂了**只读路由表**（`templates/js/route/route-factory.js` 的 `routeHandler.routes`），`test/p1-routes.test.cjs` 直接读表，`test/p5-bug5.test.cjs` 从表里取 change-password handler + `require.cache` 注入 mock 配置 + mock req/res 调用。
  ③ **路由清单按实际注册更新为 11 文件 / 58 条**：拆分前 51 条**一条未丢**；新增 7 条来自后续功能（`auto-update` 文件 4 条、`GET /api/gb-search-games`、`GET /api/role-mods`、`settings` 的 `* /api/status` 展开为 GET+POST）。
  ④ `start*.sh` 断言对齐 2026-10-08 的「保护重启入口」设计（从「应放行」改为「应排除」），并修正 `copyTreeSafe` 对 `dst/start.sh` 的过时期望。
  ⑤ p4 的 auth 用例按框架版 API 重写：无 `auth.sessions` 导出 → 用 `loadSessions()` 取条数、`createSession({hours})` 返回 `{token}`、`pruneExpired` 取代 `cleanupExpired`；断言改用**相对条数**避免用例间共享内存会话互相污染。

### 4. 两个文件已超 400 行，待按功能拆分

- 状态：待处理
- `server/lib/gb-api.js` 601 行（香蕉网 API 封装：抓取/分类/角色/搜索混在一起）、`server/public/app.js` 2009 行（前端单体：下载/搜索/设置/进度全在一个文件）。
- 拆分建议：`gb-api.js` 按「游戏信息 / 分类与角色 / mod 搜索与解析」拆成 `lib/gb-*.js` 由 `gb-api.js` 再导出（保持调用方导入路径不变）；前端按「下载 / 搜索 / 设置 / 进度」拆成 `public/js/*.js` 由 `index.html` 按序引入。
- 另：`server/lib/downloader.js` 里 `genIndexHtml`（圈复杂度 59）与 `finalizeHtmls`（84）远超审计阈值 10，
  提交时会被 `maintainability/max-cyclomatic-complexity` 拦截。2026-10-11 的落盘优化只改落盘路径、未触碰这两个函数，
  提交时按既有处置用 `audit:false` 放行——**拆分后应恢复门禁**。
- 2026-10-11 结论（**先量后拆**，避免凭直觉拆函数）：两者**都不在「每文件」热路径**上——
  `genIndexHtml` 每 mod 调一次但只有 3 个 `await`、**0 个同步 fs**（I/O 受限，CPU 占比低）；
  `finalizeHtmls` **每批仅一次**（批次收尾），但含 8 处同步 fs 调用 + 6 个循环，万级任务时可能在「全部完成」瞬间阻塞事件循环。
  已在收尾处埋耗时探针（日志出现 `[task] finalizeHtmls 收尾耗时 Nms`），下一批下载跑完即可用**真实数字**决定是否拆分；
  拆分本身按「恢复审计门禁」的独立可维护性任务排期，不预期带来明显性能收益。

### 5. 下载任务存储/接口瘦身（落盘侧 + 接口侧 + 三类卡死已修；仅剩单文件优化）

- 背景（部署端实测）：`json/download_task.json` 12.7 → **38.3 MB**（items 36,739 / resultsMap 36,737 / pendingMods 3,655）；
  `saveTask()` 单次 stringify + 写盘被 ~18 处调用（含**每个文件**的状态变化）；`/api/task` 单次响应曾达 **34.3 MB**，
  前端每 2 秒轮询一次（≈17 MB/s）。
- ✅ 落盘侧（2026-10-11）：改走 `server/lib/download-task-store.js` —— 越界键清理（安全网）+ 快照净化 +
  **原子写**（`tmp+rename`）+ **合并写**（节流实测后由 500ms 放宽到 10s）；关键节点
  （批次开始/终止/暂停/恢复/重启恢复/进程退出）`flushTask()` 立即落盘；终止时 `writer.cancel()`
  防止节流窗口把已删除的任务文件写回来（任务"复活"）。实测：200 次 `save()` 入队 **0ms**、实际只写 **1 次**；
  `items`/`pendingMods`/`resultsMap` 保留部分 **sha 逐字节等价**；单测 9 项全绿（`test/download-task-store.test.cjs`）。
- ✅ 接口侧（2026-10-11）：`GET /api/task` 只回摘要（新增 `getTaskSummary()`：状态/统计/活动项/`pendingModsCount`，
  不含 items/resultsMap/pendingMods 数组）；新增分页 `GET /api/task/items?filter=open|done|all&offset&limit`
  与 `GET /api/task/done`；4 个写接口（`/api/download`、`/api/task/import`、`/api/scan-incomplete/download` 等）
  不再把完整 task 塞进响应；前端 `loadTaskView()` = 「摘要 + 按需拉未完成项」拼出渲染所需形状（渲染逻辑零改动），
  并在「进度页不可见」时跳过轮询。实测 `/api/task` **34,352,430 B → 491 B**、`/api/task/items` <0.01s。
- ✅ 三类卡死（均为「大表在热路径上被全量处理」，实测定位后修复）：
  ① **收尾逐目录全量重写游戏索引**——`finalizeHtmls` 里 `hashIndex.ingestModDir()` 不在 `if (changed)` 内，
  数千目录 × 数 MB ⇒ 写盘 **121 MB/s**、收尾 **363–455 秒**；移入 `if (changed)` + `WeakSet` 跳过已收尾项 ⇒ **9 ms**；
  ② **接口每次回 34MB**（见上）；
  ③ **追加去重 O(n×m)**——`planForAppend` 用「每个待追加项 × 逐条扫 pendingMods + items」，
  现场 2,544 × 40,394 ≈ 1.03 亿次比较 ⇒ **12,784 ms**；改为 `Set` 预建 O(n+m) ⇒ **14 ms**（append 列表逐字节等价），
  新增 `test/append-dedup.test.cjs` 复杂度门禁。
- ⏭ **最后一项优化：完成表分离**——终态项转存 `json/download_done.json`（按批次、带原下标，启动时原位重组）。
  **38.3MB 任务文件有意保留不动**，作为性能基准夹具（它已先后暴露上面三类问题）；其余优化做完再动它。
  基准值与对照表见 `docs/20261011-下载任务存储瘦身.MD` 第十七节。
- 其它待办：① 前端进度页按需渲染 + 已完成分组折叠/分页；② `items[].path` 改存相对路径（再省 ~30%）；
  ③ 越界键**来源**排查（现场曾观测 `resultsMap` 12,896 > `items` 12,782，本次只做安全网清理）。
- 验收工具：`bash scripts/api-test.sh <base-url> <password>`（读写接口全测 + 阈值判定；地址与口令由参数传入，脚本内不写死）。
- IO 归因：`GET /api/io` 同时给 `byLabel`（按类型：task-write / index-read / hash / download-write）与
  **`bySite`（按调用点 file:line，含字节数与调用次数）**——写盘飙高时能直接看出是**哪一行**在写。
  热路径（下载分块逐块计数）用 `ioMonitor.meter(label)`：站点在创建时固定一次，之后每次只做一次累加，
  **绝不在热路径抓栈**（`count(label, bytes, site?)` 为兼容写法）。
- 方案文档：`docs/20261011-下载任务存储瘦身.MD`

---

### 6. ✅ 已完成：下载列表每行显示「已下载大小 / 文件大小」（单位自动切换）

- **需求**：进度页每个文件行显示「已下载 / 总大小」，单位按量级自动选择（不再固定 MB）。
- **实现**：
  - `server/public/app.js` 新增 `fmtSize()`：B / KB / MB / GB / TB **按量级自动切换**（1–2 位小数）。
  - `rowHtml()` 三种取值来源——**下载中**取 `task.activeItems[].received/total`（与实时进度条同源，`idx` 对齐）；
    **已完成**取 `resultsMap[i].size`；**未开始但已知大小**取 `item.size`（显示 `0 B / size`）；未知则不显示。
  - 样式 `server/public/fragments/styles/task-list.css` 的 `.row-size`（右对齐、次要色、11px，进度条下一行）。
- **模板同步**：`app.js` 与 `task-list.css` 都是模板下发件，已同步
  `templates/_downloader/_gamebanana-mods/js/app.js` 与 `templates/_downloader/styles/task-list.css` 并组装回项目（逐字节一致）。
- **验证**：本地沙箱夹具（下载中 / 已完成 / 未开始三种）+ 无头浏览器实测渲染出
  `0 B / 43.6 MB`、`120.6 KB`、`0 B / 2.00 GB`（**三种单位自动切换** ✓，排版见附图）；
  生产态 `/api/task` 的 `activeItems` 确认带 `received/total`（样本 `received=72,542,972 / total=198,155,255`）
  ⇒ 下载中行显示为 `69.2 MB / 189.0 MB`；`node --test` 86/86 全绿。

## 版本

> 版本记录已**外置**到 **[docs/CHANGELOG.md](docs/CHANGELOG.md)** —— 由 dsh-git-push 插件的 `doc-version`
> 从 git log 聚合（`apply` 更新 / `check` 查漂移，可接 CI），启用该工具前的历史版本一并保留在该文件里。

当前版本：**1.3.9**
