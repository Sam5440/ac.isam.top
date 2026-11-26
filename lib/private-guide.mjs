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

## 提交
只提交 data/private/ 下的密文与索引：
  git add data/private
  git commit -m "feat(private): 新增 <label>（加密入库）"
不要提交明文 JSON、原始 HTML、密码或任何中间产物。
`;

export const PRIVATE_USAGE = `# 1) 生成密文（本地，密码不会上传）
node scripts/private-vault.mjs pack --from-html book.html \\
  --id my-contest --label "我的比赛 · 正式赛" --title "我的比赛"

# 2) 查看已入库的场次与体积
node scripts/private-vault.mjs list

# 3) 校验（带密码可验证能否解密）
node scripts/private-vault.mjs verify ${PASSWORD_FLAG} '<密码>'

# 4) 只提交密文
git add data/private && git commit -m "feat(private): 新增 <label>"
`;

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
