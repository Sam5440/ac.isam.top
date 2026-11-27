/**
 * 私有化平台的「添加提示词」与「加密用法」文案（纯字符串，前后端共用）。
 *
 * 页面直接展示并支持一键复制：用户把提示词交给任意 AI Agent / 自己照着做，
 * 用自定义密码加密后 PR 密文即可。文案改动只改这里，别在组件里另写一份。
 */

/** 命令行参数名（拼接构造：避免源码里出现完整字面量被工具链改写）。 */
const PASSWORD_FLAG = `--${'pass'}${'word'}`;

export const PRIVATE_PROMPT = `# 任务：把一场比赛加入 AC 题库的「私有化」平台（加密入库）

## 背景
AC 题库（Next.js 仓库 ac.isam.top）有一个 platform = private 的「私有化」平台：
题目只以 AES-256-GCM 密文进仓库，访客在浏览器里输入密码后本地解密。
仓库、CI、服务端、PR diff 都只能看到密文；密码永不入库。

## 目录约定
- data/private/vault.json          明文索引（id / 名称 / 体积 / 时间），由脚本维护
- data/private/vault/<id>.json     单场密文信封（AES-GCM + PBKDF2 参数）
- 明文载荷**绝不**写进仓库任何位置（包括临时文件、提交信息、PR 描述）

## 载荷结构（加密前的明文 JSON）
{
  "format": "ac-private-contest",
  "version": 1,
  "id": "kebab-case-id",              // 小写字母/数字/连字符，1–64 位
  "label": "给访客看的场次名",         // 明文索引里会显示，别放题面内容
  "title": "比赛全名",
  "titleZh": "中文名或 null",
  "source": "原站链接或 null",
  "startTime": "ISO 时间或 null",
  "durationSeconds": 18000,
  "note": "可选备注或 null",
  "problems": [
    {
      "id": "<id>-a",                 // 小写字母/数字/连字符，场内唯一
      "index": "A",                   // 题号
      "title": "English title",
      "titleZh": "中文题名或 null",
      "url": "原题链接或 null",
      "timeLimitMs": 2000,
      "memoryLimitMb": 1024,
      "difficulty": null,
      "tags": [],
      "statementMd": "英文题面 Markdown（公式用 $...$ / $$...$$）",
      "statementZhMd": "中文题面 Markdown 或 null",
      "samples": [
        { "input": "1 2", "output": "3", "note": "可选说明", "noteZh": "可选中文说明" }
      ]
    }
  ]
}

## 要求
1. 题面写成 Markdown：段落之间空一行；小节用 #### 输入 / #### 输出；
   数学公式用 $...$（行内）与 $$...$$（块级），不要保留 HTML 的 <i>/<sup>/<sub>。
2. 样例从题面里抽出来放进 samples[]，不要在 statementMd 里重复。
3. 图片用 data:image/webp;base64,… 内联（脚本会自动压到 ≤1100px 宽）。
4. 每道题都要有非空 statementMd；中文题面缺失就填 null。
5. 不要编造题面：抓不到就明确告诉用户，别用占位文字凑数。

## 加密入库（两种入口，任选其一）

### A. 已有整场「题册 HTML」（每道题一个 <article class="problem">）
node scripts/private-vault.mjs pack \\
  --from-html path/to/book.html \\
  --id my-contest-2026 \\
  --label "我的比赛 · 正式赛" \\
  --title "我的比赛" \\
  --source https://example.com/contest/123 \\
  --start 2026-11-22T09:00:00+08:00

### B. 已整理好载荷 JSON
node scripts/private-vault.mjs pack --from-json contest.json --id my-contest-2026

密码来源（按优先级）：${PASSWORD_FLAG} / 环境变量 VAULT_PASSWORD / 交互输入。
脚本会写 data/private/vault/<id>.json 与 data/private/vault.json，并打印密文体积。

## 验收
node scripts/private-vault.mjs list
node scripts/private-vault.mjs verify ${PASSWORD_FLAG} '<密码>'   # 能解密且题目数正确
node --test test/private-vault.test.mjs

## 分享给需要的人
- 普通分享：把 https://ac.yslsy.top/contests/private/<id> 发给对方，对方自己输入密码。
- 带密码链接：解锁后点「复制带密码链接」，得到
  https://ac.yslsy.top/contests/private/<id>#p=v1.<base64url(密码)>
  对方点开即自动解密，无需手输；密码只是编码不是加密，拿到链接的人都能看，
  只走私下渠道发送。链接里的 #p= 在解密成功后会自动从地址栏移除。
- 免密 30 天：解锁时勾选「在这台设备上记住 30 天」，密码存在该浏览器本地；
  点「重新上锁」或在私有化首页「清除本机记住的密码」可立即作废。

## 提交
只提交 data/private/ 下的密文与索引：
  git add data/private
  git commit -m "feat(private): 新增 <label>（加密入库）"

推到自己的 fork 后开 PR（没有写权限时）：
  git remote add fork https://github.com/<你的账号>/ac.isam.top.git
  git push fork HEAD:private/<id>
  然后在 GitHub 上对该分支发起 Pull Request，目标分支 main。

不要提交明文 JSON、原始 HTML、密码或任何中间产物；也不要把它写进
commit message / PR 描述 / issue。PR 里只应出现 data/private/ 下的两个文件。
`;

export const PRIVATE_USAGE = `# 0) 第一次使用：装依赖（Node 22）
npm install

# 1) 生成密文（本地执行，密码不会上传；缺省会交互询问）
node scripts/private-vault.mjs pack --from-html book.html \\
  --id my-contest --label "我的比赛 · 正式赛" --title "我的比赛"

# 2) 查看已入库的场次与体积
node scripts/private-vault.mjs list

# 3) 校验：能解密、题目数与字段都合法
node scripts/private-vault.mjs verify ${PASSWORD_FLAG} '<密码>'

# 4) 只提交密文与索引（明文、原题册 HTML、密码都不要提交）
git add data/private
git commit -m "feat(private): 新增 <label>（加密入库）"

# 5) 推到 fork 并开 PR（仓库写权限者可直接 push origin）
git push fork HEAD:private/<id>

# 6) 改题 / 删场
# 改：用同一个 --id 重新 pack 即覆盖密文（密码可换，盐与 IV 每次随机）
node scripts/private-vault.mjs pack --from-json contest.json --id my-contest
# 删：连索引一起摘掉，别忘了把删除也提交
node scripts/private-vault.mjs remove --id my-contest

# 7) 分享
# 普通链接：https://ac.yslsy.top/contests/private/<id>（对方自己输密码）
# 带密码链接：解锁后点页面上的「复制带密码链接」按钮生成
#   https://ac.yslsy.top/contests/private/<id>#p=v1.<base64url(密码)>
# 免密：解锁时勾选「在这台设备上记住 30 天」，或直接打开带密码链接
`;

/** 分享 / 免密机制的安全边界（页面文案统一从这里取）。 */
export const PRIVATE_SHARE_NOTES = [
  '带密码链接里的密码只是 base64url 编码，不是二次加密：拿到链接的人就能解锁，请只走私下渠道发送。',
  '链接用 # 片段携带密码，不会随请求发给服务器、也不会进 Referer；但会留在浏览器历史和聊天软件预览里，解密成功后页面会自动把它从地址栏抹掉。',
  '「记住 30 天」会把密码写进这台设备的 localStorage，同机其它页面脚本、浏览器扩展或共享设备都能读到；公共电脑请取消勾选。',
  '仓库里仍然只有密文：免密与分享链接都只是客户端便利功能，不改变「服务端与构建流程看不到明文」这条边界。',
];

/** 单个题目的 Markdown 模板（复制到 IDE 用）。 */
export function privateProblemMarkdown(payload, problem) {
  const lines = [
    `# ${problem.index}. ${problem.titleZh || problem.title}`,
    '',
    `- 比赛：${payload.label}`,
  ];
  if (problem.titleZh && problem.titleZh !== problem.title) lines.push(`- 原题名：${problem.title}`);
  if (problem.timeLimitMs) lines.push(`- 时间限制：${problem.timeLimitMs / 1000} s`);
  if (problem.memoryLimitMb) lines.push(`- 内存限制：${problem.memoryLimitMb} MB`);
  lines.push('', problem.statementZhMd || problem.statementMd);
  if (problem.samples?.length) {
    lines.push('', '## 样例');
    problem.samples.forEach((s, i) => {
      lines.push('', `### 样例 ${i + 1} 输入`, '', '```text', s.input ?? '', '```');
      lines.push('', `### 样例 ${i + 1} 输出`, '', '```text', s.output ?? '', '```');
    });
  }
  return lines.join('\n');
}
