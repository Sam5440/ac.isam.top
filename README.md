# AC 题库 · ac.isam.top

AtCoder Beginner Contest 与 Codeforces 比赛题目的**自动抓取题库**：完整题面、样例数据、难度分级，全部由 AI（`gpt-6.1-sol`）翻译为简体中文，随 GitHub Actions 持续更新，部署于 Vercel。

> UI 与工程结构参考 [ys_problem_web](https://github.com/Sam5440/ys_problem_web)（[ysdaily.isam.top](https://ysdaily.isam.top/)）。

## 功能一览

- **题库**（`/problems`）：全部收录题目，按平台 / 难度带 / 关键词筛选
- **比赛**（`/contests`）：ABC 与 Codeforces 赛事列表，进入单场查看题目清单
- **题目页**（`/problems/[platform]/[id]`）：完整题面 **中文翻译 / 英文原文** 一键切换、样例输入输出（一键复制）、时间/内存限制、难度徽章（CF rating / AtCoder 实验难度）、算法标签（中文）
- **自动管道**：抓取 → HTML→Markdown（公式归一为 `$…$`）→ AI 翻译 → 索引重建 → 提交推送 → Vercel 自动部署

## 数据来源

| 平台 | 元数据 | 题面 | 难度 |
| --- | --- | --- | --- |
| AtCoder (ABC) | [kenkoooo](https://kenkoooo.com/atcoder/) `resources/*.json` | `atcoder.jp/contests/{cid}/tasks/{pid}?lang=en`（HTTP 抓取） | problem-models 实验难度 ⌀ |
| Codeforces | [CF API](https://codeforces.com/api) `contest.list` / `problemset.problems` | `codeforces.com/contest/{id}/problems`（**Playwright 真实 Chromium** 过 Cloudflare） | CF rating |

## 目录结构

```
app/                     # Next.js 15 App Router 站点
  problems/…             # 题库浏览页 + 题目详情页（中英切换）
  contests/…             # 比赛列表 + 比赛详情页
components/              # UI 组件（shadcn 风格，KaTeX/高亮客户端运行时）
lib/                     # 数据读取、Markdown+公式渲染、标签中文化
scripts/
  fetch.mjs              # ★ 数据管道入口（抓取 + 回填 + 翻译 + 重建索引）
  build-index.mjs        # 重建 data/index.json
  lib/atcoder.mjs        # ABC 元数据 + 题面解析（<var> 内 TeX → $…$）
  lib/cf.mjs             # CF 元数据 + Playwright 抓取 + 题面解析（$$$…$$$ → $…$）
  lib/llm.mjs            # OpenAI 兼容翻译客户端（gpt-6.1-sol）
  lib/html2md.mjs        # 站内 HTML → Markdown 通用转换器
data/                    # 提交进仓库的数据（Vercel 构建时读取）
  {platform}/contests.json
  {platform}/problems/{id}.json
  index.json             # 全量索引 + 统计（首页/题库页用）
.github/workflows/       # fetch.yml（定时拉取）+ ci.yml（构建检查）
```

## 本地使用

```bash
npm install
npx playwright install chromium      # 首次需要（CF 抓取用）

cp .env.example .env.local           # 填入翻译端点信息

# 初始化：拉取 ABC / CF 各自最新 10 场全部题目并翻译
npm run fetch:init

# 日常增量（与 CI 相同参数）：补最新比赛 + 回填 10 道历史题面 + 翻译
npm run fetch:ci

# 只补翻译
npm run translate

npm run dev                           # 本地预览 http://localhost:3000
```

`.env.local`（已 gitignore）：

```
TRANSLATE_BASE_URL=http://wuyou.cloud.isam.top:3000/v1
TRANSLATE_API_KEY=sk-…
TRANSLATE_MODEL=gpt-6.1-sol
TRANSLATE_CONCURRENCY=4
```

## GitHub Actions CI

`.github/workflows/fetch.yml` 每 6 小时（及手动触发）执行一次完整管道：

1. 扫描最近 3 场 ABC 与 3 场 CF，抓取其中**新比赛的全部题面**（最新题面）
2. **回填**：从最旧的比赛开始，补抓历史尚未拉取的 **10 道**题面（逐步覆盖全部赛次）
3. AI 翻译所有缺译文的题面（并发 4，失败下次自动重试）
4. 重建 `data/index.json`，有变更则由 bot 提交推送 → Vercel 自动重新部署

### 需要配置的仓库 Secrets（Settings → Secrets and variables → Actions）

| Secret | 值 |
| --- | --- |
| `TRANSLATE_BASE_URL` | `http://wuyou.cloud.isam.top:3000/v1` |
| `TRANSLATE_API_KEY` | `sk-…`（翻译端点密钥） |
| `TRANSLATE_MODEL` | `gpt-6.1-sol` |

命令行配置（`gh` CLI）：

```bash
gh secret set TRANSLATE_BASE_URL -b "http://wuyou.cloud.isam.top:3000/v1"
gh secret set TRANSLATE_API_KEY  -b "sk-…"
gh secret set TRANSLATE_MODEL    -b "gpt-6.1-sol"
```

## Vercel 部署

1. 将本仓库推送到 GitHub（`data/` 一并提交）
2. [vercel.com](https://vercel.com) → Add New Project → 导入仓库
3. Framework preset 自动识别为 Next.js；`vercel.json` 已固定构建命令
   `node scripts/build-index.mjs && next build`，无需其它配置
4. Deploy —— 之后每次 CI 推送 `data/`，Vercel 自动重新构建部署

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

题面与样例版权归 AtCoder / Codeforces 及各出题人所有；中文翻译由 AI 生成，仅供学习交流。
