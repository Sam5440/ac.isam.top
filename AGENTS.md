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

`app/error.jsx` 的 chunk 失败检测（`ChunkLoadError` → 提示「站点刚更新，刷新即可」）
与 `global-error.jsx` 是最后防线，不要移除。

### 3.2 服务端数据层

- `lib/data.js`：唯一数据入口。`getIndex()`（index.json 全量）/ `getAllContests()` /
  `getProblem(platform, id)` / `getProblemsOfContest()` / `findProblemSummary()`。
  顶层模块级缓存，进程内只读一次。
- `data/index.json`：`{ generatedAt, stats, recentContests, recentProblems, problems }`。
  `stats.byPlatform` 是四平台规模的权威数字。
- 题目记录字段：`id/platform/index/title/titleZh/statementMd/statementZhMd/samples/
  timeLimitMs/memoryLimitMb/tags/difficulty/translateModel/reuseOf?`。
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
- `revalidate()` 发现秒开页属旧构建 → postMessage `AC_STALE_RELOAD` →
  `components/PwaRegister.jsx` 按 sessionStorage 构建号去重后 `location.reload()`
  一次（防循环）。
- 改 SW 的检查单：① 无模板字符串；② `node --check` + `new Function` 通过；
  ③ `test/sw-build-guard.test.mjs` 跑过；④ 离线回退路径仍然可用（门卫网络失败要
  回缓存，不能白屏）；⑤ 缓存桶名不随版本换（换桶会清掉用户离线题库）。

其它 SW 要点：RSC 离线未命中 307 回整页导航（绝不能把 503 HTML 当 flight 载荷）；
`pruneAssets` 用 `asset_refs__` 保护仍在被引用的 chunk；`activate` 不删
`compiler-runtime-v1`（用户手动下载的运行时）。

### 3.5 题面渲染链

`statementMd`（英文）+ `statementZhMd`（中文）→ `lib/statement-segments.js`
`pairSegments()` 按段配对 → `ProblemStatementViewer`（来源芯片/浮标）→
`StatementBody`（marked + KaTeX + highlight.js；`MathPre`/`math-detect.js`
先探测公式再决定渲染路径；`img-dedup.js` 去掉中英段重复图片）。样例渲染
`SamplesSection`（支持 LaTeX，复制原始文本）。改动这条链注意： KaTeX/highlight
客户端运行时（`KatexRuntime`/`HighlightRuntime`）是全局挂载的，别在页面里重复初始化。

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

### 3.8 抓取管线（scripts/）

- `fetch.mjs` 主管道：`runAtCoder()` / `runCodeforces()`（Playwright 过 CF）/
  `runNowcoder()` → `collectProblems()` → `runTranslate()` → `writeCiLog()`。
  CI 参数 `--abc 3 --arc 1 --agc 1 --cf 3 --nc 2 --backfill 10 --translate-limit 120`。
- `fetch-cf-gyms.mjs` cf-gyms：**完整性契约**（列表全扫 → ID 区间 `[100001, max+25]`
  逐个探测，隐藏 gym 也入库 → 题面以 gym 页链接为权威集合并集 → 失败进
  `.attempts.json` 重试账本 → verify 枚举缺漏退出码 1）。准入规则与 `reuseOf` 见
  README。改这里先读文件头 60 行注释，契约细节都在。
- 抓取注意：一律走 `scripts/lib/http.mjs`（超时/UA/重试统一）；对 CF 的任何新抓取
  必须考虑 Cloudflare 质询（现有方案是 Playwright 真实 Chromium，见
  `scripts/lib/cf.mjs`）；风暴熔断（连续质询→全局冷却 5-10min）参数勿随意放宽。
- `scripts/lib/ci-log.mjs` 写 `data/ci-log.json`，`/ci` 页与 `CiDashboard` 消费——
  改字段两边同步。

## 4. 测试约定

- 框架：`node:test` + `node:assert/strict`，文件 `test/*.test.mjs`。
- **只测纯函数**：被测模块必须无 window/网络副作用——现有模式是「注入」：
  `lib/chat-store.js`、`lib/compiler/cp-settings.js` 等接受注入的 storage 对象。
  新逻辑照此拆分（逻辑进 lib 纯模块，组件只做 UI）。
- 命名风格：中文用例描述（如 `test('normalizeAssign: 补默认值（off/false/null/auto）')`），
  一个文件覆盖一个模块。
- SW 源码有两条守卫测试（可解析为 JS / 不含反引号），改 SW 时若新增结构约束，
  优先加成测试而不是口头约定。
- 注意：全新 clone 未 `npm install` 时 `render-format`/`img-dedup`/
  `security-and-query` 三个测试会因缺 `parse5` 失败——这是存量现象，不是你的改动
  引起的。

## 5. 提交与部署约定

- 提交信息：中文，conventional 前缀 + scope，如
  `fix(pwa): ...` / `feat(cf-gyms): ...` / `perf: ...` / `fix: 审查修复批量（PWA 离线/编译器/抓取管线/安全加固）`。
  数据 CI 自动提交形如 `data: fetch & translate <UTC时间> [skip ci]`，不要模仿或干预。
- main 即生产：直接 push main = 直接部署 Vercel。没有 PR 流程，因此**push 前本地必须
  `npm run build:fast` + `npm test`**。
- push 前 `git status` 检查三类意外改动：
  1. `data/index.json`（本地构建重写）→ 还原；
  2. `package-lock.json`（`npm install` 顺带重排）→ 还原；
  3. **Windows 专属**：`data/cf-gyms/problems/*?*.json` 两个文件名含 `?` 的文件在
     Windows 上永远显示为 `deleted`——这是平台限制的假象，**绝不 `git add -A`，
     绝不提交这两个删除**（它们的真实内容只在 Linux CI / GitHub 上存在）。

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
