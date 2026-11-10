import { getProblemSummaries } from '@/lib/problem-index';
import { queryProblems } from '@/lib/problem-query.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  return Response.json(queryProblems(getProblemSummaries(), new URL(request.url).searchParams), {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
  });
}
