/** 站点更新日志 —— 设置弹窗「更新日志」区块的单一事实来源。 */

export const CHANGELOG = [
  {
    version: '1.1',
    date: '2026-10-31',
    title: '设置 · 翻译 · 在线 IDE · 比赛筛选',
    changes: [
      '设置弹窗上线：默认题面语言（对照/英文/中文）、对照翻译优先级、侧栏渠道开关、译文样式（字号/颜色/加粗/斜体/下划线）、AI（用户自定义翻译）与更新日志。',
      '题面翻译升级为逐段对照：CI 存档 AI 译文 + 本机实时四渠道机器翻译（DeepL/有道/彩云/讯飞，IndexedDB 缓存）+ AI 外置接口，段落尾部标注来源。',
      '在线 IDE：C++（Clang/LLVM 22 WASM）与 Python（Pyodide），样例对拍 / 交互运行 / 编译检查，代码草稿按题按语言自动保存。',
      '比赛支持按类型筛选（AtCoder ABC/ARC/AGC，Codeforces Div. 1–4 / Div. 1+2），设置里可选择首页展示的比赛类型。',
      '比赛详情页支持题目间快速切换：顶部切换条 + 侧栏题目列表；设置里可将题目页切换为整页模式。',
    ],
  },
  {
    version: '1.0',
    date: '2026-10-30',
    title: '题库上线',
    changes: [
      'AtCoder (ABC) 与 Codeforces 比赛题目自动抓取，AI 中文翻译（gpt-6.1-sol）。',
      '题库浏览 / 比赛列表 / 题目详情页，公式与代码块渲染，难度分级与标签。',
      'GitHub Actions 定时拉取最新比赛并回填历史题面，Vercel 自动部署。',
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
