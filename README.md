# GameBanana Mod Downloader

> 零依赖、单进程 Node.js 服务：从 [GameBanana](https://gamebanana.com) 搜索、下载并自动整理 Mod。
> 自带网页界面（浏览器访问），另有配套浏览器扩展（`crx/`）与油猴脚本（`scripts/`）。

**核心能力一览**

| 能力 | 说明 |
|---|---|
| 🔍 关键词搜索 | 中文/变体自动归一为英文（「桑多涅」→ Sandrone），命中 GB 全站 |
| ⏱ 按时间搜索 | 按 新增/修改/更新 三字段筛选（OR 逻辑），支持多游戏批量 |
| ⬇ 四步下载流程 | 生成 HTML → 查重归位 → 整理 → 并发下载（断点续传/重试/跳过）；下载内容可选压缩包 / 预览图 |
| 📁 自动整理 | 按「仓库/角色/作者」规范路径存放；旧目录自动归位、重复进回收站（`.trash` 可恢复） |
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
| 下载进度 | 每个文件的实时状态（下载中/成功/跳过/失败）、进度条、预览图；失败可单独重试/跳过；并发数即时调节；任务 json 导入/导出；分组可折叠/展开（默认展开，状态记忆） |
| 搜索 | 关键词搜索（中文归一）＋ 按时间搜索；结果勾选后一键下载 |
| 设置 | 游戏下载路径（可读取本地目录）、GB Cookie 与登录检测、映射管理、文件夹合并、HTML 反查、修改密码（需旧密码） |

---

## 目录结构（2026-09 重构后）

```
gamebanana-mods-downloader/
├── start.sh                  # 启停脚本（start/stop/restart/status/set-password）
├── server/
│   ├── boot.cjs              # 入口：CJS 强制引导（零依赖，解决 ESM 父目录问题）
│   ├── app.js                # HTTP 入口：注册路由 + 静态页面 + 启动序列
│   ├── config.js             # 配置管理（config.json 自动初始化；读取游戏/映射）
│   ├── auth.js               # 密码 scrypt 哈希 + 会话（HttpOnly Cookie，清过期 token）
│   ├── routes/               # API 路由（app.js 只注册）
│   ├── utils/                # 叶子工具（index-html / html / http / path-safe / fs-async）
│   ├── lib/
│   │   ├── downloader.js     # 四步下载流程 + 并发/断点续传/重试/跳过 + 任务事件日志
│   │   ├── gb-api.js         # GameBanana API 封装（mod 解析/搜索/Cookie 清洗）
│   │   ├── mapping.js        # 映射与下载路径计算（仓库层/角色层/[作者] mod名）
│   │   ├── search.js         # 按时间搜索（三时间字段 OR）
│   │   ├── hash-index.js     # HTML 反查三表（GB 线上表 + 本地表 + HTML 原名表）
│   │   ├── organize.js       # 自动整理（外部遗留 → 垃圾桶）
│   │   ├── merge-dirs.js     # 文件夹合并（英文目录 → 英文 – 中文）
│   │   ├── data-backup.js    # 数据备份/恢复（ZIP 导出/导入）
│   │   ├── incomplete-scan.js# 未完成任务扫描
│   │   └── app-log.js        # 日志：时间戳 + [task]/[api] 事件
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
node --test    # 自动发现 test/**/*.test.cjs
```

当前 50 项全绿，覆盖：路由清单（P1）、去重工具（P2）、bug#1 接线（P3）、auth 清过期 token / fs-async（P4）、改密旧密码（P5）、导入=纯追加（P6）、数据导入 manifest、gif 命名、未完成扫描、CJS 加载冒烟。测试日志落 `test/logs/<名>.log`。

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

## 版本

| 版本 | 内容 |
|---|---|
| 1.0.0 | 独立仓库初始化（重构 P0–P4：routes/ 拆分、utils/ 去重、auth 异步、crx/ 整合） |
| 1.1.0 | P5 改密校验旧密码 + P6 导入=纯追加、任务事件日志、便携测试、文档重写 |
| 1.2.0 | 自动更新（watch / git / github 三模式 + 防抖重启 + 前端开关 UI）；github 模式无需服务端 .git，定时从 GitHub 拉取并安全更新代码 |
| 1.2.1 | bugfix：GB 登录检测修复——GB 会话绑定浏览器完整 UA（OS+版本号），保存 Cookie 时自动同步当前浏览器 UA 到 `gbUserAgent`，解决 UA 不匹配导致 `_bIsLoggedIn` 始终返回 false 的问题 |
| 1.3.0 | 代码质量重构：crx/background.js 拆分（432→105行，提取 constants/settings/probe/cookie/search/download 6个模块）；server/lib/downloader.js prepareMod 拆分（298→82行，提取 step2FindAndMove/step3TrashRestore/step4MarkExists）；空 catch 块加注释；魔数提取为常量；删除冗余 docs/ 副本 |
| 1.3.1 | 代码质量重构续：server/public/app.js bindSettings 拆分（430→17行，提取 bindSettingsGames/SettingsCookie/SettingsScanIncomplete/SettingsTaskIO/SettingsSecurity/SettingsHashQuery/SettingsHashSearch 7个子函数）；bindMerge 拆分（227→8行，提取 bindMergeMapping/bindMergeAutoUpdate 2个子函数） |
| 1.3.2 | 新功能：①下载优先级——图片/gif 排前优先下载；②下载列表分组折叠/展开（默认展开，状态记忆）；③登录页「记住此设备」——勾选后 30 天免登录（默认勾选，解决登录太频繁），时长可配置 `sessionRememberHours` |
