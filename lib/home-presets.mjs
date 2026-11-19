export const HOME_PRESETS = [
  {
    id: 'classic',
    label: '经典题库',
    description: '保留原首页的站点介绍、题库统计、最新比赛和最近收录。',
    html: `<div class="space-y-12 pb-12">
  <ac-hero></ac-hero>
  <ac-stats></ac-stats>
  <ac-section title="最新比赛" href="/contests" more="全部比赛">
    <ac-contests kind="recent" limit="6"></ac-contests>
  </ac-section>
  <ac-section title="最近收录" href="/problems" more="进入题库">
    <ac-problems kind="recent" limit="10"></ac-problems>
  </ac-section>
</div>`,
  },
  {
    id: 'dashboard',
    label: '竞赛仪表盘',
    description: '天气、CF Rating、未来比赛与近期比赛一屏掌握。',
    html: `<div class="space-y-6 py-8">
  <ac-clock></ac-clock>
  <div class="grid gap-4 md:grid-cols-2">
    <ac-weather></ac-weather>
    <ac-cf-rating></ac-cf-rating>
  </div>
  <ac-stats></ac-stats>
  <div class="grid gap-6 lg:grid-cols-2">
    <ac-section title="即将开始"><ac-contests kind="upcoming" limit="5"></ac-contests></ac-section>
    <ac-section title="近期比赛"><ac-contests kind="recent" limit="5"></ac-contests></ac-section>
  </div>
</div>`,
  },
  {
    id: 'minimal',
    label: '极简导航',
    description: '只保留常用入口、四场比赛和最近编辑文件。',
    html: `<div class="mx-auto max-w-3xl space-y-8 py-12">
  <header>
    <h1 class="text-3xl font-bold tracking-tight">今天想做点什么？</h1>
    <p class="text-muted-foreground mt-2 text-sm">题、比赛和代码，都从这里继续。</p>
  </header>
  <nav class="flex flex-wrap gap-2">
    <a class="rounded-md border px-4 py-2 text-sm hover:bg-accent" href="/problems">浏览题库</a>
    <a class="rounded-md border px-4 py-2 text-sm hover:bg-accent" href="/contests">比赛列表</a>
    <a class="rounded-md border px-4 py-2 text-sm hover:bg-accent" href="/ide">打开 IDE</a>
    <a class="rounded-md border px-4 py-2 text-sm hover:bg-accent" href="/history">浏览历史</a>
  </nav>
  <ac-section title="近期比赛"><ac-contests kind="recent" limit="4" compact="true"></ac-contests></ac-section>
  <ac-section title="继续编辑"><ac-files limit="4"></ac-files></ac-section>
</div>`,
  },
  {
    id: 'upcoming',
    label: '备战下一场',
    description: '优先展示未来赛事，辅以最近比赛和题库统计。',
    html: `<div class="space-y-8 py-10">
  <header class="rounded-2xl border bg-card p-6">
    <p class="text-primary text-xs font-semibold tracking-widest">NEXT CONTEST</p>
    <h1 class="mt-2 text-3xl font-bold">为下一场比赛做好准备</h1>
    <p class="text-muted-foreground mt-2 text-sm">未来比赛按开始时间由近到远排列。</p>
  </header>
  <ac-section title="近期未来比赛" href="/calendar" more="打开日历">
    <ac-contests kind="upcoming" limit="10"></ac-contests>
  </ac-section>
  <div class="grid gap-6 lg:grid-cols-2">
    <ac-section title="刚结束的比赛"><ac-contests kind="recent" limit="4" compact="true"></ac-contests></ac-section>
    <ac-section title="最近做过的题"><ac-history kind="practiced" limit="4"></ac-history></ac-section>
  </div>
  <ac-stats></ac-stats>
</div>`,
  },
  {
    id: 'practice',
    label: '刷题回顾',
    description: '聚合最近做过的题、最近看过的题和相关比赛。',
    html: `<div class="space-y-8 py-10">
  <header><h1 class="text-3xl font-bold">刷题回顾</h1><p class="text-muted-foreground mt-2 text-sm">从上次停下的地方继续。</p></header>
  <div class="grid gap-6 lg:grid-cols-2">
    <ac-section title="最近做过的比赛"><ac-history-contests kind="practiced" limit="6"></ac-history-contests></ac-section>
    <ac-section title="最近看过的比赛"><ac-history-contests kind="viewed" limit="6"></ac-history-contests></ac-section>
  </div>
  <ac-section title="最近做过的题" href="/history" more="全部历史"><ac-history kind="practiced" limit="10"></ac-history></ac-section>
  <ac-section title="最近查看"><ac-history kind="viewed" limit="6" compact="true"></ac-history></ac-section>
</div>`,
  },
  {
    id: 'workspace',
    label: '我的工作区',
    description: 'IDE 文件、最近查看和待参加的赛事实用组合。',
    html: `<div class="space-y-6 py-8">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <ac-clock></ac-clock>
    <a class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm" href="/ide">进入 IDE</a>
  </div>
  <div class="grid gap-6 lg:grid-cols-2">
    <ac-section title="最近编辑的文件"><ac-files limit="8"></ac-files></ac-section>
    <ac-section title="最近查看的题目"><ac-history kind="viewed" limit="8"></ac-history></ac-section>
  </div>
  <ac-section title="下一场比赛"><ac-contests kind="upcoming" limit="3"></ac-contests></ac-section>
</div>`,
  },
  {
    id: 'data',
    label: '数据观测站',
    description: '聚焦最近拉取的比赛、题目和题库数据更新时间。',
    html: `<div class="space-y-8 py-10">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div><h1 class="text-3xl font-bold">数据观测站</h1><p class="text-muted-foreground mt-1 text-sm">看看题库最近拉到了什么。</p></div>
    <ac-site-update></ac-site-update>
  </div>
  <ac-stats></ac-stats>
  <ac-section title="最近拉取的比赛" href="/ci" more="抓取日志"><ac-contests kind="fetched" limit="8"></ac-contests></ac-section>
  <ac-section title="最近拉取的题目"><ac-problems kind="fetched" limit="12"></ac-problems></ac-section>
</div>`,
  },
  {
    id: 'panorama',
    label: '双栏全景',
    description: '比赛、天气、Rating、刷题记录与文件的双栏总览。',
    html: `<div class="space-y-8 py-8">
  <ac-hero compact="true"></ac-hero>
  <div class="grid gap-6 lg:grid-cols-2">
    <div class="space-y-6">
      <ac-section title="即将开始"><ac-contests kind="upcoming" limit="5" compact="true"></ac-contests></ac-section>
      <ac-section title="近期比赛"><ac-contests kind="recent" limit="5" compact="true"></ac-contests></ac-section>
      <ac-section title="最近拉取"><ac-problems kind="fetched" limit="5"></ac-problems></ac-section>
    </div>
    <div class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2"><ac-weather></ac-weather><ac-cf-rating></ac-cf-rating></div>
      <ac-section title="最近做过"><ac-history kind="practiced" limit="5"></ac-history></ac-section>
      <ac-section title="最近编辑"><ac-files limit="5"></ac-files></ac-section>
    </div>
  </div>
</div>`,
  },
  {
    id: 'focus',
    label: '安静专注',
    description: '实时问候、下一场比赛与最近练习，减少信息干扰。',
    html: `<div class="mx-auto max-w-3xl space-y-10 py-14">
  <ac-clock name="朋友"></ac-clock>
  <blockquote class="border-l-2 pl-4 text-muted-foreground">不着急，把眼前这一题想清楚。</blockquote>
  <ac-section title="接下来"><ac-contests kind="upcoming" limit="3" compact="true"></ac-contests></ac-section>
  <ac-section title="上次练习"><ac-history kind="practiced" limit="3"></ac-history></ac-section>
  <a class="text-primary text-sm underline underline-offset-4" href="/problems">找一道题开始 →</a>
</div>`,
  },
  {
    id: 'compact',
    label: '紧凑速览',
    description: '窄屏也易读的紧凑列表，覆盖最常用的五类信息。',
    html: `<div class="space-y-5 py-6">
  <div class="flex flex-wrap items-center justify-between gap-3"><ac-clock compact="true"></ac-clock><ac-site-update></ac-site-update></div>
  <div class="grid gap-4 sm:grid-cols-2"><ac-weather compact="true"></ac-weather><ac-cf-rating></ac-cf-rating></div>
  <ac-section title="未来比赛"><ac-contests kind="upcoming" limit="4" compact="true"></ac-contests></ac-section>
  <ac-section title="最近比赛"><ac-contests kind="recent" limit="4" compact="true"></ac-contests></ac-section>
  <ac-section title="最近做过"><ac-history kind="practiced" limit="4" compact="true"></ac-history></ac-section>
  <ac-section title="最近文件"><ac-files limit="4"></ac-files></ac-section>
</div>`,
  },
  {
    id: 'codeforces',
    label: 'CF 选手中心',
    description: 'Codeforces Rating、CF 未来赛事、近期比赛和练习记录。',
    html: `<div class="space-y-8 py-10">
  <header><p class="text-primary text-sm font-medium">CODEFORCES</p><h1 class="mt-1 text-3xl font-bold">CF 选手中心</h1></header>
  <div class="grid gap-4 md:grid-cols-2"><ac-cf-rating></ac-cf-rating><ac-clock></ac-clock></div>
  <ac-section title="CF 未来比赛"><ac-contests kind="upcoming" platform="codeforces" limit="6"></ac-contests></ac-section>
  <ac-section title="CF 近期比赛"><ac-contests kind="recent" platform="codeforces" limit="6"></ac-contests></ac-section>
  <ac-section title="最近练习"><ac-history kind="practiced" platform="codeforces" limit="8"></ac-history></ac-section>
</div>`,
  },
  {
    id: 'discovery',
    label: '新题雷达',
    description: '最近收录与最近拉取并排，适合发现新内容。',
    html: `<div class="space-y-8 py-10">
  <header class="flex flex-wrap items-end justify-between gap-3"><div><h1 class="text-3xl font-bold">新题雷达</h1><p class="text-muted-foreground mt-2 text-sm">按比赛时间与实际拉取时间发现新题。</p></div><ac-site-update></ac-site-update></header>
  <div class="grid gap-6 lg:grid-cols-2">
    <ac-section title="最近收录"><ac-problems kind="recent" limit="10"></ac-problems></ac-section>
    <ac-section title="最近拉取"><ac-problems kind="fetched" limit="10"></ac-problems></ac-section>
  </div>
  <ac-section title="最近拉取的比赛"><ac-contests kind="fetched" limit="6" compact="true"></ac-contests></ac-section>
</div>`,
  },
];

export const DEFAULT_HOME_LAYOUT = HOME_PRESETS[0].html;

export const VISUAL_HOME_PRESETS = [
  {
    id: 'visual-classic', label: '经典四宫格', device: '手机 / 电脑',
    description: '介绍、统计、6 场近期比赛和 8 道新题，信息均衡。',
    widgets: [
      { id: 'hero', type: 'hero', w: 2, h: 2 },
      { id: 'stats', type: 'stats', w: 2, h: 2 },
      { id: 'contests', type: 'contests', w: 2, h: 4, params: { kind: 'recent', limit: 6 } },
      { id: 'problems', type: 'problems', w: 2, h: 5, params: { kind: 'recent', limit: 8 } },
    ],
  },
  {
    id: 'visual-contest', label: '赛事驾驶舱', device: '电脑优先',
    description: '时钟与天气置顶，未来赛和近期赛双栏对照。',
    widgets: [
      { id: 'clock', type: 'clock', w: 2, h: 2 },
      { id: 'weather', type: 'weather', w: 2, h: 2 },
      { id: 'upcoming', type: 'contests', w: 2, h: 5, params: { kind: 'upcoming', limit: 6 } },
      { id: 'recent', type: 'contests', w: 2, h: 4, params: { kind: 'recent', limit: 5 } },
      { id: 'stats', type: 'stats', w: 4, h: 2 },
    ],
  },
  {
    id: 'visual-mobile', label: '轻量速览', device: '手机优先',
    description: '只保留更新时间、3 场未来赛和 4 道新题，单手浏览。',
    widgets: [
      { id: 'update', type: 'site-update', w: 2, h: 1 },
      { id: 'upcoming', type: 'contests', w: 2, h: 3, params: { kind: 'upcoming', limit: 3 } },
      { id: 'problems', type: 'problems', w: 2, h: 4, params: { kind: 'recent', limit: 4 } },
      { id: 'clock', type: 'clock', w: 2, h: 2 },
    ],
  },
  {
    id: 'visual-practice', label: '刷题回顾', device: '手机 / 电脑',
    description: '做过与看过的题目并列，附比赛记录和最近文件。',
    widgets: [
      { id: 'clock', type: 'clock', w: 2, h: 2 },
      { id: 'stats', type: 'stats', w: 2, h: 2 },
      { id: 'practiced', type: 'history', w: 2, h: 4, params: { kind: 'practiced', limit: 6 } },
      { id: 'viewed', type: 'history', w: 2, h: 4, params: { kind: 'viewed', limit: 6 } },
      { id: 'contests', type: 'history-contests', w: 2, h: 3, params: { kind: 'practiced', limit: 4 } },
      { id: 'files', type: 'files', w: 2, h: 3, params: { limit: 4 } },
    ],
  },
  {
    id: 'visual-workspace', label: '我的工作区', device: '电脑优先',
    description: '8 个最近文件、6 道看过题目与下一场比赛。',
    widgets: [
      { id: 'clock', type: 'clock', w: 2, h: 2 },
      { id: 'update', type: 'site-update', w: 2, h: 1 },
      { id: 'files', type: 'files', w: 2, h: 5, params: { limit: 8 } },
      { id: 'history', type: 'history', w: 2, h: 4, params: { kind: 'viewed', limit: 6 } },
      { id: 'upcoming', type: 'contests', w: 4, h: 4, params: { kind: 'upcoming', limit: 4 } },
    ],
  },
  {
    id: 'visual-data', label: '数据观测站', device: '电脑优先',
    description: '集中查看抓取动态、最近题目与题库统计。',
    widgets: [
      { id: 'stats', type: 'stats', w: 4, h: 2 },
      { id: 'update', type: 'site-update', w: 2, h: 1 },
      { id: 'fetched-contests', type: 'contests', w: 2, h: 4, params: { kind: 'fetched', limit: 6 } },
      { id: 'fetched-problems', type: 'problems', w: 2, h: 6, params: { kind: 'fetched', limit: 10 } },
      { id: 'recent-problems', type: 'problems', w: 2, h: 5, params: { kind: 'recent', limit: 8 } },
    ],
  },
  {
    id: 'visual-codeforces', label: 'CF 选手中心', device: '手机 / 电脑',
    description: 'Rating、CF 赛程和 CF 练习记录一屏聚合。',
    widgets: [
      { id: 'rating', type: 'cf-rating', w: 2, h: 2 },
      { id: 'clock', type: 'clock', w: 2, h: 2 },
      { id: 'upcoming', type: 'contests', w: 2, h: 4, params: { kind: 'upcoming', platform: 'codeforces', limit: 5 } },
      { id: 'recent', type: 'contests', w: 2, h: 4, params: { kind: 'recent', platform: 'codeforces', limit: 5 } },
      { id: 'history', type: 'history', w: 4, h: 4, params: { kind: 'practiced', platform: 'codeforces', limit: 8 } },
    ],
  },
  {
    id: 'visual-discovery', label: '新题雷达', device: '电脑优先',
    description: '最近收录与最近抓取各 8 道，底部补充抓取比赛。',
    widgets: [
      { id: 'hero', type: 'hero', w: 2, h: 2 },
      { id: 'stats', type: 'stats', w: 2, h: 2 },
      { id: 'recent', type: 'problems', w: 2, h: 5, params: { kind: 'recent', limit: 8 } },
      { id: 'fetched', type: 'problems', w: 2, h: 5, params: { kind: 'fetched', limit: 8 } },
      { id: 'contests', type: 'contests', w: 4, h: 3, params: { kind: 'fetched', limit: 4 } },
    ],
  },
  {
    id: 'visual-focus', label: '安静专注', device: '手机优先',
    description: '3 场未来赛、3 道练习和 3 个文件，减少干扰。',
    widgets: [
      { id: 'clock', type: 'clock', w: 2, h: 2, params: { name: '朋友' } },
      { id: 'upcoming', type: 'contests', w: 2, h: 3, params: { kind: 'upcoming', limit: 3 } },
      { id: 'history', type: 'history', w: 2, h: 3, params: { kind: 'practiced', limit: 3 } },
      { id: 'files', type: 'files', w: 2, h: 3, params: { limit: 3 } },
    ],
  },
  {
    id: 'visual-panorama', label: '全景总览', device: '电脑优先',
    description: '天气、Rating、比赛、练习与文件的完整工作台。',
    widgets: [
      { id: 'hero', type: 'hero', w: 4, h: 2 },
      { id: 'weather', type: 'weather', w: 2, h: 2 },
      { id: 'rating', type: 'cf-rating', w: 2, h: 2 },
      { id: 'upcoming', type: 'contests', w: 2, h: 4, params: { kind: 'upcoming', limit: 5 } },
      { id: 'recent', type: 'contests', w: 2, h: 4, params: { kind: 'recent', limit: 5 } },
      { id: 'history', type: 'history', w: 2, h: 3, params: { kind: 'practiced', limit: 4 } },
      { id: 'files', type: 'files', w: 2, h: 3, params: { limit: 4 } },
      { id: 'stats', type: 'stats', w: 4, h: 2 },
    ],
  },
];
