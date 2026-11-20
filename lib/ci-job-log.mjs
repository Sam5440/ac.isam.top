// Keep unmatched output and its order: Actions commands can span multiple lines.
export function parseJobLog(text) {
  let group = '', scope = '';
  const rows = [], calls = [], groups = new Set(), scopes = new Set();
  for (const raw of text.replace(/^\uFEFF/, '').replace(/\x1b\[[\d;]*m/g, '').split(/\r?\n/)) {
    const message = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, '');
    if (message.startsWith('##[group]')) { group = message.slice(9); scope = ''; }
    const tag = /^\[\d\d:\d\d:\d\d\] \[([^\]]+)\] /.exec(message);
    if (tag) scope = tag[1];
    if (group) groups.add(group);
    if (scope) scopes.add(scope);
    const level = /##\[error\]|✗/.test(message) ? '错误' : /##\[warning\]|⚠/.test(message) ? '警告' : '输出';
    rows.push({ raw, group, scope, level });
    if (tag?.[1] === 'ai-usage') {
      try {
        const c = JSON.parse(message.slice(tag[0].length));
        if (typeof c.task === 'string' && typeof c.at === 'string' && typeof c.target === 'string' &&
          [c.input, c.output, c.total, c.cached, c.attempt, c.httpStatus].every((v) => v == null || Number.isSafeInteger(v))) calls.push(c);
      } catch { /* Interrupted JSON is still visible as raw output. */ }
    }
    if (message.startsWith('##[endgroup]')) { group = ''; scope = ''; }
  }
  return { rows, calls, groups: [...groups], scopes: [...scopes] };
}
