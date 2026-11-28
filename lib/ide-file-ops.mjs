const cleanPath = (value) => {
  const path = String(value ?? '').replace(/^\/+|\/+$/g, '').trim();
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return path;
};

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

function copyName(name, index, isFile) {
  const suffix = index === 1 ? ' copy' : ` copy ${index}`;
  if (!isFile) return `${name}${suffix}`;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

export function normalizeIdeSelection(selected = []) {
  const unique = new Map();
  for (const item of Array.isArray(selected) ? selected : []) {
    const path = cleanPath(item?.path);
    const type = item?.type === 'folder' ? 'dir' : item?.type;
    if (!path || !['file', 'dir'].includes(type)) continue;
    if (type === 'dir' || !unique.has(path)) unique.set(path, { path, type });
  }
  const dirs = [...unique.values()].filter((item) => item.type === 'dir').map((item) => item.path);
  return [...unique.values()].filter((item) => !dirs.some((dir) => item.path !== dir && item.path.startsWith(`${dir}/`)));
}

export function planIdeFileTransfer({ records = [], selected = [], destination = '', mode = 'copy', copyRecords = [], now = Date.now() } = {}) {
  if (!['copy', 'cut'].includes(mode)) throw new Error('不支持的文件操作');
  const targetDir = cleanPath(destination);
  if (destination && !targetDir) throw new Error('目标文件夹路径无效');

  const current = new Map((Array.isArray(records) ? records : []).filter((item) => cleanPath(item?.path)).map((item) => [item.path, item]));
  const copied = new Map((Array.isArray(copyRecords) ? copyRecords : []).filter((item) => cleanPath(item?.path)).map((item) => [item.path, item]));
  const directories = new Set([...current.values()].filter((item) => item.type === 'dir').map((item) => item.path));
  for (const item of current.values()) {
    let parent = parentOf(item.path);
    while (parent) {
      directories.add(parent);
      parent = parentOf(parent);
    }
  }
  const roots = normalizeIdeSelection(selected).map((item) => ({ ...item, originalPath: item.path }));
  if (!roots.length) throw new Error('请先选择文件或文件夹');

  const source = mode === 'copy' ? copied : current;
  const sources = [];
  for (const root of roots) {
    const entries = [...source.values()].filter((item) => item.path === root.path || (root.type === 'dir' && item.path.startsWith(`${root.path}/`)));
    if (root.type === 'file') {
      const file = entries.find((item) => item.type !== 'dir');
      if (!file) throw new Error(`文件不存在：${root.path}`);
      sources.push({ root, entries: [file] });
    } else {
      if (!entries.some((item) => item.path === root.path && item.type === 'dir')) {
        entries.push({ path: root.path, name: basename(root.path), type: 'dir', createdAt: now, updatedAt: now });
      }
      if (!entries.some((item) => item.path === root.path || item.path.startsWith(`${root.path}/`))) {
        throw new Error(`文件夹不存在：${root.path}`);
      }
      sources.push({ root, entries });
    }
  }

  for (const { root } of sources) {
    if (root.type === 'dir' && (targetDir === root.path || targetDir.startsWith(`${root.path}/`))) {
      throw new Error('不能将文件夹粘贴到自身或其子文件夹中');
    }
  }
  if (targetDir && !directories.has(targetDir)) throw new Error(`目标文件夹不存在：${targetDir}`);

  const removed = new Set();
  if (mode === 'cut') {
    for (const { root, entries } of sources) {
      for (const entry of entries) removed.add(entry.path);
      if (root.type === 'dir') removed.add(root.path);
    }
  }

  const occupied = new Set([...current.keys(), ...directories]);
  const taken = new Set([...occupied].filter((path) => !removed.has(path)));
  const pathMap = new Map();
  const puts = [];
  const dels = [];
  const fileMap = new Map();

  for (const { root, entries } of sources) {
    const name = basename(root.originalPath);
    let target = join(targetDir, name);
    if (mode === 'cut' && target === root.originalPath) continue;
    const collides = (candidate) => entries.some((entry) => taken.has(candidate + entry.path.slice(root.originalPath.length)));
    if (collides(target)) {
      const isFile = root.type === 'file';
      let suffix = 1;
      do {
        suffix += 1;
        target = join(targetDir, copyName(name, suffix - 1, isFile));
      } while (collides(target));
    }
    taken.add(target);
    pathMap.set(root.path, target);

    for (const entry of entries) {
      const nextPath = target + entry.path.slice(root.originalPath.length);
      taken.add(nextPath);
      pathMap.set(entry.path, nextPath);
      if (entry.type !== 'dir') fileMap.set(entry.path, nextPath);
      const next = { ...entry, path: nextPath, name: basename(nextPath), updatedAt: now };
      puts.push(next);
      if (mode === 'cut') dels.push(entry.path);
    }
    if (root.type === 'dir' && !entries.some((entry) => entry.path === root.path)) {
      puts.push({ path: target, name: basename(target), type: 'dir', createdAt: now, updatedAt: now });
    }
  }

  if (!puts.length) return { puts: [], dels: [], pathMap, fileMap: new Map(), moved: 0 };

  const neededParents = new Set();
  for (const entry of puts) {
    let parent = parentOf(entry.path);
    while (parent) {
      neededParents.add(parent);
      parent = parentOf(parent);
    }
  }
  for (const parent of neededParents) {
    if (!taken.has(parent)) {
      taken.add(parent);
      puts.push({ path: parent, name: basename(parent), type: 'dir', createdAt: now, updatedAt: now });
    }
  }

  return {
    puts,
    dels: [...new Set(dels.filter((path) => !pathMap.has(path) || pathMap.get(path) !== path))],
    pathMap,
    fileMap,
    moved: pathMap.size,
  };
}

export function planIdeDeletion(records = [], selected = []) {
  const roots = normalizeIdeSelection(selected);
  const removed = [...new Set((Array.isArray(records) ? records : [])
    .filter((entry) => roots.some(({ path, type }) => entry.path === path || (type === 'dir' && entry.path.startsWith(`${path}/`))))
    .map((entry) => entry.path))];
  return {
    paths: removed,
    files: removed.filter((path) => records.some((entry) => entry.path === path && entry.type !== 'dir')),
    folders: removed.filter((path) => records.some((entry) => entry.path === path && entry.type === 'dir')),
  };
}

export function transferIdeMap(map = {}, pathMap = new Map(), mode = 'copy') {
  const next = { ...map };
  if (mode === 'cut') {
    for (const source of pathMap.keys()) delete next[source];
  }
  for (const [source, target] of pathMap) {
    if (source in map) next[target] = map[source];
  }
  return next;
}
