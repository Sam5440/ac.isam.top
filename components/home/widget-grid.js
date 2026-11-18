'use client';

import { useSyncExternalStore } from 'react';

const breakpoints = ['(min-width: 640px)', '(min-width: 1024px)'];
function subscribe(notify) {
  const queries = breakpoints.map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener('change', notify));
  return () => queries.forEach((query) => query.removeEventListener('change', notify));
}
export function useGridColumns() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(breakpoints[1]).matches ? 4 : window.matchMedia(breakpoints[0]).matches ? 2 : 1, () => 4);
}
export function gridStyle(columns) {
  return { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
}
export function cellStyle({ col, row, w, h }) {
  return { gridColumn: `${col + 1} / span ${w}`, gridRow: `${row + 1} / span ${h}` };
}
