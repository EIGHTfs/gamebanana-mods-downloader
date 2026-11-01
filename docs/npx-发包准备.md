# npx 发包准备（gamebanana-mods-downloader）

> 只调研、未改代码。本文同时是三个同构项目里最完整的一份，另两份（iwara / gallery）只写差异。

## 一、现状盘点（实测）

| 项 | 实测结果 |
|---|---|
| 入口 | `server/boot.cjs`（**与 iwara、gallery 逐字相同**，md5 前 8 位 `ef54878e`） |
| 启动链 | `boot.cjs` → `require("./lib/cjs-bootstrap.cjs")`（三项目逐字相同 `12a8d0a2`）→ `require("./app.js")` |
| 端口 | `server/config.js:33` 默认 **8642**；`config.js:287` 有 `ports` 配置块 |
| 第三方依赖 | **零**。全部是 Node 内置：`child_process` / `crypto` / `dns` / `fs` / `http` / `https` / `module` / `net` / `os` / `node:sqlite` / `node:string_decoder` |
| `server/` 是否自足 | **是**。`grep 'require("../../')` 在 `server/` 内**零命中**（没有跨目录依赖） |
| 工具探测 | `server/tool/tool-detect.js`（三项目逐字相同 `953c48e5`）已实现三级探测：**环境变量 → 项目 `tool/` 与 `tools/` → 系统 PATH**，含 `X_OK` 校验与版本实测、失败降级 ⇒ **npx 安装态友好** |
| 顶层 `tool/` | 4 文件 924 KB（`bin/` 920 KB + 一个 python 脚本）→ 见 §三 |
| 硬编码绝对路径 | **几乎没有**：`server/public/fragments/tab-panel/panel-settings.html:37` 的下载路径示例文本是 **input placeholder**（`placeholder` 属性里的示意值，非真实配置）；`server/update/auto-update.js:582-583` 的 `C:\Program Files\Git\usr\bin\tar.exe` 是**探测候选**（符合 tool-self-detection）；无真实写死路径 |
| 运行时数据 | `json/` 13 文件 84 KB（`index`/`role` 数据）、`mapping/` 6 文件 84 KB（`illegalChars.json` 等）—— **两者被 `server/lib/mapping.js` 等运行时读取，必须进包** |
| README 相对链接 | 图片 6 / 链接 2 / 其中**相对路径 1**（npm 页面上会 404） |

## 二、npx 化缺口清单

| # | 缺什么 | 要做什么 | 工作量 |
|---|---|---|---|
| ① | **`bin` 入口** | 新建 `package.json` 的 `bin`；入口脚本要能**判 realpath**（被 npx 缓存目录软链执行时，`__dirname` 不是用户项目根）—— 直接 `require("../server/boot.cjs")` 会因软链解析失败；需 `fs.realpathSync` | **小（半天）** |
| ② | **数据目录** | 安装态数据必须落 `~/.<app>/`（配置/data/缓存）；**仓库态行为零变化** —— 判据：`process.env.<APP>_HOME` > 检测 `package.json` 是否在用户项目里 > 默认 `~/.<app>` | **中（1~2 天）** |
| ③ | **`files` 白名单** | 见 §三（逐条列出实际文件） | **小** |
| ④ | **README 绝对链接** | 相对链接 1 个改绝对（`https://github.com/<owner>/<repo>/raw/...`） | **很小** |
| ⑤ | **`prepublishOnly`** | 无需 assemble 构建（`server/` 已是装配产物，见 §四）；但**需要生成 `brand.json`**（见 §四） | **小** |
| ⑥ | **包名** | `gamebanana-mods-downloader` 需实测 npm 是否可用；不可用则加 scope（`@<owner>/...`） | **很小** |
| ⑦ | **元信息** | `version` / `license` / `author` / `repository` / `bugs` / `keywords` / `engines`（`node:sqlite` 要求 Node ≥ 22.5） | **很小** |

## 三、`files` 白名单：实际会进包的文件清单

**进包（逐条）**：

| 路径 | 文件数 | 大小 | 为什么必须进 |
|---|---|---|---|
| `server/**` | 116 | 1004 KB | 全部运行时代码：`app.js`/`boot.cjs`/`lib/`/`routes/`/`route/`/`core/`/`http/`/`store/`/`search/`/`assemble/`/`config/`/`config.js`/`config.schema.json`/`public/`（前端页面与片段）/`tool/tool-detect.js`（工具探测）/`update/`（自更新）/`auth/` |
| `json/**` | 13 | 84 KB | **运行时数据**：`json/index`、`json/role` 等被 server 侧读取（游戏/角色索引） |
| `mapping/**` | 6 | 84 KB | **运行时数据**：`mapping/illegalChars.json` 由 `server/lib/mapping.js:27` 直接读；缺了非法字符映射会退化成内置默认 |
| `README.md` | 1 | 36 KB | npm 页面展示 |
| `start.sh` / `start-*.sh` / `start-windows*.bat` | 6 | ~20 KB | 便于从源码运行的用户；npx 不需要但体积可忽略 |

**不进包（逐条 + 理由）**：

| 路径 | 文件数 | 大小 | 为什么不进 |
|---|---|---|---|
| **`assemble.json`** | 1 | 12 KB | **用户明确要求**。它是构建清单（`files`/`init`/`commands`）+ 品牌配置源；运行时只用到 `brand` 段（见 §四的替代方案） |
| `test/**` | 70 | **5.2 MB** | 测试夹具与样本，运行不需要（体积最大头） |
| `docs/**` | 23 | **2.5 MB** | 设计文档，npm 用户不看；README 足够 |
| `tool/bin/` | — | **920 KB** | 见下方说明 |
| `tool/fix_browse_dotdirs.py` | 1 | 4 KB | 一次性修复脚本（python），非运行时 |
| `scripts/**` | 17 | 236 KB | 全是开发期工具（bench / migrate / check-* / shot / 一次性迁移），运行不需要 |
| `crx/**` | 22 | 136 KB | 浏览器扩展产物（可选功能，用户可另装） |
| `.auditignore` / `.trash/` | — | — | 开发辅助 |
| `.env`（若有） | — | — | 部署私有配置 |

**`tool/bin/`（920 KB）需要单独确认**：`file` 探测未给出明确类型，可能是打包的二进制工具。若它是某功能的运行时依赖（如 7z/ffmpeg 的随行副本），有两条路：
- 体积可接受（<1 MB）→ 进包，但要在 `files` 里写明它是什么；
- 体积大 / 非必需 → 排除，靠 `tool-detect.js` 的系统 PATH 兜底（该模块已支持降级）。
**这一条建议发布前人工看一眼 `file tool/bin/*` 的结果**（本轮只读调研，没有下这个结论）。

## 四、`assemble.json` 方案（核心矛盾）

### 4.1 问题有多严重（实测，不是猜测）

`server/config/brand.js:20` 读 `../assemble.json` 的 `brand` 段；**文件缺失时返回 `null`**（不抛错）。
`null` 的后果**不是"用默认值"**，而是 `replaceBrandInText()` 遇到 `!brand` 时**原样保留文本**
（`server/assemble/fragment-assembler.js:64`）。

而模板里 `@brand` 有**两种形态**：

```
注释形态（3 处）  <title><!-- @brand:title --></title>      → 缺失时变空标题（难看但可接受）
纯文本形态（5 处） <img src="@brand:logo@">                 → 缺失时**页面上直接显示 "@brand:logo@" 字面量**
                  <h1>@brand:displayTitle@</h1>            → 同上
```

⇒ **简单排除 `assemble.json` 会让 topbar 显示 `@brand:logo@` 这种字面量**，属于明显破相。

### 4.2 三个方案对比

| 方案 | 改动面 | **从 git 仓库直接跑是否零影响** | 风险 | 工作量 |
|---|---|---|---|---|
| **a) 运行时容忍缺失** | 改 `brand.js` 给默认值 + 模板改成有 `@brand` 时的兜底文案 | ⚠️ 要改模板（5 处纯文本要变成"注释形态 + 默认值"），**仓库态渲染结果会变** | 中：模板改动影响仓库态显示 | 中 |
| **b) 打包时生成 `brand.json`**（推荐） | `prepublishOnly` 抽 `assemble.json.brand` → 写 `brand.json`；`brand.js` 读取顺序改为 **`brand.json` → `assemble.json`** | ✅ **零影响**：仓库里没有 `brand.json` ⇒ 走原路径，逐字不变 | 低：多一个每次发布前生成的文件（需进 `files`，且不要提交进 git —— 加 `.gitignore`） | **小（半天）** |
| **c) brand 独立成 `config/brand.json`** | 把 brand 从 `assemble.json` 挪到独立文件，`assemble.json` 不再有 brand 段 | ❌ 有影响：要同步改 `assemble.json` 语义（现在是"清单即唯一真相"），且仓库态读取路径变了 | 中高：动了既有契约 | 中大 |

### 4.3 推荐：方案 b

理由三条：

1. **仓库态逐字零影响**（这是硬要求，`brand.json` 只在发布产物里存在）；
2. **包内不含 `assemble.json`**（满足用户硬要求），但品牌信息完整进包（页面不破相）；
3. 实现最小：`brand.js` 加 5 行读优先序 + 一个 `prepublishOnly` 脚本（~30 行）。

配套细节：
- `brand.json` 必须进 `files`，但**不要 commit 进 git**（`.gitignore` 加一行）—— 它是构建产物；
- `prepublishOnly` 里若 `assemble.json` 缺失/brand 段缺失 ⇒ **直接失败并给可读错误**（不允许静默产出无品牌包）。

## 五、共享 vs 各自

**结论：没有共享枢纽，改动只能做三遍**（或写批量同步脚本）。证据：

| 候选 | 实际情况 |
|---|---|
| `dl-server-template` | **空壳**（`server/` 为空、无 `assemble.json`、非 git）→ 不能作为同步源 |
| `bench-template` | **不是这三个项目的模板**（结构与它们完全不同：有 `templates/`/`skills/`/`example/`，无 `server/`） |
| 三项目之间 | 靠**复制粘贴演化**：`boot.cjs`/`cjs-bootstrap.cjs`/`update/auto-update.js`/`tool/tool-detect.js` **逐字相同**（可直接按 md5 批量替换）；`brand.js` 只有两个项目有；`app.js` 三个都不同 |

**可行做法**：对"逐字相同"的文件写一个按 md5 比对的同步脚本（改一处 → 复制到另外两处），
对已分化的文件（`app.js`）各自改。**不建议**为此新建共享包（那是把三个项目改成 monorepo 级别重构，超出 npx 化范围）。

## 六、风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| **数据目录写错** | npx 安装态若把数据写进 `node_modules` 缓存目录，`npx` 二次运行会**丢数据**（缓存目录可被清） | ②里明确 `~/.<app>`，并加一条"启动时打印数据目录路径"的日志 |
| **`assemble.json` 缺失导致破相** | 见 §四（`@brand:logo@` 字面量） | 方案 b |
| **缓存目录被发进包** | 若有 `cache-*`/`uploads` 之类的运行时目录被 `files` 收进去 | 白名单里显式排除 + `npm pack --dry-run` 复核 |
| **端口冲突** | 默认 8642 若被占，npx 直接起不来 | 启动参数 `--port` / `PORT` 环境变量（已有 `config.js` 的 ports 块，需确认 CLI 是否暴露） |
| **`node:sqlite` 的 Node 版本** | `node:sqlite` 要求 Node ≥ 22.5 | `package.json` 的 `engines` 写明；启动时检测版本并给可读错误 |
| **升级即丢数据** | npx 每次可能装不同版本，若数据存缓存目录就丢 | 同第一条 |

## 七、建议发布顺序

**先发 gallery 作为试点**：它 `server/` 最小（67 文件 / 608 KB）、**完全不依赖 brand 机制**（无 `@brand:` 指令、无 `brand.js`）⇒ **`assemble.json` 可以直接排除，不需要方案 b**，是最干净的试点。
验证通过（`npx` 能起、页面正常、数据落 `~/.gallery`）后，再把方案 b 复制到 gbmd / iwara。
