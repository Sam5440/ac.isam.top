import fs from 'node:fs';
import path from 'node:path';
import { queryClistSnapshot } from '../../../../lib/clist-snapshot.mjs';

export const dynamic = 'force-dynamic';

const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'clist.json');
let snapshot;

function getSnapshot() {
  if (snapshot !== undefined) return snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    snapshot = null;
  }
  return snapshot;
}

export function GET(request) {
  const data = getSnapshot();
  if (!data) return Response.json({ error: '比赛日程快照尚未生成，请等待 CI 更新' }, { status: 503 });
  const body = queryClistSnapshot(data, new URL(request.url).searchParams);
  return Response.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache': 'snapshot',
      'X-Clist-Fetched-At': data.fetchedAt || '',
    },
  });
}
