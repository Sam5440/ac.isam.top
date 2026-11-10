# AC 题库代码审查与性能评估报告

- **评估日期**：2026-11-10
- **评估对象**：当前工作区（Next.js 15 App Router；数据约 16,071 道题、2,928 场比赛）
- **优先级原则**：先处理可被利用的服务器端风险，再处理会消耗用户数据/资源、构建过重及核心功能不正确的问题。
- **工作区保护**：开始时发现 `data/index.json`、`scripts/build-index.mjs` 有未提交修改。本次没有覆盖或改动这两项；完整构建和数据生成在独立临时副本执行。报告中的构建数据使用了开始时的当前工作区代码和数据，包括上述现有修改。

### 审阅覆盖说明

重点静态审阅了项目/锁文件/Next/Vercel/环境示例/CI 配置、数据构建与抓取/翻译脚本、主要 App Router 页面、题库/比赛浏览、富文本渲染与 AI 代理、翻译状态存储、PWA 缓存及 IDE 主线程/Worker 客户端。实际浏览器验证覆盖首页、题库搜索、一道题目页、移动宽度、PWA 激活、代理与富文本净化。此报告不是对 `app/`、`components/`、`lib/`、`scripts/` 共约 22,450 行的逐行形式化审计；IDE 的 C++/Python 编译、样例对拍和交互输入没有在本轮重新运行。仓库内已有的历史报告作为背景阅读，但当前结论均以本轮重查的代码和本轮实际结果为准。

## 1. 整体评估

项目是一个数据随 Git 更新的题库网站：抓取与翻译脚本写入 `data/`，`scripts/build-index.mjs` 构建浏览索引，Next.js 将首页、题库、比赛及题目详情静态生成；浏览器端负责题目筛选、译文补齐、IDE/AI 和 PWA 离线缓存。架构边界总体清楚，IDE 和本地模型已采用动态导入/按需初始化，题面详情有良好的错误兜底。

主要运行链路为：GitHub Actions 周期运行 `scripts/fetch.mjs` → AtCoder/Codeforces/牛客抓取与可选 AI 翻译 → 更新 `data/**` 和索引 → bot 提交 → Vercel 运行 Next 构建；浏览器访问题库时先拿轻量索引再由 `ProblemsBrowser` 本地筛选，题面页将 Markdown 切段后交由实时 MT/AI 和 KaTeX/Highlight 渲染。IDE 主线程把请求交给 C++/Python Web Worker，运行时经同源 public 文件或 Cache API 获取；PWA 使用 Service Worker 与 `/offline-manifest.json` 预取题目、资源和 C++ 运行时。对外 AI/MT 相关路由分别为 `/api/ai/proxy`、`/api/mt/[channel]`。

**最需要整改的是三个不同层面的风险：**

1. `/api/ai/proxy` 在 Vercel 部署时的私网检测可被 IPv4-mapped IPv6 表示绕过；本地隔离测试已通过该代理读到只监听 `127.0.0.1` 的测试服务。按 P0 处理。
2. 全站预渲染规模已达 19,009 页；本次干净副本生产构建用了 135 秒、最高 RSS 约 1.69 GiB，构建目录约 3.8 GiB。这是最明显的构建效率、存储和发布扩展瓶颈。
3. 首次访问会自动启动离线预取；干净 Chromium 配置下观察到自动同步最近 100 场、727 页，并缓存约 223 MiB 的页面、资源和 C++ 运行时。对移动网络/存储空间这是不必要的隐式成本。

另有一项可复现的持久化富文本问题：HTML 实体编码的 `javascript:` 链接可穿过正则清理器，并在点击时执行脚本。以及机器翻译渠道被选择时显示永久加载、却不发出该渠道请求的题面体验缺陷。

### 优先级总览

| 顺序 | 优先级 | 项目 | 依据/排序原因 |
|---:|---|---|---|
| 1 | **P0** | `/api/ai/proxy` IPv4-mapped IPv6 SSRF 绕过及中继滥用面 | 本地 `VERCEL=1` 实测绕过私网检查并读到 loopback 测试响应；服务器端请求伪造风险最高。 |
| 2 | **P1** | `renderRich` 的实体编码 `javascript:` 链接净化绕过 | 在当前页面源下实测点击执行脚本；AI 对话消息会持久化，题面/译文也来自外部。 |
| 3 | **P1** | 19,009 页全量 SSG 与过大的构建产物 | 生产构建实测 135 秒 / 1.69 GiB RSS / 3.8 GiB `.next`；限制发布速度和构建资源。 |
| 4 | **P1** | PWA 激活自动下载页面及约 139 MiB C++ 运行时 | 新 Chromium 上实测自动同步 100 场、727 页，缓存总量约 223 MiB，未经明确选择即占用流量和存储。 |
| 5 | **P1** | 首页链接预取完整题库数据 | 首页浏览器请求中已出现 `/problems` RSC 预取：传输约 470 KB、解码约 2.60 MB，即使用户没打开题库。 |
| 6 | **P1** | 选择 DeepL 等渠道时存档题面显示永久加载 | 新浏览器上下文复现 2 个加载占位，5 秒内没有对应翻译请求。 |
| 7 | **P1** | 构建期获取浮动分支的 139 MiB WASM 运行时 | 清洁 CI/Vercel 构建依赖远端 mutable branch；当前构建因已有本地 manifest 跳过了下载，真实冷构建成功率/完整耗时未验证。 |
| 8 | **P2** | 静态生成时重复读取/解析全量索引 | 3.77 MB 索引单次解析均值约 9.05 ms；逐页查找会重复执行。为估算值，未单独做 CPU profile。 |
| 9 | **P2** | 自动化测试及依赖安全扫描不足 | 仓库无匹配的测试文件/`test` 脚本；`node --test` 发现 0 项。`npm audit` 因网络 TLS 失败，漏洞状态未确认。 |
| 10 | **P2** | 构建/运行时版本与 CI 不一致 | 本机实测 Node 25.9.0，CI 固定 Node 22；本次构建成功不能替代 Node 22 CI 结果。 |

## 2. 逐项整改建议

### P0-1：修正 AI 代理的 IP 归一化、SSRF 防护和中继限制

| 项目 | 说明 |
|---|---|
| **问题描述** | `/api/ai/proxy` 接受调用方指定的 URL/方法/头/请求体。Vercel 下 `BLOCK_PRIVATE` 只用主机字符串匹配私网形式；IPv4-mapped IPv6（例如 `[::ffff:127.0.0.1]`）不匹配现有 `localhost` / `127.*` 规则。Origin/Host 相等检查可挡普通浏览器跨站请求，但请求头本身不是认证凭据，不能防止任意 HTTP 客户端伪造同源头后调用中继。 |
| **代码位置** | `app/api/ai/proxy/route.js:27-41, 49-60, 76-111`。 |
| **判断依据** | 在隔离副本以 `VERCEL=1` 启动生产服务，并在 `127.0.0.1` 起一个只返回 `local-only` 的测试 HTTP 服务。同源请求直连 `http://127.0.0.1:<port>` 返回 403；将主机改为 `http://[::ffff:127.0.0.1]:<port>` 返回 200 和 `local-only`。代理也接受人为设置 `Origin: http://127.0.0.1:3210` 的客户端请求。没有访问任何生产服务。 |
| **影响范围** | 服务端私网探测/访问、内网 HTTP 服务和云实例元数据风险；同时，任意客户端可以将其用作通往任意公网 URL 的匿名服务器端中继。另有全量 `arrayBuffer()` 后才检查 8 MiB 响应上限，响应过大时仍会先占用内存。 |
| **修改建议** | 在代理边界统一 URL、域名与 IP 校验，而不是按原始字符串判断：解析 IPv4、IPv6 与 IPv4-mapped IPv6，并拒绝 loopback、link-local、ULA、私有、保留/未指定地址；域名解析后检查 A/AAAA 的全部结果，处理 DNS rebinding（解析后绑定已验证目标或采用受控出站代理）。拒绝重定向，或对每一跳重新解析并校验。Vercel 只允许 HTTPS、限制端口并采用服务商域名白名单/可审核配置；自托管 localhost 能力应单独保留在自托管路径。增加服务端速率/并发配额和上游响应流式字节上限。不要将 Origin/Host 等值称为用户鉴权。 |
| **预期收益** | **已实测**：不再允许本次复现的 IPv4-mapped IPv6 loopback 请求。其他非全球 IP、DNS rebinding、重定向和流式上限的收益为**待实现并验收**。 |
| **实施成本** | 中等，约 1–2 人日：IP/DNS 处理、限流部署方案、代理契约测试及现有 AI/模型列表/补全回归。若允许任意用户自定义服务商，需在灵活性与严格 allowlist 之间明确取舍。 |
| **风险与验证** | 保持浏览器端 BYOK 兼容，同时保证 Vercel 上不访问用户私网地址。测试 127/8、RFC1918、169.254/16、`::1`、`fc00::/7`、`fe80::/10`、IPv4-mapped IPv6、整数/压缩 IP、双栈 DNS、DNS 变化、重定向、恶意 Origin、请求体及响应超限；验证合法 AI 厂商与 Anthropic/OpenAI 兼容调用。 |
| **整改优先级** | **P0，立即处理**。已有 SSRF 绕过实证，且目标是服务端代理。 |

### P1-1：用解析器/白名单修复富文本 URL 净化绕过

| 项目 | 说明 |
|---|---|
| **问题描述** | `sanitizeRichHtml` 用正则清理 `href`/`src` 中的危险 scheme，但在 HTML 实体解码前运行。`java&#x73;cript:` 经 HTML 解析后成为 `javascript:`，`java&#x09;script:` 中的控制空白也可能被浏览器 URL 解析规则规范化；未经净化的链接仍可进入 `dangerouslySetInnerHTML`。 |
| **代码位置** | `lib/render.js:105-140`；消费点包括 `components/chat/ChatPanel.jsx:302`、`components/StatementBody.jsx:69,262,269`、`components/SamplesSection.jsx`。AI 会话通过 `lib/chat-store.js` 持久化。 |
| **判断依据** | Node 中 `renderRich('<a href="java&#x73;cript:window.__entityProbe=7">…</a>')` 原样输出实体 URL。真实浏览器解析该 HTML 后，`getAttribute('href')` 得到 `javascript:window.__entityProbe=7`；点击链接后探针变量变成 `7`。该复现使用本地页面，不涉及线上数据。普通 `onerror` 已由当前过滤器剥除，因此本项特指 URL 净化边界仍不完整。 |
| **影响范围** | 用户点击恶意 AI 回复、外部译文或题面链接时，同源脚本可在页面权限下执行；存储的 AI 回复可能使恶意链接跨会话保留。相较于无需点击的事件处理器注入，此复现需要用户点击，因此列 P1。 |
| **修改建议** | 用 HTML parser + 明确的标签/属性 allowlist 净化，并在解析器解码实体后验证 URL。`href` 只允许相对路径及 `https:`/`http:`/明确需要的 `mailto:`，拒绝 `javascript:`、`vbscript:` 和非允许的 `data:`；`src` 对图床等图片来源单独列白名单。继续限制 `on*`、`srcdoc` 等危险属性。选择同时适用于 SSG/Node 与浏览器的实现，或拆开 server/client 渲染；不要继续叠加 URL 正则。可再加 CSP 作为纵深防御，但不能以 CSP 代替净化。 |
| **预期收益** | **已实测基线**：实体链接可执行脚本。修复后的收益以恶意用例不再执行、正常题面图片/公式/代码仍保留为验收结果，不作性能百分比承诺。 |
| **实施成本** | 中等，约 0.5–1.5 人日，取决于选用库和 isomorphic 输出兼容；需注意不要破坏 KaTeX token、marked 代码块或牛客图床。 |
| **风险与验证** | 用 Chromium 实测实体编码、十进制/十六进制字符引用、tab/换行、大小写、无引号属性、畸形 HTML、SVG、事件属性及跳转 scheme；测试点击恶意链接的探针不得执行；同时抽查图片、表格、代码、公式及对照译文。SSR 与 hydration 结果须一致。 |
| **整改优先级** | **P1**。脚本执行需用户点击，但外部内容可控且可持久化。 |

### P1-2：控制全量静态生成规模和构建产物体积

| 项目 | 说明 |
|---|---|
| **问题描述** | 题目详情及比赛详情的 `generateStaticParams()` 在每次生产构建预生成全部路径。题数增长会近似线性增加渲染、磁盘和 CI/Vercel 构建压力。 |
| **代码位置** | `app/problems/[platform]/[problemId]/page.jsx:25-30`、`app/contests/[platform]/[contestId]/page.jsx:13-24`、`package.json` 的 `build`、`.github/workflows/ci.yml`。 |
| **判断依据** | 隔离副本执行完整 `npm run build`：Next 输出 `Generating static pages (19009/19009)`，耗时 **135.04 秒**，`/usr/bin/time -l` 报最高 RSS **1,686,372,352 bytes（约 1.57 GiB）**。构建后临时副本 `.next` 约 **3.8 GiB**，其中 `.next/server/app` 约 **2.9 GiB**；统计 HTML 文件约 **1,923 MiB**、RSC 文件约 **867 MiB**。这是本机测试结果，非 Vercel 构建时间。 |
| **影响范围** | CI 超时/排队、开发机和构建机磁盘及内存占用、发布等待时间；随着数据增加，静态产物会继续变大。 |
| **修改建议** | 评估“近期热门题/比赛静态生成，其余按请求生成并缓存”的混合方案：限制 `generateStaticParams` 到有限窗口，保持动态参数可按需生成，按数据更新节奏配置 ISR；详情页数据必须在部署产物中可读，验证 Next/Vercel 输出文件追踪是否包含请求时所需的 `data/**`，不可只删除路径后假设回退可用。另将构建页数、构建耗时、RSS、`.next` 大小记录为 CI 指标/阈值。若业务强依赖全部 HTML 静态化，应先测试更大构建机、增量缓存及分页数据发布。 |
| **预期收益** | **已实测基线**：135 秒、1.57 GiB RSS、3.8 GiB 输出目录。按需生成可减少构建时必须渲染的页面数量；具体耗时/体积收益需在同一 CI runner 做 A/B 构建，不能从本机结果直接承诺百分比。 |
| **实施成本** | 中到高，约 2–4 人日：需设计静态窗口/缓存失效、配置输出追踪、验证首次访问和 404/ISR 行为，并测试 Vercel 部署包大小。 |
| **风险与验证** | 可能将首次访问延迟从构建时转到请求时；过期缓存与数据新鲜度需明确。用与全量 SSG 同一快照比较首页、近期/历史题目、比赛页、无效 ID、数据更新后的缓存失效；对 Vercel Preview 验证旧页与未预渲染页面。 |
| **整改优先级** | **P1**。构建已经达到分钟级和数 GiB 产物，且数据仍在增长。 |

### P1-3：首次激活只缓存最小离线壳；重资源改为显式选择

| 项目 | 说明 |
|---|---|
| **问题描述** | 首次注册/激活 Service Worker 会自动触发离线同步：最近 100 场的详情及题目页，随后预取编译器运行时。无须用户先打开“离线缓存”设置，浏览器也会开始缓存约 139 MiB 的 C++ 二进制。 |
| **代码位置** | `components/PwaRegister.jsx:24-35`；`lib/pwa/sw-source.js:274-354, 419-445`；`app/offline-manifest.json/route.js:11-25`；`components/OfflineCacheSection.jsx:7,154`。 |
| **判断依据** | 用新的 Python Playwright Chromium browser context 访问本机生产服务，等待 8 秒后，SW 状态为已控制；同步元数据记录 `contests: 100`、`pages: 727`，状态已到 `compiler-start`。Cache Storage 累计：页面约 **78.5 MiB**、资源约 **1.2 MiB**、编译运行时约 **139.1 MiB**、shell 约 **4.1 MiB**，合计约 **223 MiB**。这是一份本地冷 browser context 的实际缓存数据。 |
| **影响范围** | 首访后的后台流量、移动数据、电量、浏览器站点存储配额及低存储设备可用性；运行时和页面缓存同时占用时，用户未必知道下载仍在进行。 |
| **修改建议** | Service Worker install/activate 仅缓存应用 shell 与必要 JS/CSS；取消 activate 中默认 `syncOffline(100)`。把页面离线包和“离线编译器 139 MiB”拆成单独、显式 opt-in 的操作；点击前显示预计页数/字节数，显示阶段/流量进度，允许暂停和取消。默认可由用户选取比赛数，改为 Wi-Fi/空闲状态自动续传需额外授权。 |
| **预期收益** | **已实测**：冷访问后台缓存总量约 223 MiB，其中 WASM 约 139 MiB。改为显式选择后，未选择离线功能的首次访问不再承受这些下载；实际流量节约按用户选择比例计算。 |
| **实施成本** | 中等，约 1–2 人日；需将激活、消息触发、设置 UI 和同步状态机一起改，保留用户主动同步能力。 |
| **风险与验证** | 用户期待自动离线的行为可能改变，需在设置/提示中解释。清洁 profile 首访应只下载 shell；未授权不产生页面/编译器下载；手动选择 30/50/100/200 场可按上限完成、可中止、再次进入能续传；离线已缓存页面仍可打开。 |
| **整改优先级** | **P1**。工作流隐藏且首次自动传输约 223 MiB，对移动设备影响大。 |

### P1-4：首页不应预取完整题库浏览载荷

| 项目 | 说明 |
|---|---|
| **问题描述** | 首页“浏览题库”链接使用默认 Next.js 预取。由于 `/problems` 页一次向客户端传输 16,071 条题目索引，首页可在用户未点击时就预取完整题库 RSC。 |
| **代码位置** | `app/page.jsx:54-66`；列表数据由 `app/problems/page.jsx:11-45` 和 `components/ProblemsBrowser.jsx` 提供。 |
| **判断依据** | 在本机生产构建的浏览器 Performance Resource Timing 中，访问首页时出现 `/problems`：传输 **469,794 bytes**，解码 **2,597,636 bytes**；`/contests` 也被请求，传输 71,440 bytes。另直接取 `/problems` 响应解压后约 3.26 MB，gzip 基线约 463 KB。搜索 `abc001_1` 功能正确地将 16,071 项筛为 1 项，但数据是在客户端已加载后过滤。 |
| **影响范围** | 首页首屏流量和网络并发，尤其低带宽/移动设备；题库长表每次搜索仍在客户端遍历完整数组。 |
| **修改建议** | 先对“浏览题库/比赛”重载型链接设置 `prefetch={false}`，避免首页无意预取；随后改为服务端过滤/分页或按需 API（每页只传有限结果），URL 保留查询条件便于分享/返回。可增加输入 debounce/useDeferredValue，但它不能替代减少首包数据。 |
| **预期收益** | **已实测**：阻止首页的题库 RSC 预取可避免约 470 KB（压缩传输）无条件首访下载；点击题库仍需获取数据，分页后的收益需对新实现实测。 |
| **实施成本** | 小到中，0.5–2 人日；`prefetch={false}` 是低风险止血，服务器端分页涉及搜索/排序及 URL 状态设计。 |
| **风险与验证** | 确认从首页点击可正常导航、浏览器返回/前进保留筛选与关键词、搜索全数据命中结果一致。对首访首页记录所有 `/problems` 网络请求，未点击时不得有大 RSC 预取。 |
| **整改优先级** | **P1**（先实施小改止血，随后计划分页）。该额外载荷在每个首页访问时不必要。 |

### P1-5：修正已存档译文与逐渠道翻译状态混用

| 项目 | 说明 |
|---|---|
| **问题描述** | `StatementBody` 将“此段有任一 CI 存档译文”记为 `archived` 并传入 `hydrateSegments`。`zh-store` 将这个布尔值用于跳过所有机器翻译渠道的入队任务。用户选定 DeepL 等渠道后，`ZhLine` 仍等待该渠道状态，但该渠道没有任务、状态也不会变成 `failed` 或 `done`，因此占位符持续显示加载中。 |
| **代码位置** | `components/StatementBody.jsx:194-205`；`lib/zh-store.js:161-219`。 |
| **判断依据** | 新 Chromium 上用 `localStorage` 固定 `mode=zh, channel=deepl, resetLangOnLoad=false` 打开已有 AI 存档译文的 `abc001_1`。等待 5 秒后页面仍有 2 个“翻译中…”，请求列表里无 `/api/mt/` 或彩云翻译请求；原始页面题目与归档译文存在。 |
| **影响范围** | 任何已有 CI 译文题目在指定实时 MT 渠道下的加载反馈/译文切换，渠道状态异常时也会让用户无法判断是在工作还是卡住。 |
| **修改建议** | 将状态细化为 `(segment, channel)`，只有 `ai` 渠道使用 CI 存档；MT 选择时明确从 IndexedDB 取该渠道结果，缺失则排队并进入 loading，失败落 failed。若产品策略是“存档优先”，必须显式回退到归档文本并显示真实来源，而非显示选中渠道和永久 spinner。 |
| **预期收益** | **已实测缺陷**：0 个翻译请求 + 2 个加载占位。验收收益是缓存缺失时请求所选渠道，或显示明确回退译文/失败提示。 |
| **实施成本** | 中等，约 0.5–1.5 人日，需定义优先级链与用户指定渠道的语义并更新 IndexedDB 队列测试。 |
| **风险与验证** | CI 存档渠道、指定 MT 渠道、IndexedDB 命中、接口失败/超时、离线缓存五类回归；确认不会重复调用已命中缓存的段落。 |
| **整改优先级** | **P1**。目前可重复进入永久加载状态，是明确的核心交互缺陷。 |

### P1-6：将构建下载的编译器运行时固定版本并校验完整性

| 项目 | 说明 |
|---|---|
| **问题描述** | 清洁构建会从 `codeload.github.com` 下载另一个仓库的可变 `data/runtime` 分支 tarball，再复制到公共目录。当前仅校验 HTTP 成功和预期文件名，没有固定 commit 或校验摘要。该构建步骤同时是发布流程的外部网络依赖。 |
| **代码位置** | `scripts/fetch-runtime.mjs:22-55`；`package.json:8-9`；`vercel.json:4`；`public/compiler/` 在 `.gitignore` 中排除。 |
| **判断依据** | `public/compiler` 清单标示运行时文件合计 **145,751,933 bytes（139.0 MiB）**。本次隔离构建通过本地 `public/compiler` 软链，观察到“manifest 已存在，跳过”；因此没有测得冷 CI 的下载时间或真实 Vercel 构建影响，也没有验证现存远端分支内容。 |
| **影响范围** | 上游网络/分支变化可使生产构建失败或产物不可重复；未验证内容进入浏览器 WASM/JS 编译器产物，供应链风险及 139 MiB 下载流量。 |
| **修改建议** | 用不可变 commit SHA 取代浮动分支，并将预期 SHA-256/SHA-512 与版本清单一起校验；下载到临时文件后先验证 tar/清单/所有文件大小及摘要，再原子替换输出目录。清理临时目录放入 `finally`。对固定版本产物使用 CI/Vercel 缓存或版本化发布资产。 |
| **预期收益** | **估算/定性**：构建输入可复现，避免上游分支无提示漂移；命中构建缓存时可省去最多 139 MiB 下载。冷构建节省时间须用 Node 22 CI runner 实测。 |
| **实施成本** | 小到中，约 0.5–1 人日：固定来源、生成摘要、增加失败测试及缓存键。 |
| **风险与验证** | 运行时更新需明确版本发布流程；验证摘要错配/文件缺失会失败且保留旧可用目录，固定版本产物可重复构建、编译 C++ 示例通过。 |
| **整改优先级** | **P1**。构建发布持续依赖未固定的大型可执行运行时来源。 |

### P2-1：缓存索引并避免逐路由重复解析

| 项目 | 说明 |
|---|---|
| **问题描述** | `getIndex()` 每次同步读取并 JSON.parse 整份索引，无模块级缓存。Root layout 每页读取更新信息；详情页的 `findProblem` 还从全量索引查找 ID，再读取单题文件。全量 SSG 下相同索引重复解析。 |
| **代码位置** | `lib/data.js:10-16,58-61,63-83`；`app/layout.jsx:81-82`；`app/problems/[platform]/[problemId]/page.jsx:40-50`。 |
| **判断依据** | 当前 `data/index.json` 为 3,773,966 bytes。Node 25.9 上对该 JSON 做 100 次文件读取+解析，均值 **9.05 ms/次**；16,071 次解析相当于约 **145 秒 CPU 工作量**（估算，不是构建 profiler 实测）。构建整体实测 135 秒，不能将该简单估算解读为可直接节省 145 秒。 |
| **影响范围** | SSG 构建 CPU、GC 和同步文件 I/O；索引变大时增加详情路由初始化工作。 |
| **修改建议** | 对构建期和服务端进程的静态只读索引做进程内 memoization；如果进程会热加载数据，应以 `mtime/size` 或构建版本作为缓存键。另为详情查询创建 `(platform,id) -> summary` Map，避免每次线性扫描。SSR/SSG 中数据更新应在构建时替换模块缓存，而不是跨构建污染。 |
| **预期收益** | **实测单次基线**为 9.05 ms、3.77 MB；整轮构建节省量为估算，须以 CPU profile 和构建前后同 runner A/B 测定。 |
| **实施成本** | 小，约 0.5–1 人日；需增加索引更新/进程重启测试。 |
| **风险与验证** | 避免开发热更新/测试中缓存旧 `index.json`；构建结果统计、详情查找大小写兼容与错误文件处理保持一致。 |
| **整改优先级** | **P2**。单次解析开销不大，但逐页重复可累计，且与全量 SSG 相乘。 |

### P2-2：补可重复的自动化回归，并恢复可用的依赖审计

| 项目 | 说明 |
|---|---|
| **问题描述** | 当前 `package.json` 没有 `test` 脚本；仓库未发现 `*.test.*`/`*.spec.*` 测试文件。页面、安全过滤、数据生成及 API 契约主要依赖手工检查和历史报告。 |
| **代码位置** | `package.json`、`.github/workflows/ci.yml`；纯函数如 `lib/render.js`、`lib/statement-segments.js`、`scripts/build-index.mjs`、编译器 diff 模块适合作为首批测试目标。 |
| **判断依据** | 本次执行 `node --test`：`tests 0 / pass 0 / fail 0`，退出成功但没有覆盖测试。执行 `npm audit --omit=dev` 时，npm 无法连接 registry 的 bulk audit endpoint（TLS socket disconnected），因此未获得漏洞结果。 |
| **影响范围** | 改动可能通过生产构建却破坏净化、翻译状态、筛选、索引一致性或编译器结果；依赖已知漏洞状态本轮无法确认。 |
| **修改建议** | 增加 `npm test` 和 CI 步骤；先为 `sanitizeRichHtml/renderRich` 建浏览器解析器攻击用例，为 `buildIndex` 建数据聚合与统计用例，为 AI 代理建 IP/重定向/流量上限契约测试，为 `StatementBody`/`zh-store` 建 channel/archived 状态测试；Playwright 保留首页、搜索、详情和移动端 smoke。网络恢复后运行 `npm audit`，并启用 Dependabot/Renovate 或定期锁文件更新。 |
| **预期收益** | **当前实测覆盖为 0 个 Node 测试**；自动回归能在合并前捕获已复现安全及交互缺陷。漏洞扫描收益在 registry 可访问后才能量化。 |
| **实施成本** | 中，约 1–3 人日建立基础测试/CI；此后新增功能的维护成本较低。 |
| **风险与验证** | 不要将网络不可达时的 audit 失败误报为“无漏洞”；测试需 mock 外部翻译服务，CI 不访问付费端点。CI 应在 build 前失败于真实测试失败，而不是 0 tests 仍通过。 |
| **整改优先级** | **P2**。它是持续降低安全与回归风险的工程基础，但当前没有已知依赖漏洞证据。 |

### P2-3：统一 Node 版本，验证 clean build 的冷启动路径

| 项目 | 说明 |
|---|---|
| **问题描述** | CI 使用 Node 22，本机本次使用 Node 25.9.0。完整构建还复用了本机安装的 `node_modules` 和 `public/compiler`，没有走 `npm ci` 后的冷 runtime 下载。 |
| **代码位置** | `.github/workflows/ci.yml:24-34`、`.github/workflows/fetch.yml:42-51`、`package.json`、`scripts/fetch-runtime.mjs`。 |
| **判断依据** | 环境实测 `node -v = v25.9.0`、`npm = 11.12.1`、arm64 macOS；CI 明确 `node-version: 22`。构建副本复用了 node_modules 和 139 MiB runtime 软链。 |
| **影响范围** | 本机构建通过不能完整代表 CI 运行时；未覆盖 clean install、Vercel 下载及其磁盘/时限。 |
| **修改建议** | 增加 `.nvmrc` 或 `engines.node` 固定 Node 22；在 CI 检查 `node --version` 与 lockfile，另运行一次没有预置 runtime 的构建/下载完整性测试。把 clean install、runtime 下载、Next build 的耗时分开记录。 |
| **预期收益** | 版本行为一致、冷构建错误更早显现；无确定百分比收益。 |
| **实施成本** | 小，约 0.5 人日。 |
| **风险与验证** | 升级 Node 需要单独评估，当前建议先对齐 CI 的 Node 22；在 Node 22 跑 `npm ci`、`npm test`、`npm run build` 并保存 build summary。 |
| **整改优先级** | **P2**。本次 full build 成功但测试矩阵与部署 runner 不一致。 |

### P3：完善可访问性、长列表体验和资源监控

- 本次 390×844 移动视口实测 `scrollWidth === clientWidth`，没有发现横向溢出；搜索题目、难度筛选和键盘/读屏流程未做完整 WCAG 审计。建议对设置对话框、焦点回收、键盘导航、颜色对比度、减少动态效果加 axe/手工验收。
- 题库客户端载入全量 16,071 行后只渲染前 200 行，列表高度约 12,470 CSS px；先减少载荷/服务端分页，再评估虚拟滚动。未经低端移动设备 profiler，不建议只凭行数改造成虚拟列表。
- 依赖方面没有证据支持“某个 UI 包完全未使用”，不建议为减小 `node_modules` 而盲目删除。生产构建报告的 shared first-load JS 为 105 KB；题库页 first-load JS 136 KB、题目详情 173 KB、设置页 167 KB；全部静态 chunk 磁盘占用约 20 MB（其中包含非首屏的 lazy chunks）。`monaco-editor`/WebLLM 已按需加载，建议保留这类拆分并通过 bundle analyzer 检查未来回归。当前工作区 `node_modules` 约 549 MB，其中 `npm ls --depth=0` 还显示两个 extraneous 包；这不是浏览器下载量，也不一定反映 CI clean install 产物。
- 加入常规 RUM/构建度量：LCP/INP、路由 RSC bytes、JS 首载、SSG 页数、Next 构建 RSS/时间、离线缓存 bytes。当前仅有一次本机浏览器和构建基线，不代表生产用户分布。

## 3. 实测性能与测试记录

### 测试环境

- Apple Silicon arm64 macOS 27.0，本机报告物理内存约 16 GiB。
- Node v25.9.0 / npm 11.12.1；CI workflow 配置的是 Node 22。
- Next 15.5.28 / React 19.3.1（来自当前安装的 lockfile 依赖树）。
- 生产构建和服务运行于隔离临时副本；生产页面通过 localhost 浏览器访问。未请求外部生产环境或付费 API。

### 已执行测试

| 测试 | 结果 |
|---|---|
| `npm run build:fast`（隔离副本） | 通过；Next 编译 15.5 秒，构建/类型阶段完成，跳过动态路由全量预渲染。 |
| 完整 `npm run build`（隔离副本，`/usr/bin/time -l`） | 通过；生成 19,009 个静态路径，135.04 秒，最高 RSS 1,686,372,352 bytes。 |
| 静态产物体积统计 | `.next` 约 3.8 GiB；`.next/server/app` 约 2.9 GiB；约 19,004 份 HTML 合计 1,923 MiB，RSC 合计 867 MiB。 |
| 本机静态路由请求（Next 生产服务、localhost、非压力测试） | `/` TTFB 50.4 ms / 83 KB 解压体；`/problems` 12.7 ms / 3.26 MB；`/contests` 6.6 ms / 0.98 MB；题目详情 5.7 ms / 107 KB。响应使用 gzip 且 `s-maxage=31536000`。这些数据仅是单次本机响应，不代表公网 RTT 或并发能力。 |
| 首页/题库/题目/比赛/设置路由 | 本机生产服务返回 200；页面无浏览器 pageerror。 |
| 题库搜索 `abc001_1` | 16,071 项筛为 1 项，目标链接正确，`已翻译` 徽章正常；观察到此工作区 `app/problems/page.jsx` 已读取 `translated` 字段。 |
| 移动视口 390×844 | `scrollWidth - innerWidth = 0`；横向溢出未复现。 |
| DeepL 译文渠道 | `abc001_1` 复现 2 个“翻译中…”；5 秒内无对应 MT 请求。 |
| PWA 新 browser context | SW 激活后自动同步 100 场、727 页；Cache Storage 约 223 MiB，包括约 139 MiB C++ runtime。 |
| AI 代理私网测试 | 普通 loopback 返回 403；IPv4-mapped IPv6 loopback 返回 200 并读出本地 mock 内容。 |
| 富文本净化测试 | 事件属性被移除，但 HTML entity 编码的 `javascript:` 链接穿过过滤；浏览器点击执行探针。 |
| `node --test` | 0 tests、0 failures（没有仓库测试文件被发现）。 |
| `npm audit --omit=dev` | 未完成：npm registry TLS socket disconnected；不能据此判断依赖没有漏洞。 |

### 性能测量口径

- 原始路由响应直接在 localhost `fetch` 测量，`/problems` 解压后约 3.26 MB；gzip 文件基线约 463 KB。
- 本机静态 HTML 的 TTFB 约 2.5–50 ms，证明静态路由在无公网 RTT 时读取很快；不应把此数值外推为真实用户的 LCP/INP。未用固定 CPU/网络节流做跨版本性能对比。
- 浏览器首页 Resource Timing 观察到 `/problems` RSC 请求传输约 470 KB、解码约 2.60 MB，符合首页链接预取的数据规模。浏览器此前存在同站缓存，因此它不是严格的公网上行带宽基线。
- 完整构建副本通过本机 node_modules 和 `public/compiler` 软链；runtime 下载步骤显示“manifest 已存在，跳过”。因此 135 秒不包括 clean install、远端 139 MiB runtime 下载或 Vercel 上传。
- 未测外部 LLM/MT 延迟、线上 TTFB、CPU flame graph、生产并发、真实低端设备内存、CI Node 22 build、真实 Vercel bundle。相关估算均未标成实测收益。

## 4. 分阶段整改路线与验收标准

### 阶段 A：安全与功能止血（建议 1–3 天）

1. 修复代理 URL/IP/DNS 校验与流式响应上限；加入针对绕过形式的 API 测试。
2. 换解析器驱动的 HTML allowlist；回归 AI 回复及题面点击行为。
3. 修正 `archived` 与逐渠道翻译状态模型，消除无请求的永久 spinner。

**阶段验收**：mapped IPv6、DNS 重绑定/私网解析、危险 redirect 全部拒绝；编码 `javascript:` 点击探针不执行；DeepL 选择时若无缓存则请求该渠道，或明确显示回退/失败；合法图片、数学公式、代码块通过回归。

### 阶段 B：减少首次访问负载并修建数据分页（约 2–4 天）

1. 先将重载型首页链接设 `prefetch={false}`，确认首页不再请求 `/problems` 大 RSC。
2. 将题库索引改为服务端过滤/分页；把离线同步从 SW activate 移到用户主动选择，并将编译器运行时设为独立 opt-in。

**阶段验收**：未点击题库时无题库 RSC 预取；首访未授权离线时缓存只包含 shell；选择离线包时 UI 显示大小/进度、支持取消，完成数量与选择档位一致。

### 阶段 C：缩短构建与减小产物（约 3–6 天，含 Preview 验证）

1. 在相同 Node 22 runner 建完整 build 基线；增加 Node 22 clean install 与 runtime 冷下载测试。
2. 将 runtime 固定到 immutable commit + 摘要校验。
3. 设计有限静态窗口 + 按需生成/ISR 详情；memoize 索引；检查 Next output tracing 和 Vercel Preview。

**阶段验收**：所有历史题/比赛仍能打开，数据文件在请求运行环境存在；有效/无效参数正确；缓存按发布数据更新；同 runner 报告构建时间、RSS、`.next` 及上传产物规模。目标由团队在测完第一版后设定，不预先承诺百分比。

### 阶段 D：回归、可访问性与持续治理（持续）

- 在 CI 加 `npm test`、浏览器 smoke 和安全净化回归；避免无测试的绿灯。
- 网络恢复后运行 `npm audit`，部署 Dependabot/Renovate；锁 Node 22 并记录依赖升级结果。
- 按真实用户 RUM/低端机性能调整分页、图片策略和 IDE 初始加载；执行键盘/读屏/对比度审计。

**阶段验收**：测试数量大于 0 且 API 安全、索引、翻译状态、主要页面功能覆盖；PR 能看到构建与 bundle/SSG 指标；生产监控能区分网络/上游服务与本地渲染慢。

## 5. 尚未验证/明确限制

- 没有访问外部生产环境、生产数据或付费资源；AI/翻译流程只复用了本地页面和本地 mock 服务。
- IDE 的真实 C++/Python 运行、交互输入、停止/超时与样例对拍未在本轮重新执行；需按阶段 D 增加隔离浏览器回归，不能仅凭已有历史报告将其视为本轮通过。
- npm registry 在本环境 TLS 连接失败，未得到依赖漏洞清单；不能给出“无漏洞”结论。
- 完整 build 在 Node 25.9 本机执行，未在 Node 22 runner 重跑；runtime 下载在本次构建被本地 manifest 跳过。
- 选择性 SSG/ISR 尚未修改验证；Vercel 动态函数输出中的 `data/**` 文件追踪与部署体积是实施前置验证。
- 本次未执行线上 Core Web Vitals、真实手机/慢网测试、并发压测、完整 WCAG 审计、CPU flame graph 或 Python/CDN runtime 首次下载对比。
- 搜索性能的真实主瓶颈被实测为首包数据/预取体积；逐字符筛选的低端设备耗时尚无 profiler 数据，暂不承诺其改善幅度。

## 6. 本次文件与工作区状态

- 主交付物：`OPTIMIZATION-REPORT-2026-11-10.md`。
- 没有提交或执行任何生产数据写入；生产构建及服务仅在临时副本运行。
- 初始未提交改动 `data/index.json`、`scripts/build-index.mjs` 仍保持原状；报告没有执行修复代码。

## 7. 本次整改实施结果（2026-11-10 追加）

本轮已在当前工作区落地并验证以下项目：

- `/api/ai/proxy` 改为 Node runtime；请求体/响应体上限、超时、并发/速率限制、重定向拒绝、固定 DNS 解析连接、IPv4-mapped IPv6/私网/特殊地址拒绝，以及 Vercel HTTPS + 精确 provider host allowlist。
- `renderRich` 改为 parse5 解析后的标签/属性白名单，危险 URL 在 HTML entity 解码后检查；`javascript:`、事件属性、script 等攻击用例加入测试。
- 题库改为服务端筛选和 50 条分页；首页/导航列表链接关闭自动预取；详情页默认只生成最近 400 题、比赛页最近 80 场，历史页保留按需路由。
- PWA 默认只安装最小 shell；题库同步和约 139 MiB C++ runtime 改为设置页显式操作，加入停止/错误反馈。
- 翻译队列区分 CI 的 `ai` 存档和用户选择的 MT 渠道，选择 DeepL 等渠道时不再因已有存档而跳过任务；完成缓存会触发 UI 更新。
- runtime 下载固定到 commit `8ef570b6173f40071c4f5852a6424ac70bbe773c`，对 7 个文件校验 Git blob SHA-1，并采用临时目录/原子替换；Node 版本固定为 22.x。
- 新增 `npm test`、4 个安全/查询/翻译单测及 CI 测试步骤；本地 `npm test` 实测 4/4 通过；快速生产构建实测通过；完整生产构建实测生成 490 个静态页面并通过。

本轮完整构建基线为 **81.08 秒、最高 RSS 约 1.41 GiB、`.next` 约 828 MiB**，相较于原报告的 19,009 页/135 秒/约 3.8 GiB 产物明显下降。Vercel 函数追踪仍会为题目/比赛详情函数纳入约 76.5 MiB 数据文件；这已低于常见函数体积限制，但仍需在实际 Vercel Preview 上确认平台计划的具体上限和历史路由冷启动。题库 API 追踪约 3.8 MiB。

尚未声称完成的项目：真实 Node 22 clean install + 冷 runtime 下载、实际 Vercel Preview 部署、线上并发压测、完整 WCAG 审计、IDE 编译器全链路回归和 npm registry 恢复后的依赖漏洞扫描。 
