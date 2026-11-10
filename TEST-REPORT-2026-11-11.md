# v1.6.0 完整测试报告（2026-11-11）

> 全部 15 个提交已推送 `origin main`，生产已部署 Vercel 并通过完整 E2E（Playwright）验证。
> 截图目录：[gui-test-screenshots/2026-11-11/](gui-test-screenshots/2026-11-11/)（23 张）。

## 1. 环境信息

| 项目 | 值 |
|---|---|
| 提交范围 | `92c5f7c7` → `515b6027`（共 15 个提交，见第 2 节清单） |
| Node 版本 | v25.9.0（本地）/ 22.x（.nvmrc，Vercel 按 engines 选择） |
| 本地构建 | 2026-11-11，`npm run build`（含 SSG，400 题面 + 80 赛事页全部预渲染） |
| 部署 | Vercel Production READY（https://ac.yslsy.top / https://acisamtop.vercel.app） |
| 浏览器 | Playwright Chromium headless（生产站点实测） |

### 提交清单（按序，每步 `npm test` 通过）

| # | 提交 | 内容 |
|---|---|---|
| 1 | `92c5f7c7` | feat: 全局 Toast 通知与统一加载组件（ToastHost/LoadingOverlay） |
| 2 | `7b738b48` | feat: AI 设置整合进「AI 服务商」——补全方案内嵌、思考深度与本站转发开关 |
| 3 | `ba574142` | feat: AI 对话升级——多会话、浮窗模式、思考过程与运行结果上下文 |
| 4 | `e57f5787` | feat: 新增 /ide 在线编程工作台 + 顶栏「更多」导航 |
| 5 | `bead46e0` | feat: 新增 /history 浏览历史（停留时长统计与最近判题状态） |
| 6 | `64213b3e` | feat: 新增 /ci 抓取日志页，fetch 定时改为每小时并输出 ci-log.json |
| 7 | `5bec3b73` | feat: 新增 /calendar 比赛日历（Clist 代理 + 月历视图） |
| 8 | `2c5fb675` | fix: 对照模式中英段落重复图片去重 |
| 9 | `5ccc000d` | feat: 样例输入输出支持 LaTeX 渲染（复制保持原始文本） |
| 10 | `a243fb64` | feat: 外观分区支持 IDE 主题联动（自动/手动绑定） |
| 11 | `9d95f46e` | feat: 全站长耗时操作接入加载动画与 3 秒 Toast |
| 12 | `3e6a03b7` | chore: 发布 1.6.0 —— 更新日志与测试报告框架 |
| 13 | `d0763c22` | fix: Clist 鉴权改为直传 Key（v4 不支持 Bearer 前缀） |
| 14 | `7044143e` | fix: 兼容 Clist v4 objects 扁平数组响应结构 |
| 15 | `515b6027` | fix: E2E 修复三处回归——IDE 库版本冲突、dock toast 遮蔽、浮窗标题栏按钮点击失效 |

## 2. 自动化验证

### 2.1 `npm test`（node --test，74 用例）

```
ℹ tests 74
ℹ pass 74
ℹ fail 0
```

新增测试文件：`test/toast.test.mjs`、`test/ai-assign.test.mjs`、`test/chat-think.test.mjs`、
`test/chat-store.test.mjs`、`test/ide-zip.test.mjs`、`test/view-history.test.mjs`、
`test/img-dedup.test.mjs`、`test/math-pre.test.mjs`、`test/ide-theme-map.test.mjs`。

### 2.2 `npm run build`（完整，含 SSG）

```
✓ Compiled successfully
● /problems/[platform]/[problemId]  → 400 个静态题面页预渲染成功
● /contests/[platform]/[contestId]  → 80 个赛事页预渲染成功
○ /ide /history /ci /calendar /settings 均编译通过
```

### 2.3 部署冒烟（生产环境 curl）

| 路径 | 状态 |
|---|---|
| `/`、`/settings`、`/ide`、`/history`、`/ci`、`/calendar` | 200 |
| `/api/contests/clist` | 200，返回真实 Clist 数据（缓存生效） |
| `/api/problems?q=…` | 200 |

## 3. 功能验证矩阵（E2E 实测，Playwright 对生产站点）

| 功能 | 验证方式 | 截图 | 结果 |
|---|---|---|---|
| 工作项 0：Toast + 加载组件 | 触发拉模型失败 → 3s 内 error toast 自动出现并消失 | [10-toast-error.png](gui-test-screenshots/2026-11-11/10-toast-error.png) | ✅ |
| 工作项 1：AI 设置整合 | 设置页无独立「AI 代码补全」分区；「AI 服务商」含两个子标签；三个模块挑选器均具备 服务商/模型/思考深度(关闭·低·中·高)/本站转发 | [01-settings-top.png](gui-test-screenshots/2026-11-11/01-settings-top.png) · [01-settings-module-pickers.png](gui-test-screenshots/2026-11-11/01-settings-module-pickers.png) · [01-settings-ai-completion-tab.png](gui-test-screenshots/2026-11-11/01-settings-ai-completion-tab.png) | ✅ |
| 工作项 2：AI 对话浮窗 | 默认 float 居中浮窗；拖拽 100px 生效（x 454→340）；右下角缩放 560×640→650×730；刷新后几何持久；多会话新建/切换正常 | [02-chat-float-open.png](gui-test-screenshots/2026-11-11/02-chat-float-open.png) · [02-chat-after-drag-resize.png](gui-test-screenshots/2026-11-11/02-chat-after-drag-resize.png) · [02-chat-history-list.png](gui-test-screenshots/2026-11-11/02-chat-history-list.png) · [02-chat-new-session.png](gui-test-screenshots/2026-11-11/02-chat-new-session.png) | ✅ |
| 工作项 3.1：/ide | 三栏布局 + 底部终端；默认 main.cpp；新建 sol.py 出现第二标签；搜索题目载入样例进测试面板 | [03-ide-initial.png](gui-test-screenshots/2026-11-11/03-ide-initial.png) · [03-ide-new-file.png](gui-test-screenshots/2026-11-11/03-ide-new-file.png) · [03-ide-search-results.png](gui-test-screenshots/2026-11-11/03-ide-search-results.png) · [03-ide-with-problem.png](gui-test-screenshots/2026-11-11/03-ide-with-problem.png) | ✅ |
| 工作项 3.2：/history | 页面正常渲染（新 profile 空态） | [04-history.png](gui-test-screenshots/2026-11-11/04-history.png) | ✅ |
| 工作项 3.3：/ci | 最近一次运行摘要卡 / 抓取明细表 / 未完成任务 / 下次计划 / Actions 外链齐全 | [05-ci.png](gui-test-screenshots/2026-11-11/05-ci.png) | ✅ |
| 工作项 3.4：/calendar | 月历网格（周一首）+ 事件点 + upcoming 列表；翻月正常；API 走服务端代理（Key 不出网） | [06-calendar.png](gui-test-screenshots/2026-11-11/06-calendar.png) · [06-calendar-next-month.png](gui-test-screenshots/2026-11-11/06-calendar-next-month.png) | ✅ |
| 顶栏「更多」导航 | 下拉恰好 4 项；点击跳转 /calendar 正确 | [07-header-more-open.png](gui-test-screenshots/2026-11-11/07-header-more-open.png) | ✅ |
| 工作项 4：图片去重 | 单元测试 10 例（EN+ZH 同图删 / ZH 独有留 / 同段重复留首 / &amp; 转义命中）；CF 1A 无图题对照模式正常 | [08-problem-4a-samples.png](gui-test-screenshots/2026-11-11/08-problem-4a-samples.png) | ✅（单测覆盖） |
| 工作项 5：样例 LaTeX | `hasMathTex` 7 组断言（`$10^9$` true；`$5 and $10` false）；CopyBox 渲染路径产出 zs-math token 由全局 KatexRuntime 渲染；复制仍为原文 | [08-problem-4a-samples.png](gui-test-screenshots/2026-11-11/08-problem-4a-samples.png) | ✅（单测覆盖） |
| 工作项 6：双外观联动 | 「IDE 外观」子块存在，跟随网页/手动可切换；`mappedIdeTheme` 8 组单测断言 | [09-appearance-ide-theme.png](gui-test-screenshots/2026-11-11/09-appearance-ide-theme.png) | ✅ |
| 工作项 7：全站加载/Toast | 9 条长耗时流程接入（设置导入导出/拉模型/WebLLM/离线同步/渠道体检/运行时下载等） | [10-toast-error.png](gui-test-screenshots/2026-11-11/10-toast-error.png) | ✅ |
| 回归：题目页 CompilerDock | 修复后题目页 0 console error；浮窗按钮点击恢复正常 | [fix-2-problem.png](gui-test-screenshots/2026-11-11/fix-2-problem.png) · [fix-3-chat.png](gui-test-screenshots/2026-11-11/fix-3-chat.png) · [fix-1-ide.png](gui-test-screenshots/2026-11-11/fix-1-ide.png) | ✅ |

结构化结果：[e2e-results.json](gui-test-screenshots/2026-11-11/e2e-results.json)（首轮 10 项）+ [fix-results.json](gui-test-screenshots/2026-11-11/fix-results.json)（回归 3 项）。

### E2E 发现并已修复的 3 个 Bug（提交 `515b6027`）

1. **IDE IndexedDB 版本冲突（P1）**：`lib/view-history.js` 以 v2 打开 `ac-ide`，`lib/ide-workspace.js` 仍以 v1 打开 → 先浏览题目再进 /ide 抛 `VersionError`。修复：ide-workspace 升 v2 并双 store 判空补建。
2. **CompilerDock toast 变量遮蔽（P1）**：本地 `const [toast] = useState` 遮蔽全局 `import { toast }` → 下载进度回调 `null.info` TypeError。修复：本地状态改名 `saveToast`。
3. **浮窗标题栏按钮点击失效（P2）**：头部 pointer capture 吞掉按钮 click。修复：拖拽起点排除 `button/input/select/textarea/a`。

### CI / 秘钥配置

- `CLIST_API_KEY` 已写入 **GitHub Secrets**（Actions 用）与 **Vercel 环境变量**（Production + Preview）；`.env.example` 仅占位符，密钥未入任何提交。
- fetch.yml cron 已改为每小时（`23 * * * *`），concurrency 排队防并发。

## 4. 已知限制

| 限制 | 说明 |
|---|---|
| ⚠️ ac.isam.top 域名 404（需人工处理） | 该域名在 Cloudflare 是**橙云代理 A 记录，指向错误源站**（返回 Apache Test Page），并非 Vercel。Vercel 侧项目/别名/证书全部正常，同项目的 ac.yslsy.top 与 acisamtop.vercel.app 全功能可用。**修复方法（只能由账号所有者在 Cloudflare 面板操作）**：DNS 记录 `ac` 改为 CNAME → `cname.vercel-dns.com`，并把橙云改为 DNS only（灰云，参考 ysdaily.isam.top 的配置）。 |
| https→http 强制转发的 localhost 例外 | 本地模型服务（localhost）走代理不可达，保持直连并有徽章提示「仅本地可用」。 |
| Clist 限流 | 上游 10 req/min，站内代理缓存 600s + 在途去重；翻月即重新请求。 |
| IndexedDB 隐私模式 | 浏览器隐私模式下 IDE 工作区/浏览历史降级为内存（仅当前会话）。 |
| WebLLM | 本地推理仅在支持 WebGPU 的浏览器可用；权重下载量大约 1–2GB。 |
| 浮窗思考过程展示 | 需模型返回 `reasoning_content` 或 `<think>` 标签；无思考输出的模型不显示该块。 |
| 编译运行 | 浏览器端 wasm-clang 运行时约 150MB，首次下载有 toast 提示与进度条；E2E 未实际下载（避免大流量），判题链路与 CompilerDock 复用同一套已验证代码。 |
