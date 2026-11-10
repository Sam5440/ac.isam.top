import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'index.json');
let cached = null;

export function getIndexData() {
  try {
    const stat = fs.statSync(FILE);
    const version = `${stat.mtimeMs}:${stat.size}`;
    if (cached?.version === version) return cached.value;
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cached = { version, value };
    return value;
  } catch {
    cached = null;
    return null;
  }
}

export function getProblemSummaries() {
  return getIndexData()?.problems ?? [];
}
