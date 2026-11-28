/**
 * 旧工作区目录迁移：把「一题一目录」合并成「一场比赛一个目录」。
 *
 * 2026-11-28 之前 `problemWorkspacePlan` 的目录名是
 * `<比赛id>-<比赛名>-<题目id>`（例如 `arc234-第-234-场-…-arc234_a`），
 * 于是一场 6 道题的比赛会留下 6 个目录。现在改成 `<比赛id>-<比赛名>`，
 * 但用户本地 IndexedDB 里的旧目录不会自己消失——这里做一次幂等迁移。
 *
 * 纯函数（无 IDB / DOM）：调用方读出记录、交给 `planFolderMerge` 拿计划，
 * 再按计划写入 / 删除。这样 node --test 能直接覆盖合并策略。
 */

const SEP = '-';

/**
 * 从旧目录名里剥离末尾的题目 id，得到新目录名。
 *
 * 旧名形如 `<contestId>-<title>-<problemId>`，而 problemId 通常以 contestId
 * 开头（arc234_a / 2289B / nc141882pb）。只认「以 `<contestId>-` 开头」的
 * 旧名，避免误伤用户自己建的普通目录。
 *
 * @param {string} folder 目录名（不含斜杠）
 * @param {{id?: string|number, title?: string, titleZh?: string}|null} contest
 * @returns {string|null} 新目录名；不是旧格式时返回 null
 */
export function legacyFolderTarget(folder, contest = null) {
  const name = String(folder ?? '').trim();
  const contestId = String(contest?.id ?? '').trim();
  if (!name || !contestId) return null;
  const head = `${contestId}${SEP}`;
  if (!name.startsWith(head)) return null;

  const title = String(contest?.titleZh || contest?.title || '').trim();
  if (title) {
    // 与 safeSegment 同口径清洗比赛名，才能和旧目录名对上
    const clean = title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (clean) {
      const anchor = `${head}${clean}${SEP}`;
      if (name.startsWith(anchor) && name.length > anchor.length) return `${head}${clean}`;
    }
  }
  // 没有比赛名可锚定：只在「最后一段看起来像题号/题目 id」时剥离
  const rest = name.slice(head.length);
  const cut = rest.lastIndexOf(SEP);
  if (cut <= 0) {
    // `<id>-<pid>`（比赛名为空）：整段就是题目 id 时，目录应只剩比赛 id
    if (/^[A-Za-z0-9_]+$/.test(rest) && rest !== contestId) return contestId;
    return null;
  }
  const tail = rest.slice(cut + 1);
  if (!/^[A-Za-z0-9_]+$/.test(tail)) return null;
  return `${head}${rest.slice(0, cut)}`;
}

/** 文件名冲突时插入 `-2`、`-3`…（保留扩展名）。 */
export function uniqueName(name, taken) {
  const s = String(name ?? '');
  const set = taken instanceof Set ? taken : new Set(taken ?? []);
  if (!set.has(s)) return s;
  const dot = s.lastIndexOf('.');
  const stem = dot > 0 ? s.slice(0, dot) : s;
  const ext = dot > 0 ? s.slice(dot) : '';
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * 计算合并计划。
 *
 * 语义：多个旧目录可以合并进同一个目标目录（比赛名相同），目标已存在的
 * 子目录直接复用；只有**文件**重名时才改名，绝不覆盖。
 *
 * @param {Array<{path:string,type?:string,content?:string}>} records
 * @param {Array<{folder:string,target:string}>} targets 旧目录 → 新目录
 * @returns {{
 *   moves: Array<{from:string,to:string}>,
 *   drops: string[],
 *   folders: string[],
 *   renames: Array<{from:string,to:string}>
 * }}
 *  - moves：文件改路径；
 *  - drops：迁移后应删除的旧记录（旧目录本身及其残留子目录）；
 *  - folders：需要确保存在的新目录（含各级父目录）；
 *  - renames：绑定清单等需要「读旧写新」的文件（moves 的子集，便于调用方处理）。
 */
export function planFolderMerge(records, targets) {
  const all = (records ?? []).filter((r) => r && typeof r.path === 'string');
  const map = new Map();
  for (const t of targets ?? []) {
    const from = String(t?.folder ?? '').replace(/\/+$/, '');
    const to = String(t?.target ?? '').replace(/\/+$/, '');
    if (!from || !to || from === to) continue;
    if (to === from || to.startsWith(`${from}/`)) continue; // 不能搬进自身
    map.set(from, to);
  }
  if (!map.size) return { moves: [], drops: [], folders: [], renames: [] };

  const prefixes = [...map.keys()].sort((a, b) => b.length - a.length);
  // 目标侧已占用的路径：不在任何旧目录下的记录（含新格式目录里的文件）
  const inside = (p) => prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`));
  const taken = new Set(all.filter((r) => !inside(r.path)).map((r) => r.path));
  const folders = new Set();
  const noteFolders = (path) => {
    const parts = String(path).split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
  };
  for (const t of map.values()) noteFolders(`${t}/x`);

  const moves = [];
  const renames = [];
  const drops = [];

  // 先处理文件（目录记录本身不需要搬，目标目录由 folders 保证存在）
  for (const rec of all) {
    const prefix = prefixes.find((p) => rec.path.startsWith(`${p}/`));
    if (!prefix) continue;
    if (rec.type === 'dir') continue;
    const rel = rec.path.slice(prefix.length + 1); // 相对旧目录
    const parts = rel.split('/');
    const name = parts.pop();
    const parent = parts.length ? `${map.get(prefix)}/${parts.join('/')}` : map.get(prefix);
    const candidate = `${parent}/${name}`;
    const finalName = taken.has(candidate) ? uniqueName(name, new Set([...taken].map((p) => p.split('/').pop()))) : name;
    const to = `${parent}/${finalName}`;
    taken.add(to);
    moves.push({ from: rec.path, to });
    noteFolders(to);
    if (finalName === 'workspace.json' || name === 'workspace.json') renames.push({ from: rec.path, to });
  }

  // 旧目录（及其子目录）记录：迁移后不再需要
  for (const rec of all) {
    if (rec.type !== 'dir') continue;
    if (!inside(rec.path)) continue;
    drops.push(rec.path);
  }

  return { moves, drops, folders: [...folders], renames };
}

export default { legacyFolderTarget, uniqueName, planFolderMerge };
