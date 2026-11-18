# AGENTS.md —— Agent 开发指南

> 本文件面向在此仓库工作的 AI Agent（与人）。目标是让任何 Agent 在 5 分钟内建立正确的
> 心智模型、避开已知陷阱、用与仓库一致的风格完成修改。改完代码后如果学到新东西，
> **请回写更新本文件**。

## 1. 项目速览

**AC 题库**：AtCoder / Codeforces / Codeforces Gyms / 牛客竞赛题目的自动抓取中文题库。
生产站点 <https://ac.yslsy.top>，仓库 <https://github.com/Sam5440/ac.isam.top>，
Next.js 15 App Router + React 19 + Tailwind 4 + Node 22，部署 Vercel。

**核心架构一句话**：没有后端数据库——抓取脚本把数据写成 JSON 提交进仓库（`data/`），
Next.js 构建期直接读文件渲染（SSG/ISR），客户端功能（翻译/编译器/IDE/AI 对话）全部
跑在浏览器里，AI 接口经站内 `/api/*` 转发。

三个心智模型必须先建立：

1. **数据是构建期事实**：页面引用的 `data/*.json` 由脚本生成并随 CI 提交。本地构建会
   重写 `data/index.json`——**提交前必须 `git checkout -- data/index.json` 还原**，
   否则会把本地无关快照推上去。
2. **SW 源码是字符串**：`lib/pwa/sw-source.js` 把整个 Service Worker 作为**外层模板
   字面量**导出，构建期注入版本号后预渲染为 `/sw.js`。因此 **SW 代码里禁止出现
   反引号/模板字符串**（会提前终止外层字面量），改完必须验证：
   `node --check lib/pwa/sw-source.js && node -e "new Function(require('lib/pwa/sw-source.js').SW_SOURCE)"`。
3. **每次 push = 一次生产部署**：main 分支即生产。`X-AC-Build`（= commit SHA）随部署
   变化，SW 版本门卫（见 §6）自动处理用户侧旧缓存——**不需要**任何「让用户清缓存」的
   手工步骤。

## 2. 命令速查

```bash
npm run dev            # 开发服务器 http://localhost:3000
npm run build          # 完整构建（含索引重建 + 编译器运行时下载 ~150MB）
npm run build:fast     # AC_SKIP_SSG=1 的快速构建（日常验证用这个）
npm test               # node --test test/*.test.mjs
npm run fetch:init     # 初始化数据（各平台最新 10 场）
npm run fetch:ci       # 与 CI 相同参数的增量抓取
npm run translate      # 只补 AI 翻译
npm run index          # 只重建 data/index.json
npm run normalize-ids  # 题目 id/文件名归一（Windows 安全字符集，幂等；加 --dry-run 只报告）
npm run runtime        # 只下载浏览器编译器运行时
```

cf-gyms 独立管线（与主 `fetch.mjs` 完全分离）：

```bash
node scripts/fetch-cf-gyms.mjs                # 增量（列表前3页新赛+ID补扫+题面，38min 预算）
node scripts/fetch-cf-gyms.mjs --mode problems  # 只跑题面 + 每轮推 200 个老 ID 补扫
node scripts/fetch-cf-gyms.mjs --mode verify    # 完整性校验（缺漏退出码 1；--repair 回填后复验）
node scripts/fetch-cf-gyms.mjs --mode status    # JSON 进度统计
```

验证 SW 改动（两条都必须过）：

```bash
node --check lib/pwa/sw-source.js
node --input-type=module -e "const {SW_SOURCE}=await import('./lib/pwa/sw-source.js'); new Function(SW_SOURCE)"
```

## 3. 架构地图

### 3.1 页面路由（app/，App Router）

| 路由 | 类型 | 内容 | 关键组件 |
| --- | --- | --- | --- |
| `/` | 静态 | 统计 + 最新比赛（类型由设置过滤） | `RecentContests` |
| `/problems` | 静态 | 题库浏览，服务端分页 | `ProblemsBrowser` |
| `/problems/[platform]/[problemId]` | 按需 SSG | 题目详情 | `ProblemViewShell`、`ProblemStatementViewer`、`AiFab`、`ProblemCompiler` |
| `/contests` | 静态 | 比赛列表（类型/站点筛选，50条/页） | `ContestsBrowser` |
| `/contests/[platform]/[contestId]` | 按需 SSG | 比赛详情 + 题目清单 | — |
| `/calendar` | 静态 | 比赛日历（Clist API） | `CalendarView` |
| `/history` | 静态 | 浏览历史（本机 IndexedDB/localStorage） | `HistoryList` |
| `/ci` | ISR 5min | 抓取日志仪表盘（读 `data/ci-log.json`） | `CiDashboard` |
| `/ide` | 静态 | IDE 工作台 | `IdePage` → `IdeShell`/`Workbench` |
| `/settings` | 静态 | 设置（5 分区单页切换） | `settings/` 各分区 |
| `/api/mt/[channel]` | 动态 | 浏览器 MT 转发（deepl/youdao/caiyun/iflyrec） | `lib/mt-protect.js` 防滥用 |
| `/api/ai/proxy` | 动态 | AI 接口转发（混合内容降级 + 域名白名单） | `lib/ai-proxy.mjs`、`AI_PROXY_ALLOWED_HOSTS` |
| `/sw.js`、`/ac-build.json`、`/offline-manifest.json` | 预渲染 | PWA 基础设施 | — |

`app/error.jsx` 与 `global-error.jsx` 是最后防线，不要移除。错误边界的三件事
（2026-11-17 起，见 §3.4）：

1. **归类**：消息经 `lib/error-classify.mjs`（纯函数，有单测）分成
   `stale`（旧构建残留：`ChunkLoadError` / `reading 'call'` / Safari 的
   `Importing a module script failed.` / 旧 chunk 被 404 成 HTML 的 MIME 报错…）、
   `server`（RSC 渲染期异常）、`unknown`，文案各自不同；
2. **自愈**：页面 HTML 里的 `<meta name="ac-build">`（`app/layout.jsx` 注入，值来自
   `lib/build-id.mjs`）与线上 `/ac-build.json` 不一致 → 删掉「本页」缓存条目并
   `location.reload()` 一次（`sessionStorage['ac-stale-reload']` 按构建号去重，
   与 `PwaRegister` 共用同一键）；
3. **出口**：主动作是「刷新页面」（旧版是 `reset()` 原地重渲同一棵坏树，对缓存引起
   的错误无效），另有「清理页面缓存并刷新」（只删 `ac-pages`/`ac-shell`，
   保留离线题库 `ac-assets` 与编译器运行时）与折叠的「排障信息」。

### 3.2 服务端数据层

- `lib/data.js`：唯一数据入口。`getIndex()`（index.json 全量）/ `getAllContests()` /
  `getProblem(platform, id)` / `getProblemsOfContest()` / `findProblemSummary()`。
  顶层模块级缓存，进程内只读一次。
- `data/index.json`：`{ generatedAt, stats, recentContests, recentProblems, problems }`。
  `stats.byPlatform` 是四平台规模的权威数字。
- 题目记录字段：`id/platform/index/title/titleZh/statementMd/statementZhMd/samples/
  timeLimitMs/memoryLimitMb/tags/difficulty/translateModel/reuseOf?`，以及样例说明
  译文的题级元数据 `noteTranslatedAt/noteTranslateModel`。
- `samples[]` 结构：`{input, output, note?, noteZh?}`。**AtCoder 的样例说明挂在
  「Sample Output N」小节末尾，抓取时被摘进 `samples[].note`，不在 `statementMd`
  里**——所以题面翻译管线覆盖不到它，必须走独立的「样例说明翻译」阶段（2026-11-17
  起：`scripts/fetch.mjs` runTranslate 第 3 段 / `scripts/translate-web.py --notes`），
  队列口径由 `lib/sample-notes.js` 统一（有实质 note、无 noteZh、`language !== 'zh'`）。
  渲染在 `components/SamplesSection.jsx`，随 `useProblemLang` 的 en/zh/both 模式切换。
  `reuseOf`（cf-gyms → codeforces 原题）在题目页渲染时合并原题面——见
  `app/problems/[platform]/[problemId]/page.jsx` 的合并块，改动渲染逻辑时别忘了这条链。
- `outputFileTracingIncludes`（next.config.mjs）按路由声明 data 文件依赖——**新增读
  data 的路由必须同步加**，否则 Vercel 函数里缺文件。

### 3.3 客户端状态与设置（最大的一致性约束）

全部设置单键存储于 `localStorage['stmt-settings-v1']`，由
`components/settings.jsx` 统一管理：

- `DEFAULT_SETTINGS`（~L69）是唯一事实来源；读取时经**逐字段迁移/归一化**（旧键
  `stmt-lang`、旧 `ai`/`chat` 字段迁移进来）。**新增设置项必须同时改三处**：
  1. `DEFAULT_SETTINGS` 加默认值；
  2. `loadSettings()` 里的归一化逻辑（容忍缺失/旧格式，绝不信任存储内容）;
  3. 对应分区 UI（`components/settings/` 或 compiler 分区）。
- 消费方：`useSettings()` Context；题面语言用 `useProblemLang(platform)`（牛客有独立
  「默认翻译」开关）。
- 设置导出/导入：`lib/settings-io.js` 列举全部「设置类」键——**新增 localStorage 键
  时同步登记**，并决定它属于「设置」（进导出）还是「数据」（不进，如 IndexedDB 翻译
  缓存、对话记录、代码草稿）。
- 键位规划（勿新增前缀冲突）：
  - `stmt-settings-v1` 全部站点设置 / `stmt-custom-themes-v1` 自定义主题
  - `ysc-cp-settings-v1` 编译器偏好 / `ysc-cp-draft-<problem>-<lang>` 代码草稿
  - `stmt-chat-v1-<scope>` AI 对话多会话（`lib/chat-store.js`，旧版单会话数组自动迁移）
  - IndexedDB：MT 翻译缓存（`lib/zh-store.js`）、编译运行时（Cache API）
- 主题：`lib/themes.js` 模板主题 + `<html>` 上 `data-theme`/`dark`/`eink` 类。首帧防
  闪白靠 `app/layout.jsx` 的 `THEME_BOOTSTRAP` 内联脚本（服务端生成）——改主题机制时
  两侧必须同步。

首页布局（`/settings#home`）同样只用主设置键。`homeLayoutMode` 为 `visual` / `html`；`homeWidgets` 是按优先级排列的 `{ id, type, params, w, h }` 实例数组，可重复类型，不存坐标；`homeLayout` 独立保留高级 HTML 与 12 套预设。编辑只改草稿，保存才写入两份内容和启用模式。读取与导入都走 `lib/home-grid.mjs` 的 `normalizeHomeConfig`：无显式模式时，非经典的合法旧 HTML（含空字符串）继续用 HTML；无旧自定义内容则用经典四组件。空组件数组是有效布局。

编辑画布与首页共享 `packWidgets`（行优先找首个能容纳整个矩形的空位），窄屏只收拢显示列数，不改存储尺寸。新增可视组件时同步登记 `CATALOG` 的参数白名单、编辑器图标及首页 `WidgetNode` 映射。预览不挂载真实数据组件；HTML 仍经过 `parseHomeLayout`。浏览器回归：`node e2e/home-layout-visual.js` 与 `node e2e/home-widget-grid.js`（可设 `BASE_URL`）。

桌面默认四列，新组件占两列、高度按类型，画布随最下方组件伸缩，不设固定视口高度。列表组件每增减一格高度，其当前 `params.limit` 增减两条（限 1–24）；指针及面板共用 `resizeWidget`。读取旧设置、切换屏宽不重算条数；「恢复默认四列布局」只替换可视草稿。

手机回归 `node e2e/mobile-layout.js`（支持 `BASE_URL`）覆盖 320 / 390 / 430px。顶栏「更多」在手机上按顶栏而非触发按钮定位；设置行的多个操作允许换行，首页编辑器底部操作栏与语言浮钮需分别可点。

### 3.4 Service Worker / PWA

源码 `lib/pwa/sw-source.js`（字符串）→ `app/sw.js/route.js` 注入
`__AC_SW_VERSION__`（构建时间 + commit SHA）→ 预渲染 `/sw.js`。缓存桶：
`ac-shell`（首页壳）/ `ac-pages`（页面+RSC）/ `ac-assets`（`/_next/static`）/
`ac-runtime`（编译器 WASM）/ `ac-imgs`（牛客图床）。

**导航版本门卫**（2026-11-14，根治「用户偶发看到旧版界面/旧设置弹窗/翻页失灵」）：

- `next.config.mjs` 全站注入 `X-AC-Build` 响应头（= `VERCEL_GIT_COMMIT_SHA`）；
  `app/ac-build.json/route.js` 是轻量探测端点。
- `navigationHandler`：缓存命中时先 `getBuild()`（TTL 5min + 800ms 超时，离线零等待）
  → 缓存构建号 ≠ 线上（含无版本头的存量旧条目）→ **网络优先**、失败回退缓存；
  一致或探测失败 → 照旧 SWR 秒开 + 后台 revalidate。
- **`rscHandler` 同样有门卫**（2026-11-17 补）：`_rsc` 缓存键只是几个请求头的哈希、
  与构建号无关（Next 15 的 `setCacheBustingSearchParam`），部署后同一链接算出的 URL
  不变 → 旧构建的载荷必然命中。现在缓存载荷的 `x-ac-build` ≠ 线上 → 网络优先
  （失败回缓存），并且 `revalidate(req, servedBuild, event.clientId)` 带上 servedBuild
  ——RSC 路径也能触发 `AC_STALE_RELOAD`（旧实现的 `revalidate(req)` 让它永远不触发）。
- **探测失败不再长时间盲判**：`getBuild()` 的 catch 只把已知值顺延
  `BUILD_RETRY_TTL`（60s），旧实现每次失败都顺延满 `BUILD_TTL`(5min)，网络抖动时
  会连续五分钟把旧构建当成「线上最新」。
- `revalidate()` 发现秒开页属旧构建 → postMessage `AC_STALE_RELOAD` →
  `components/PwaRegister.jsx` 按 sessionStorage 构建号去重后 `location.reload()`
  一次（防循环）。**最后一道防线是错误边界自愈**：页面 `<meta name="ac-build">`
  与 `/ac-build.json` 不一致时 `app/error.jsx` 会删掉本页缓存条目再重载一次
  （见 §3.1）；手动出口「清理页面缓存并刷新」只删 `ac-pages`/`ac-shell`。
- 改 SW 的检查单：① 无模板字符串；② `node --check` + `new Function` 通过；
  ③ `test/sw-build-guard.test.mjs` 跑过；④ 离线回退路径仍然可用（门卫网络失败要
  回缓存，不能白屏）；⑤ 缓存桶名不随版本换（换桶会清掉用户离线题库）。

其它 SW 要点：RSC 离线未命中 307 回整页导航（绝不能把 503 HTML 当 flight 载荷）；
`pruneAssets` 用 `asset_refs__` 保护仍在被引用的 chunk；`activate` 不删
`compiler-runtime-v1`（用户手动下载的运行时）。**遗留缺口**：`compiler-runtime-v1`
里的 wasm bridge/worker 会被旧版 SW 缓存，且版本握手尚未实现——升级 bridge/worker
后要让用户清掉该桶重新下载运行时（改 SW 前先确认是否涉及）。

### 3.5 题面渲染链

`statementMd`（英文）+ `statementZhMd`（中文）→ `lib/statement-segments.js`
`pairSegments()` 按段配对（`splitBlocks` 会跟踪公式状态，跨空行的大公式不切段）→ `ProblemStatementViewer`（来源芯片/浮标）→
`StatementBody`（marked + KaTeX + highlight.js；`MathPre`/`math-detect.js`
先探测公式再决定渲染路径；`img-dedup.js` 去掉中英段重复图片）。样例渲染
`SamplesSection`（支持 LaTeX，复制原始文本）。改动这条链注意： KaTeX/highlight
客户端运行时（`KatexRuntime`/`HighlightRuntime`）是全局挂载的，别在页面里重复初始化。

**数学处理全在 `lib/render.js` 的 `renderRich`（2026-11-17 重构，改动前先读文件头）**：
公式被抽成惰性 token（`<code class="zs-math">`），客户端 `KatexRuntime` 再换成 KaTeX，
服务端只输出 token。抽公式的顺序本身就带语义，别随意调换：

1. fenced/`inline code` 先进 token —— 但**单反引号里的成对 `$…$` 会被切出来**单独渲染
   （CF 交互题把输出格式写成行内代码，公式得能显示；围栏代码块与 `<pre>` 一律不动）；
2. 丢弃 `\style{opacity:0…}` 这类不可见 TeX（CF 愚人节题的隐藏提示）；
3. 兼容 CF 源码级 `$$$`/`$$$$$$`；交互表这类 `$ / $$` 紧跟 `\begin{env}` 的块先按
   「找配对 `\end{env}` + 同种收尾定界符」整块抽出（1552h 体内夹着行内 `$`、1060h 定界符
   写成单个 `$` 却跨空行），再处理 `$$…$$`（只认块边界，行内降级为行内公式）；
4. 严格行内 `$…$` → 宽松行内（容忍定界符内侧空白，带金额/CJK/跨段/跨句守卫）→
   **裸 TeX 抢救**（定界符彻底丢失的历史数据，按「不含空格的长命令 + 括号/单词边界」包回 `$…$`）
   → **裸下标/上标抢救**（只剩 `p_i`/`t_{k}`/`c_{i,j}`/`10^9` 这种没有 TeX 命令的公式片段，
   全库曾有 165 个题面直接显示下划线原文；带「不跨空格 + 标识符/文件名/URL/代码段/纠 ext」守卫）；
5. 最后一遍清掉配不成对的 `$` 残标。

所有公式内容统一过 `decodeMathEntities`（`&lt;` 这类实体）+ `fixDoubleEscape`，
非 ASCII 数学字形（U+1D400 区）的「字形 + ASCII 孪生」重复会被折叠成一份。

**体检脚本**：`node scripts/audit-statement-render.mjs`（`--list N`/`--only cf-gyms`/`--json`）
把全库题面渲染一遍，统计「渲染后仍能看到裸 TeX / 字面 `$` / 字形重复 / 未解析占位符」——
动渲染层或改抓取解析后跑一次，数字应只降不升。

**XSS 最后兜底**：所有 HTML 出口——包括 MT/AI 译文这类绕过正常管线的入口——最终
都过 `lib/render.js` 的 `sanitizeRichHtml`（parse5 白名单重建，URL 解码后校验协议）。
新增任何「用户/外部内容进 DOM」的入口时，确认它也被这条链覆盖。

### 3.6 编译器与 IDE

- `components/compiler/CompilerDock.jsx`：题目页悬浮台。运行时 C++ 走
  `/compiler/*`（构建期下载，`scripts/fetch-runtime.mjs`），Python 走 Pyodide CDN。
- `lib/compiler/*` 全是**纯模块**（window 缺失时降级），`node --test` 直接可测——
  新逻辑写进 lib 而不是组件里。
- COOP/COEP（`credentialless`）在 `next.config.mjs` 全站设置，交互运行依赖
  SharedArrayBuffer——别删。
- `components/ide/`：独立 `/ide` 工作台（Workbench 布局、文件管理、zip 导入导出、
  终端、CiLogPanel 联动 /ci）。与 CompilerDock 通过 `lib/editor-bridge.js` /
  `lib/ide-bus.js` 通信。
- 运行语义：C++ 只对「运行」阶段计时，编译/链接走独立硬上限
  （`COMPILE_HARD_CAP_MS = 180s`）；wasm 无法从外部抢占，**超时/停止 =
  `terminate worker`**；交互运行 = SharedArrayBuffer + `Atomics.wait` 阻塞喂 stdin。
  Python worker 必须是 **module worker**，别改成经典 worker。

### 3.7 AI 功能

- 配置中枢：`lib/ai-providers.js`（纯函数：`normalizeProviders`/`normalizeAssign`/
  `needsProxy`/`resolveModuleCfg`）。服务商列表 + 三模块（翻译/对话/补全）各自挑
  服务商与模型，UI 在 `components/settings/AiProviderSection.jsx` +
  `ModuleAssignPicker.jsx`。
- 对话：`components/chat/`（AiFab 悬浮窗，懒加载）、`lib/chat.js`（构造上下文，
  自动附样例与最近报错）、`lib/chat-store.js`（多会话）、`lib/chat-export.js`。
- 浏览器 MT：`components/ai-translate.js`（编排）+ `lib/client-mt.js`（四渠道客户端）
  + `/api/mt/[channel]`（服务端转发）+ `lib/mt-protect.js`（防滥用）+
  `lib/mt-health.js`（渠道健康度/熔断轮转）。
- 服务端抓取用 AI 翻译：`scripts/lib/llm.mjs` + `translate.mjs`（系统提示词约定见
  README「翻译质量约定」；公式逐字符保留是硬约束）。
- 出站代理安全参数（改前必读，`lib/ai-proxy.mjs` + `lib/secure-proxy.mjs`）：同源
  校验；目标主机白名单（内置 18 家 AI 域名 + `AI_PROXY_ALLOWED_HOSTS`）；**DNS 预解析
  全部地址必须公网 + 连接钉死解析结果**（防 rebinding SSRF）；禁重定向；方法/头白名单；
  请求 4MB / 响应 8MB 上限；55s 超时；120 req/min/IP；SSE 透传。`/api/mt/[channel]`：
  渠道白名单 + 串行 500ms + 超限 429；`/api/contests/clist`：参数白名单 + TTL 600s +
  in-flight 去重（Clist 限流 10 req/min，缓存是强制的）。三者由
  `test/security-and-query.test.mjs` 部分守卫——放宽任何一项先想清攻击面。

### 3.8 抓取管线（scripts/）

- `fetch.mjs` 主管道：`runAtCoder()` / `runCodeforces()`（Playwright 过 CF）/
  `runNowcoder()` → `collectProblems()` → `runTranslate()` → **`runGymPhase()`** →
  `writeCiLog()`。CI 参数 `--abc 3 --arc 1 --agc 1 --cf 3 --nc 2 --backfill 10
  --translate-limit 120 --gym-pages 60 --gym-minutes 10 --gym-translate-limit 40`。
  平台阶段互相隔离（单平台失败不阻断）；翻译阶段先 `pingLLM` 探活，401/403 中止
  整轮（Key 失效时别打满无效请求），并发池收到 401/403 置 `authAborted` 跳过余量。
  **样例说明翻译（2026-11-17 起）**：题面阶段之后单独一段 `samples[].note →
  noteZh`（默认只 atcoder，`--notes-limit`/`NOTES_TRANSLATE_LIMIT` 默认 60 题/轮，
  0 关闭、负数不限）；与题面分开计预算，AtCoder 存量约 2800 题待补。
  **cf-gyms 尾阶段（2026-11-15 起）**：三平台「拉取+翻译」全部完成之后才执行——
  子进程调用 `fetch-cf-gyms.mjs --mode problems`（自执行脚本只能子进程复用）做
  小预算题面回填，随后 `runTranslate({ platforms: ['cf-gyms'], ... })` 把 gym
  缺译题面并入 CI 翻译（reuseOf 存根无 statementMd 天然跳过，PDF 提取文本可译；
  gym 比赛名暂不翻）。`--no-gyms` 整体跳过；ID 补扫（`--gym-sweep` 默认 0）与
  大批量回填仍由每日工作流承担。`--translate-only`（npm run translate）会把
  cf-gyms 与三平台一起翻。
- `fetch-cf-gyms.mjs` cf-gyms：**完整性契约**（列表全扫 → ID 区间 `[100001, max+25]`
  逐个探测，隐藏 gym 也入库 → 题面以 gym 页链接为权威集合并集 → 失败进
  `.attempts.json` 重试账本 → verify 枚举缺漏退出码 1）。准入规则与 `reuseOf` 见
  README。改这里先读文件头 60 行注释，契约细节都在。它被主管道子进程调用时
  SIGTERM 走自身存档退出（完成当前题面 → 保存 attempts/state），超时是收尾不是
  丢弃；注意 `--minutes`/`--max-problem-pages` 在**场次粒度**检查——单场 gym 内
  会超出预算（2026-11-15 实测：pages=3 跑出 pages=10），父进程 `GYM_MINUTES+5`
  分钟的 SIGTERM 才是硬上限。
- 抓取注意：一律走 `scripts/lib/http.mjs`（超时/UA/重试统一）；对 CF 的任何新抓取
  必须考虑 Cloudflare 质询（现有方案是 Playwright 真实 Chromium，见
  `scripts/lib/cf.mjs`）；风暴熔断（连续质询→全局冷却 5-10min）参数勿随意放宽。
- **AtCoder 题面解析别按 DOM 嵌套猜分支**（`scripts/lib/atcoder.mjs` 的
  `parseAtCoderStatementHtml`）：历史上有四种版式——现代 `div.part > section > h3`、
  2015 年平铺 `section > h3`（abc034/036/041、arc046/050/052/053/055）、2012 年
  h3 与 section 平级（arc001）、`div.part` 内 h3 + section 平级（abc001/arc002）。
  现在统一走「深度遍历 + 遇 h3 切段」，`hr` 丢弃、正文用 `contents()` 取（含裸
  文本节点）。2026-11-16 前的实现按「有没有 div.part」选分支，让上述 28 道老题
  每小时报 `empty statement`、永远进不了库；回归测试见
  `test/atcoder-statement.test.mjs`。
- **CF 题面 HTML→Markdown 别过滤掉 `<script>` 节点**（`scripts/lib/html2md.mjs`，
  2026-11-17 根治 142 道题面数学重复乱码）：CF 页面上 MathJax 已先跑过一遍，原始 TeX
  只剩在 `<script type="math/tex">` 里，页面上能抓到的其它东西（`MathJax_Preview`、
  `nobr[aria-hidden]` 字形树、`MJX_Assistive_MathML`）都是**渲染副产物**。htmlparser2
  把 `<script>` 的 `node.type` 记成 `'script'` 而不是 `'tag'`——按 `type === 'tag'` 过滤
  节点就会把 TeX 原文整段丢掉，只剩字形 + MathML 两份重复（站上的 `𝑛n`）。现在的口径：
  `isContentNode()` 接受 tag/script/style，`isMathJaxArtifact()` 整段跳过生成物，
  `<table>` 走独立块（含嵌在 `<p>` 里的极端情况）。回归测试
  `test/cf-mathjax.test.mjs` + 两个 fixture（原始 `$$$` 版 / MathJax 渲染版）。
- **存量脏题面用 `scripts/repair-statement-math.mjs` 重抓**（`--stats` 枚举 /
  `--dry-run` / `--ids-file` / `--persistent`，断点状态在 `data/cf-gyms/.repair-state.json`，
  不入库）：只改 `statementMd`（+ `fetchedAt`），**绝不覆盖 `statementZhMd`**，写盘前校验
  （无 U+1D400 区字形、去公式后无裸 TeX、长度 ≥ 旧 0.5、英文词重合）。CF 现在必须用
  「真实 Chrome + 持久 profile」（`--persistent`）：headless shell 第二次导航就被
  Cloudflare Turnstile 拦住且不会自过。
- `scripts/lib/ci-log.mjs` 写 `data/ci-log.json`，`/ci` 页与 `CiDashboard` 消费——
  改字段两边同步。
- **三工作流调度**：`ci.yml`（push/PR）= `npm test` + 完整 build；`fetch.yml` 每小时
  （cron `23 * * * *`，timeout 65min，装 poppler-utils）跑主管道，**push 失败自动
  `git pull --rebase --autostash` 重试 ×3**（checkout 与 push 窗口内撞上人工 push 的
  解药）；`fetch-cf-gyms.yml` 每日 20:47 UTC（北京 04:47），装 poppler-utils（PDF
  取字），提交后跑 `--mode verify`，有缺漏退出码 1 让 job 变红（数据已落地，缺口下轮
  自动补）。Secrets：`TRANSLATE_BASE_URL/API_KEY/MODEL`、`CLIST_API_KEY`，可选
  `CF_HANDLE/CF_PASSWORD`（受限 gym 登录兜底，fetch.yml 也读），Vercel 侧
  `AI_PROXY_ALLOWED_HOSTS`。
- **data/ 纪律**：入库 = `index.json` / `ci-log.json` / `cf-gyms/sweep-state.json`
  （ID 补扫游标，CI 续扫依赖）/ 各平台 `contests.json` + `problems/`；**不入库、绝不
  `git add -f`** = `data.zip`、机器本地状态（`.attempts.json` / `.backfill-state.json`
  / `.scan-cursor.json` / `.fetch-state.json` / `.live*.json`）、`data/*/pdf/`
  （PDF 原件只落系统临时目录取字后即删，仓库只存 pdftotext 提取文本 `statementMd`
  + 远端地址 `statementPdf`）。`build-index.mjs` 内容未变时沿用旧 `generatedAt`，
  不产生空 data 提交。

## 4. 测试约定

- 框架：`node:test` + `node:assert/strict`，文件 `test/*.test.mjs`。
- **只测纯函数**：被测模块必须无 window/网络副作用——现有模式是「注入」：
  `lib/chat-store.js`、`lib/compiler/cp-settings.js` 等接受注入的 storage 对象。
  新逻辑照此拆分（逻辑进 lib 纯模块，组件只做 UI）。
- 命名风格：中文用例描述（如 `test('normalizeAssign: 补默认值（off/false/null/auto）')`），
  一个文件覆盖一个模块。
- SW 源码有两条守卫测试（可解析为 JS / 不含反引号），改 SW 时若新增结构约束，
  优先加成测试而不是口头约定。
- **测试发现三守卫**（`test/guard-test-discovery.test.mjs`，历史事故防复发）：①
  package.json 的 test 脚本必须是带通配的显式 glob（禁裸 `node --test` 与目录参数——
  裸命令会把 E2E 脚本当单测跑）；② 全仓类测试命名文件只许在 `test/`；③ `test/` 内
  必须 `.test.mjs`。新建 E2E/脚本时文件名不得含 test/spec 字样。
- 注意：全新 clone 未 `npm install` 时 `render-format`/`img-dedup`/
  `security-and-query` 三个测试会因缺 `parse5` 失败——这是存量现象，不是你的改动
  引起的。

## 5. 提交与部署约定

- 提交信息：中文，conventional 前缀 + scope，如
  `fix(pwa): ...` / `feat(cf-gyms): ...` / `perf: ...` / `fix: 审查修复批量（PWA 离线/编译器/抓取管线/安全加固）`。
  数据 CI 自动提交形如 `data: fetch & translate <UTC时间> [skip ci]`，不要模仿或干预。
- main 即生产：直接 push main = 直接部署 Vercel。没有 PR 流程，因此**push 前本地必须
  `npm run build:fast` + `npm test`**。
- **Vercel 是否构建由 `vercel.json` 的 `ignoreCommand` 决定（唯一事实来源）**：数据 CI
  提交带 `[skip ci]` 只是为了让 GitHub Actions 别重复跑 `npm test` + build，**绝不能让它
  顺带跳过 Vercel 构建**——数据是构建期事实，跳过构建 = 站点永远停在旧快照。当前
  `ignoreCommand` 仅在提交标题含 `[vercel skip]` 时跳过；线上面板的同名字段已被它覆盖，
  别再在面板里加基于 `[skip ci]` 的规则（2026-11-16 事故，见 §6 第 16 条）。
- push 前 `git status` 检查三类意外改动：
  1. `data/index.json`（本地构建重写）→ 还原；
  2. `package-lock.json`（`npm install` 顺带重排）→ 还原；
  3. ~~**Windows 专属**：`data/cf-gyms/problems/*?*.json` 两个文件名含 `?` 的文件~~
     **已于 2026-11-17 根治**：那两个文件是 gym 题面链接把 `?statementsLocale=ru|en`
     当题号落盘的产物（见 §6 第 17 条）。现在 id/文件名统一走 `lib/problem-id.mjs`
     （剥查询串 + 剔 Windows 非法字符 + 排除保留设备名），仓库内已无非法文件名，
     这条「在 Windows 上假装 deleted、绝不提交删除」的特例随之失效。
     仍在生效的纪律：**绝不 `git add -A`**，务必逐条 `git add <path>` 审查。
- 本地 push 前先 `git fetch && git rebase origin/main`；撞上 CI data 提交且
  `data/index.json` 冲突时，正解是**基于合并后的平台数据重跑
  `node scripts/build-index.mjs` 再 add**，不要只保留一边（两边都是各自快照，
  重建才是合流）。脚本侧写 JSON 一律走 `scripts/lib/util.mjs` 的 `writeJson`
  （tmp + rename 原子写）。
- 其它约定：文档型报告（`FIX-REPORT` / `OPTIMIZATION-REPORT-*` / `review-*/` /
  `TEST-REPORT*`）是历史存档，更新时**只增不改**已有结论；Tailwind 暗色变体是
  `@custom-variant dark (&:is(.dark *))`，靠根元素类切换而非 media query；改配色走
  `lib/themes.js` 三层体系（内置 / 模板 / 用户自定义），别在组件里写死颜色。

## 6. 已知陷阱清单（历史教训，勿重蹈）

以下每条都真实付出过修复成本（对应 git log 或仓库内报告文档）：

1. **SW 无条件 SWR 回旧 HTML = 用户看到整套旧版界面**（2026-11-14 版本门卫修复）。
   任何「HTML 可以先回缓存」的新想法都要先回答：部署换版后旧页怎么自愈？
2. **SW 里写模板字符串** → 外层字面量提前终止 → 构建产物语法错误。守卫测试会拦，
   但别靠它兜底。
3. **旧 HTML 引用的旧 chunk 被 prune 掉** → 离线刷新 504 → hydration 白屏。所以有
   `asset_refs__` 保护集；动淘汰逻辑（`pruneCache`）必须理解 keepPaths 前缀保护与
   RSC 优先逐出。
4. **RSC 请求失败返回 503 HTML** → Next 客户端路由解析 flight 失败 → 白屏无出口。
   必须走 307 回退整页导航（`rscHandler`）。
5. **hydration mismatch**：任何 `Date`/时区/`navigator` 相关的 SSR 输出都要固定时区
   或客户端守卫。`/ci` 页踩过两次（`resolvedOptions` 与 `toLocaleString` 在
   SSR/客户端不同）。
6. **窄屏 flex 不换行**：`flex-1`（basis:0%）在 flex-wrap 下恒不换行，标题被压到 0
   宽溢出盖按钮（编译-13）。需要换行的弹性盒用 `flex-1 basis-56` 这类真实 basis。
7. **元数据缓存桶被 `caches.open()` 意外创建**：页面统计前先 `caches.has()`（审查
   P3-15）。所有「只读检查」的 Storage API 都要注意副作用创建。
8. **`navigator.serviceWorker.ready` 只在挂载时读一次**：SW 晚激活则按钮永久禁用
   （PWA-15）。状态消费要用事件/轮询刷新。
9. **离线同步必须 `await` 进 extendable event 生命周期**：脱离 waitUntil 的任务在 SW
   回收时被杀（实测 616 页 0 入库）。
10. **设置读取必须逐字段归一化**：localStorage 是用户数据，可能是旧版本/半截/被插件
    篡改的 JSON。任何新字段走「DEFAULT 兜底 + 显式类型检查」。
11. **AI Key 永不进仓库**：`.env.example` 曾真实泄露（已轮换）。示例文件只放占位符；
    用户侧 AI Key 只存 localStorage，经 `/api/ai/proxy` 转发，服务端无状态。
12. **`/api/*` 与 SW**：fetch handler 对 `/api/` 直接放行不缓存（MT/AI 必须走网络），
    新增 API 路由自动享受该规则，别在 SW 里给它加缓存分支。
13. **仓库里的大 JSON 是不可再生的历史快照之外的一切来源**：`data/` 下任何文件不要
    手改；修复数据用对应脚本的 backfill/repair 模式。
14. **Vercel 上 `os.tmpdir()` 与项目目录跨设备**：`rename` 必 EXDEV（`copy` 不受限）。
    安装/构建类脚本的 staging 一律建在**项目盘内**再落位（`scripts/fetch-runtime.mjs`
    已如此），别写跨盘 rename。
15. **测试文件命名会被 npm test 的 glob 误收**：类测试命名（`*.test.*`/`*.spec.*`/
    `*-test.*`）只允许出现在 `test/`，且 `test/` 内必须是 `.test.mjs`；E2E / Playwright
    脚本的文件名**不得含 test/spec 字样**（`e2e/` 目录名也是刻意起的）。三守卫见
    `test/guard-test-discovery.test.mjs`——违反它 CI 连红过 4 次。
16. **Vercel Ignored Build Step 与数据提交的 `[skip ci]` 撞车 = 生产永不更新**
    （2026-11-16）。`[skip ci]` 只是给 GitHub Actions 看的；Vercel 项目面板曾配置
    `git log -1 --pretty=%s | grep -q '\[skip ci\]' && exit 0 || exit 1`，于是每小时
    数据提交全部 `Canceled by Ignored Build Step`，站点停在最后一个非数据提交的 build
    （实测停了 29 小时：牛客 Round 170 六道题早在仓库里，生产 `/contests/nowcoder/143406`
    仍 404）。现由 `vercel.json` 的 `ignoreCommand`（仅 `[vercel skip]` 跳过）接管。
    **排查「数据在仓库里但页面 404」先比对 `/ac-build.json` 的 build SHA 与 main 头**；
    `vercel ls` 里 Status=Canceled 的生产部署就是被忽略步跳过的。
17. **题号里的 URL 查询串会变成文件名里的 `?`**（2026-11-17）。CF 的题面链接形如
    `/gym/106728/problem/E?statementsLocale=ru`（切换题面语言），旧版
    `fetch-cf-gyms.mjs` 的 `parseGymPage` 只按 `/problem/` 切一刀就把后半段整段当题号
    → 同一题出现两个 index（`E` 与 `E?statementsLocale=ru`）→ 落成
    `data/cf-gyms/problems/106728e?statementslocale=ru.json`。`?` 是 Windows 保留字符，
    这类文件在 Windows 上永远 checkout 不出来，而 `lib/data.js` 的 id 白名单又拒绝它
    → 索引里挂着、点进去 404。**教训：任何「从 URL 推导出来的字符串」在变成 id /
    文件名之前必须过 `lib/problem-id.mjs` 的 `sanitizeProblemId`**；查询与写入共用同一条
    规则（`problemFileName`），否则改名后查询规则不同步就会全站 404。存量修复脚本
    `scripts/normalize-problem-ids.mjs`（幂等，可反复跑），回归测试
    `test/problem-id.test.mjs`。

18. **错误边界只会 `reset()` = 用户被迫自己清缓存**（2026-11-17 排查）。部署换版后
    SW 缓存里可能留着旧构建的整页 HTML / RSC 载荷，浏览器抛出的消息因引擎而异
    （webpack 模块表错配的 `Cannot read properties of undefined (reading 'call')`、
    Safari 的 `Importing a module script failed.`、旧 chunk 被 CDN 404 成 HTML 的
    `MIME type of "text/html"`），旧版 `CHUNK_FAIL_RE` 一条都认不出来 → 落到通用
    文案「渲染此页面时发生了意外错误。」，而按钮走 `reset()`（原地重渲同一棵坏树）
    → 刷不掉旧缓存，用户只能自己去「清缓存 + 硬刷」。现在：归类集中在
    `lib/error-classify.mjs`（有单测）、主动作是整页刷新、构建号不一致时自动丢本页
    缓存重载。**教训：任何「换版后旧缓存」引发的错误，恢复动作必须是重载/清缓存，
    不能是原地重试；错误文案的识别规则要跟着浏览器真实消息走，并写成测试。**
    排查同类问题先看错误页折叠的「排障信息」（错误原文 + 本页/线上构建号）。

19. **「MathJax 渲染过的页面」是抓取解析的暗礁**（2026-11-17，142 道题面受影响）。
    CF 的题面 HTML 里既有 `$$$…$$$` 源码标记，也可能已被 MathJax 换成「预览 + 字形树 +
    MathML + `<script type="math/tex">`」四件套。旧解析器两件事同时做错：丢掉 script 节点
    （TeX 原文没了）、把字形树与 MathML 当正文（重复两份）。**教训：解析外部 HTML 时先问
    「这个元素是内容还是它的渲染副产物」，再决定 `node.type` 的过滤范围；htmlparser2 对
    script/style 有独立 type，别只认 `tag`。** 影响面是全域的（`sanitizeText` 都未必能救），
    所以存量只能靠重抓修；重抓脚本把校验写成硬门（见 §3.8）。
20. **题名是纯文本出口**（2026-11-17）：`document.title`、题目切换 `<select>`、面包屑、
    列表卡片、复制题目都用裸 `title`/`titleZh`，而题名（尤其 AI 译名）里常带 `$k$`
    ——不做处理就会显示 LaTeX 源码（`codeforces/1282b2` 的「一份的钱买 $k$ 份」曾被用户
    看到）。统一在数据出口拍平：`lib/problem-title.mjs` 的 `plainTitle()`/`plainTitled()`，
    在 `lib/data.js` 的 `getProblem` 与 `scripts/build-index.mjs` 两处生效。**新增任何
    「题名出口」别自己写正则，走这个模块；题面正文的公式不受影响。**
21. **存量题面有三种数学脏形态，靠渲染层兜底 + 抓取端根治，别只修一头**（2026-11-17）：
    ① 定界符彻底丢失、只剩裸 TeX（约 1400 题面）；② 定界符内侧带空白（`$ 1 \le n \$`）；
    ③ MathJax 竞态导致的字形重复。渲染层（`renderRich` 的宽松/抢救/折叠四段，见 §3.5）
    兜① ②③，抓取端（§3.8 的 html2md 修复 + 重抓脚本）治根。改任一侧都要跑
    `scripts/audit-statement-render.mjs` 对比全库数字（只降不升），否则很容易修好 A 类
    又回归 B 类（本轮第一版就出现过 404 个回归：CJK 守卫把中文标点当正文证据）。

## 7. 常见任务手册

### 加一个站点设置项

1. `components/settings.jsx`：`DEFAULT_SETTINGS` 加字段（带类型合理的默认值）；
2. `loadSettings()` 归一化分支（缺失→默认，类型错→默认）；
3. UI：设置页五分区之一（`components/settings/AppearanceSection.jsx` 等）或编译器
   分区（`components/compiler/CompilerSettingsSection.jsx`）；布局用
   `SectionCard`/`controls.jsx` 的「组 → 行」结构；
4. 若影响已有行为，在 `lib/settings-io.js` 确认该键已随 `stmt-settings-v1` 整体导出
   （默认是，除非你新开了独立键）；
5. 若是编译器偏好，还要考虑 `ysc-cp-settings-changed` 事件通知已打开的 CompilerDock。

### 加一个新页面

1. `app/<route>/page.jsx`（静态页优先；读 data 用 `lib/data.js`，注意
   `next.config.mjs` 的 `outputFileTracingIncludes`）;
2. 导航入口在 `components/SiteHeader.jsx`（顶栏自适应收纳，按优先级递减）；
3. 站内跳转进度条/悬停预取由 `NavigationProgress` 全局接管，无需页面内处理；
4. 错误兜底自动落到 `app/error.jsx`，确认该页的离线提示语义是否需要定制。

### 加一个新 OJ 平台

1. `lib/platforms.js` 注册元数据（徽章/标签/颜色，客户端安全纯数据）；
2. `scripts/lib/` 新增抓取模块（走 `http.mjs`；反爬用 Playwright），
   `scripts/fetch.mjs` 加 `runXxx()` 与 CLI 参数；
3. `data/<platform>/contests.json + problems/{id}.json` 结构对齐现有平台；
4. `scripts/build-index.mjs` / `lib/data.js` 覆盖新目录；`offline-manifest.json`
   路由、`ContestsBrowser` 类型筛选（`lib/contest-type.js`）、`fetch.yml` 流程同步；
5. 若题面为中文（如牛客），抓取时直接写 `statementZhMd`，来源芯片标「官方中文」。

### 改 Service Worker / 离线策略

见 §3.4 的检查单。特别提醒：任何新缓存桶要加入 `ALL` 数组（activate 清理白名单），
否则每次部署 activate 会把它删掉。

## 8. 相关文档

- `README.md`：面向使用者的功能/部署/数据来源说明。
- `FIX-REPORT.md` / `OPTIMIZATION-REPORT-2026-11-10.md` / `PLAN-2026-11-11.md` /
  `TEST-REPORT*.md`：历史审查与优化记录——陷阱清单（§6）多半出自这里，改相关模块前
  值得先读对应章节。
- `lib/changelog.js`：站点版本日志（用户可见，发布功能时更新它）。
