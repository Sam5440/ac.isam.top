import fs from 'node:fs';
import path from 'node:path';

/** 简易并发限制器（同 p-limit 语义）。 */
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const rnd = (min, max) => min + Math.random() * (max - min);

/** 读取 JSON，失败返回 null。 */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 原子写 JSON（tmp + rename），稳定字段顺序。 */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** 解析 --key value / --key=value 形式的命令行参数。 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (!a.startsWith('--')) continue;
    a = a.slice(2);
    let val = true;
    if (a.includes('=')) {
      [a, val] = a.split('=');
      val = coerce(val);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      val = coerce(argv[++i]);
    }
    args[a.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
  }
  return args;
}

function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/** 加载 .env.local / .env（不覆盖已存在的环境变量）。 */
export function loadEnv(cwd = process.cwd()) {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

export function log(tag, ...msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}]`, ...msg);
}
