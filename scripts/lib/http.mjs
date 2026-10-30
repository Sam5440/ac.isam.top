import { log, sleep } from './util.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 带重试的文本/JSON 抓取。 */
export async function httpGet(url, { retries = 3, timeout = 30000, headers = {}, json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html', ...headers },
        signal: ctl.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = json ? await res.json() : await res.text();
      return body;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const wait = 2000 * (attempt + 1) + Math.random() * 1000;
        log('http', `retry ${attempt + 1}/${retries} ${url.slice(0, 80)} — ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}
