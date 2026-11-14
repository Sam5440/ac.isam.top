# AC 题库 · ac.yslsy.top

**AtCoder / Codeforces / Codeforces Gyms / 牛客竞赛的自动抓取中文题库**：完整题面、样例数据、难度分级，AI 翻译为简体中文，随 GitHub Actions 持续更新，部署于 Vercel。

> 当前收录 **16,000+ 道题目 / 4,800+ 场比赛**（四平台合计，随 CI 每小时增长）。UI 与工程结构参考 [ys_problem_web](https://github.com/Sam5440/ys_problem_web)（[ysdaily.isam.top](https://ysdaily.isam.top/)）。

**技术栈**：Next.js 15（App Router）· React 19 · Tailwind CSS 4 · Monaco Editor · KaTeX · highlight.js · Node 22 · Vercel。无后端数据库——数据全部以 JSON 提交进仓库，构建期读取。

## 功能一览

### 题库与比赛
- **题库**（`/problems`）：全部收录题目，按平台 / 难度带 / 关键词筛选，服务端分页
- **比赛**（`/contests`）：ABC / ARC / AGC、Codeforces Div. 1–4 / Div. 1+2、Codeforces Gym、牛客周赛 / 小白月赛 / 练习赛 / 挑战赛；按类型与站点分组筛选，50 条/页分页；进入单场查看题目清单
- **比赛日历**（`/calendar`）：基于 Clist API 的周网格月历（前 N 天 / 后 M 天），勾选站点筛选，比赛开始时间本地化展示
- **题目页**（`/problems/[platform]/[id]`）：
  - 完整题面**逐段对照**翻译：CI 存档 AI 译文 + 访客浏览器本机实时机器翻译（DeepL / 有道 / 彩云 / 讯飞，3s 节流轮转，IndexedDB 缓存）+ **AI 外置**（用户自己的 OpenAI 兼容接口，Key 仅存本机），每段标注来源芯片
  - 左下角**译字浮标**随时切换语言模式；题面语言、对照优先级链、译文样式均在设置中配置
  - 样例输入输出一键复制（支持 LaTeX 公式渲染）、时间/内存限制、难度徽章（CF rating / AtCoder 实验难度）、算法标签中文
  - **比赛内题目切换**：顶部切换条（← / 下拉 / →）+ 侧栏本比赛题目列表（题号竖条悬浮）
  - 对照模式下中英段落重复图片自动去重
- **浏览历史**（`/history`）：停留超 1 分钟的题面记录，含最近判题状态（AC/WA）与样例通过情况
- **抓取日志**（`/ci`）：GitHub Actions 运行状态实时同步、抓取明细 / 未完成任务 / 下次计划、活动柱状图 / 成功率环 / 单轮产出对比图表

### 在线编程
- **编译器悬浮台**（题目页「编译器」按钮 / ⌘J）：C++（Clang/LLVM 22 WASM，c++11–26 + bits/stdc++.h）与 Python（Pyodide），**样例对拍**（AC/WA + 差异定位）/ **交互运行**（SharedArrayBuffer 阻塞喂入）/ **编译检查**（编辑停顿自动跑）；代码草稿按题按语言自动保存，运行时可下载到本机（Cache API，离线可用）；手机端专用代码键盘
- **IDE 工作台**（`/ide`）：类 CPH 测试面板 + VS Code 风格编辑区 + 多文件管理 + 一键打包/上传/下载（zip）+ 终端 + 页面内全屏；可从抓取日志页跳转查看 CI 运行日志

### AI 助手
- **AI 对话**（题目页右下角悬浮窗 / 侧边栏）：多会话管理、思考过程折叠、自动附带样例与最近编译报错上下文、Markdown/KaTeX 渲染、位置记忆；按需加载不占首屏
- **AI 代码补全**（编辑器内）：与翻译、对话共用「AI 服务商」配置，可分别为三个功能挑选不同模型；支持思考深度（关/低/中/高）
- **服务商管理**：OpenAI 兼容接口统一配置；https 站点请求 http 接口自动经本站转发（混合内容限制），本地 localhost 直连

### 外观与设置
- **主题系统**：夜间 / 日间 / 墨水屏三内置 + 模板主题库 + 自定义主题（CSS 在本机）+ 全局自定义 CSS；网页主题自动联动 IDE 编辑器主题（可改手动）
- **设置页**（`/settings`）：5 分区单页切换（题面与翻译 / 外观 / 编程 / AI 助手 / 离线与数据）；全部设置即时保存；支持一键导出/导入（跨设备同步设置）
- **长耗时操作**统一加载动画 + 3 秒浮窗提醒

### PWA 离线
- **离线题库**：设置中一键同步最近 30–200 场比赛的全部题目页（含 KaTeX / 高亮 / 字体 / Monaco chunk），离线可完整阅读与编译（C++ 运行时约 150MB 由同步预取；Pyodide 手动下载）
- **版本门卫**（2026-11-14 修复）：全站响应携带 `X-AC-Build` 构建号，Service Worker 导航时核对缓存 HTML 与线上构建号——一致或离线时秒开缓存；已知过期改走网络，杜绝部署新版后偶发看到旧版界面 / 旧设置弹窗 / 翻页失灵的问题；后台发现换版会通知页面自动刷新一次
- **离线兜底**：未缓存页面显示离线引导页，恢复联网自动刷新

## 数据来源

| 平台 | 元数据 | 题面 | 难度 |
| --- | --- | --- | --- |
| AtCoder (ABC/ARC/AGC) | [kenkoooo](https://kenkoooo.com/atcoder/) `resources/*.json` | `atcoder.jp/contests/{cid}/tasks/{pid}?lang=en`（HTTP 抓取） | problem-models 实验难度 ⌀ |
| Codeforces | [CF API](https://codeforces.com/api) `contest.list` / `problemset.problems` | `codeforces.com/contest/{id}/problems`（**Playwright 真实 Chromium** 过 Cloudflare） | CF rating |
| Codeforces Gyms（`data/cf-gyms`） | `codeforces.com/gyms/page/N` 全列表扫描 + **ID 区间逐个补扫**（隐藏 gym 也不漏） | gym 页面题面链接为权威集合逐题抓取；PDF 题面提取文字入库 | 未评级（准入规则见下） |
| 牛客竞赛（官方赛） | `ac.nowcoder.com/acm/contest/vip-index?topCategoryFilter=13`（HTML 内嵌 `data-json`） | `problem-list` JSON + `/acm/contest/{cid}/{index}` 服务端渲染题面（`equation?tex=` SVG 公式还原为 `$…$`） | 未评级 |

**Gym 拉取准入**（两条规则，判定持久化在 `contests.json` 的 `pullDecision` / `reuseOf`）：① 题名唯一命中站内 Codeforces 题库 → 只存 `reuseOf` 存根复用原题面，不重复保存；② gym 官方发起或任一题 standings 通过人数 > 100，二者都不满足的场次不拉题面。

**完整性契约**（cf-gyms 零缺漏四层保障）：列表全扫 → ID 区间补扫（`100001..最大+25`）→ 题面失败进 `.attempts.json` 重试账本 → `--mode verify` 枚举一切缺失并以退出码 1 告警，缺漏永远可见不静默。

牛客题面为中文，抓取时直接存为译文（来源芯片显示「官方中文」），不消耗 AI 翻译额度。

浏览器端编译器：C++ 运行时构建期经 codeload 自 `Sam5440/ys_problem_web` 的 `data/runtime` 分支注入 `public/compiler/`（同一维护者的构建）；Python 走 jsDelivr CDN + Cache API。

## 目录结构

```
app/                        # Next.js 15 App Router
  page.jsx                  # 首页（统计 + 最新比赛，类型由设置过滤）
  problems/                 # 题库浏览 + 题目详情（逐段对照翻译）
  contests/                 # 比赛列表 + 比赛详情
  calendar/  history/  ci/  # 比赛日历 / 浏览历史 / 抓取日志
  ide/                      # IDE 工作台入口
  settings/                 # 设置页（5 分区单页切换）
  ac-build.json/route.js    # SW 版本门卫的构建号探测端点
  sw.js/route.js            # /sw.js 预渲染输出（构建期注入版本号）
  offline-manifest.json/    # 离线同步清单（最近 200 场比赛 URL）
  api/mt/[channel]/         # 浏览器机器翻译转发（DeepL/有道/彩云/讯飞）
  api/ai/proxy/             # AI 接口转发（混合内容降级 + 域名白名单）
  api/contests/clist/       # 比赛日历数据
  api/problems/             # 题目查询 API（IDE 终端等使用）
components/                 # UI 组件
  ProblemStatementViewer / StatementBody   # 题面渲染（公式/图片去重/来源芯片）
  ProblemViewShell          # 题目页外壳（切换条/题号竖条/顶栏）
  compiler/                 # CompilerDock 悬浮台 + Monaco 编辑器 + 手机键盘
  ide/                      # IDE 工作台（Workbench/编辑区/文件/终端/对拍）
  chat/                     # AI 对话（AiFab 悬浮窗 + ChatPanel）
  settings/                 # 设置分区组件（reading/appearance/coding/ai/data）
  calendar/ ci/ history/    # 三个独立页面组件
  KatexRuntime / HighlightRuntime / MathPre # 公式与代码高亮客户端运行时
  PwaRegister / OfflineIndicator / OfflineCacheSection # PWA 注册与离线管理
lib/
  data.js                   # ★ 服务端数据读取（构建期生成的 data/*.json）
  settings.jsx              # ★ SettingsProvider + 全部设置定义/迁移（stmt-settings-v1）
  pwa/sw-source.js          # ★ Service Worker 源码（字符串导出，构建期注入版本）
  ai-providers.js           # AI 服务商/模块挑选/代理判定（纯函数可单测）
  themes.js                 # 模板主题库
  compiler/                 # 编译器纯模块（偏好/草稿/运行时/diff/补全，node 可直接单测）
  client-mt.js mt-health.js mt-protect.js zh-store.js # 浏览器 MT 四渠道 + IndexedDB
  statement-segments.js render.js math-detect.js img-dedup.js # 题面分段/渲染/公式检测/图片去重
  chat.js chat-store.js chat-export.js ide-bus.js ide-*.js editor-bridge.js
  changelog.js              # 站点更新日志（设置页「关于」的唯一来源）
  view-history.js tags.js contest-type.js platforms.js toast.js settings-io.js
scripts/
  fetch.mjs                 # ★ 主数据管道（AtCoder/CF/牛客 抓取 + 回填 + AI 翻译 + 索引）
  fetch-cf-gyms.mjs         # ★ cf-gyms 抓取（列表全扫/ID 补扫/题面/verify 完整性校验）
  build-index.mjs           # 重建 data/index.json
  fetch-runtime.mjs         # 构建期下载浏览器 C++ 编译运行时到 public/compiler/
  lib/                      # 抓取子模块（atcoder/cf/nowcoder/html2md/llm/translate/store/http/ci-log）
  cf_gyms_ui.py translate-web.py refetch-nowcoder.mjs backfill-all.mjs # 辅助工具
data/                       # 提交进仓库的数据（构建期读取，勿手改）
  {platform}/contests.json + problems/{id}.json
  index.json                # 全量索引 + 统计（119MB / 1.6 万文件量级）
  ci-log.json               # 抓取日志（/ci 页展示）
test/                       # node --test 单元测试（纯函数 + 注入，无 window/网络依赖）
e2e/                        # Playwright 视觉验证脚本
.github/workflows/
  fetch.yml                 # 每小时主管道
  fetch-cf-gyms.yml         # 每天 20:47 UTC cf-gyms 增量
  ci.yml                    # PR 检查（单测 + 构建）
```

## 本地使用

```bash
npm install
npx playwright install chromium      # 首次需要（CF 抓取用）

cp .env.example .env.local           # 填入翻译端点与 Clist Key

# 初始化：拉取 ABC/ARC/AGC/CF/牛客 各最新若干场全部题目并翻译
npm run fetch:init

# 日常增量（与 CI 相同参数）：补最新比赛 + 回填 10 道历史题面 + 翻译
npm run fetch:ci

# 只补翻译 / 只重建索引 / 只下载编译器运行时
npm run translate
npm run index
npm run runtime

npm run dev                          # http://localhost:3000
npm run build:fast                   # 跳过 SSG 的快速构建
npm test                             # 单元测试（node --test）

# cf-gyms 管线（独立于主管道）
node scripts/fetch-cf-gyms.mjs               # 增量
node scripts/fetch-cf-gyms.mjs --mode verify # 完整性校验（缺漏退出码 1）
node scripts/fetch-cf-gyms.mjs --mode status # 进度统计
```

`.env.local`（已 gitignore）：

```
TRANSLATE_BASE_URL=https://your-llm-proxy.example.com/v1   # OpenAI 兼容
TRANSLATE_API_KEY=sk-…
TRANSLATE_MODEL=your-model-name                            # 默认 gpt-6.1-sol
CLIST_API_KEY=…                                            # 比赛日历（/calendar）
# 可选：TRANSLATE_CONCURRENCY / TRANSLATE_LIMIT / ABC_SCAN / CF_SCAN / BACKFILL
```

## GitHub Actions CI

| Workflow | 频率 | 内容 |
| --- | --- | --- |
| `fetch.yml` | 每小时（cron `23 * * * *`） | 扫描最近 3 场 ABC / 1 场 ARC / 1 场 AGC / 3 场 CF / 2 场牛客，抓新比赛全部题面 → 回填 10 道历史题面 → AI 翻译（并发 4，失败下次重试，单次上限 120）→ 重建索引 → 有变更则 bot 提交推送 |
| `fetch-cf-gyms.yml` | 每天 20:47 UTC | cf-gyms 增量：新赛列表 + ID 补扫 + 题面回填（38 分钟预算，到点存档退出续跑无缝） |
| `ci.yml` | push / PR | `npm test` + `npm run build` |

每次 data 推送 → Vercel 自动重新构建部署。

### 需要配置的仓库 Secrets（Settings → Secrets and variables → Actions）

| Secret | 值 |
| --- | --- |
| `TRANSLATE_BASE_URL` | OpenAI 兼容翻译端点（如 `https://your-llm-proxy.example.com/v1`） |
| `TRANSLATE_API_KEY` | `sk-…` |
| `TRANSLATE_MODEL` | 翻译模型名（当前 `gpt-6.1-sol`） |
| `CLIST_API_KEY` | [clist.by](https://clist.by) API Key（比赛日历） |
| `AI_PROXY_ALLOWED_HOSTS` | 可选：AI 转发额外放行的自定义服务商域名 |

命令行配置（`gh` CLI）：

```bash
gh secret set TRANSLATE_BASE_URL -b "https://your-llm-proxy.example.com/v1"
gh secret set TRANSLATE_API_KEY  -b "sk-…"
gh secret set TRANSLATE_MODEL    -b "gpt-6.1-sol"
gh secret set CLIST_API_KEY      -b "…"
```

## Vercel 部署

1. 仓库推送到 GitHub（`data/` 一并提交）
2. [vercel.com](https://vercel.com) → Add New Project → 导入仓库；Framework preset 自动识别 Next.js
3. `vercel.json` 已固定构建命令 `node scripts/build-index.mjs && node scripts/fetch-runtime.mjs && next build`；项目环境变量配置 `NEXT_PUBLIC_SITE_URL`（生产域名）与 `CLIST_API_KEY`
4. Deploy —— 之后每次 CI 推送 `data/`，Vercel 自动重新构建部署

> 构建号 `X-AC-Build` 取自 Vercel 注入的 `VERCEL_GIT_COMMIT_SHA`，随每次部署变化——Service Worker 版本门卫据此识别过期缓存（见上文 PWA 章节），无需任何手动配置。

CLI 方式：

```bash
npm i -g vercel
vercel login
vercel --prod
```

## 翻译质量约定

`scripts/lib/llm.mjs` 中的系统提示词约束：

- 数学公式 `$…$` / `$$…$$` **逐字符保留**，代码块/行内代码不翻译
- Markdown 结构与段落顺序不变；小节标题按 OJ 惯例翻译
  （Problem Statement→题目描述、Constraints→约束条件、Input→输入格式、Output→输出格式、Note→说明）
- 输出严格 JSON（`titleZh` / `bodyZh`），解析失败时整体降级为译文文本，不影响管道

## 声明

题面与样例版权归 AtCoder / Codeforces / 牛客及各出题人所有；中文翻译由 AI 生成，仅供学习交流。
