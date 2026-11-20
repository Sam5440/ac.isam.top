const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function normalizeUsage(raw) {
  const input = count(raw?.prompt_tokens ?? raw?.input_tokens);
  const output = count(raw?.completion_tokens ?? raw?.output_tokens);
  const cached = count(raw?.prompt_tokens_details?.cached_tokens ?? raw?.input_tokens_details?.cached_tokens ?? raw?.prompt_cache_hit_tokens);
  const total = count(raw?.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  return { input, output, cached, total };
}

export function cacheRate({ input, cached }) {
  return input > 0 && cached != null && cached >= 0 && cached <= input ? `${(100 * cached / input).toFixed(1)}%` : '未知';
}
