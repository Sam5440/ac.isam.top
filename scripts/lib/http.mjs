import { log, sleep } from './util.mjs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 带重试的文本/JSON 抓取。4xx（除 429）为确定性失败不重试（审查 管线-13）。 */
export async function httpGet(url, { retries = 3, timeout = 30000, headers = {}, json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html', ...headers },
        signal: ctl.signal,
        redirect: 'follow',
      });
      if (!res.ok) {
        // 404/403 等重试也是同样结果,只烧等待时间;429 是限流,退避后有意义
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw Object.assign(new Error(`HTTP ${res.status}`), { noRetry: true });
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = json ? await res.json() : await res.text();
      return body;
    } catch (e) {
      lastErr = e;
      clearTimeout(timer);
      if (e?.noRetry) throw e;
      if (attempt < retries) {
        const wait = 2000 * (attempt + 1) + Math.random() * 1000;
        log('http', `retry ${attempt + 1}/${retries} ${url.slice(0, 80)} — ${e.message}`);
        await sleep(wait);
      }
    } finally {
      // 异常路径也清定时器(旧实现 clearTimeout 只在成功路径执行)
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
