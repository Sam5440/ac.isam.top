import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const ALLOWED = new Set(['atcoder', 'codeforces', 'cf-gyms', 'nowcoder']);

/** 题面 PDF 直出：data/<platform>/pdf/<problemId>.pdf（题目详情页默认展示原件）。 */
export async function GET(_req, { params }) {
  const { platform, problemId } = await params;
  if (!ALLOWED.has(platform)) return new Response('not found', { status: 404 });
  const id = String(problemId).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!id) return new Response('not found', { status: 404 });
  const file = path.join(process.cwd(), 'data', platform, 'pdf', `${id}.pdf`);
  try {
    const buf = await fs.readFile(file);
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buf.length),
        'Content-Disposition': `inline; filename="${id}.pdf"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
