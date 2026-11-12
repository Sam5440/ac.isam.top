#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cf-gyms 抓取控制台（单文件，仅标准库）。

作用
----
1. 按「开赛时间倒序」（最近的场次优先）持续抓取 Codeforces gyms 题面；
2. 起一个本地网页（默认 http://127.0.0.1:8787），实时显示每个浏览器
   （worker）当前在抓哪个 URL、已耗时、最近状态，以及全局进度与速率。

引擎
----
抓取仍由已经过零缺漏验证的 scripts/fetch-cf-gyms.mjs 执行（有头 Chromium
过 Cloudflare）。本文件只做进程编排 + 监控面板，不重复实现解析逻辑，
避免破坏「三层枚举 + verify 校验」的完整性契约。

用法
----
    python3 scripts/cf_gyms_ui.py                 # 起 1 个浏览器，自动开始
    python3 scripts/cf_gyms_ui.py --workers 2     # 起 2 个浏览器（各自独立 profile）
    python3 scripts/cf_gyms_ui.py --port 8899 --no-autostart
    python3 scripts/cf_gyms_ui.py --headless      # 无头（仅调试用；实测过不了 Turnstile）

快捷键：Ctrl+C 停止所有 worker 并退出。
"""

import argparse
import calendar
import json
import os
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "cf-gyms")
PROBLEMS = os.path.join(DATA, "problems")
CACHE = os.path.join(ROOT, ".cache", "cf-gyms-ui")
FETCHER = os.path.join(ROOT, "scripts", "fetch-cf-gyms.mjs")

POLL_SECONDS = 2.0


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def tail_lines(path, limit=12):
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            block = min(size, 64 * 1024)
            fh.seek(size - block)
            raw = fh.read().decode("utf-8", "replace")
    except Exception:
        return []
    lines = [ln for ln in raw.splitlines() if ln.strip()]
    return lines[-limit:]


def human_duration(seconds):
    seconds = int(max(0, seconds))
    if seconds < 60:
        return "%ds" % seconds
    if seconds < 3600:
        return "%dm%02ds" % (seconds // 60, seconds % 60)
    return "%dh%02dm" % (seconds // 3600, (seconds % 3600) // 60)


# --------------------------------------------------------------------------
# worker（一个浏览器）管理
# --------------------------------------------------------------------------

class Worker:
    def __init__(self, index, headless=False, minutes=None):
        self.index = index
        self.headless = headless
        self.minutes = minutes
        self.proc = None
        self.log_path = os.path.join(CACHE, "worker-%d.log" % index)
        self.live_path = os.path.join(DATA, ".live-w%d.json" % index)
        self.profile_dir = os.path.join(ROOT, ".cache", "cf-gyms-browser-w%d" % index)
        self.started_at = None
        self.runs = 0
        self.short_runs = 0
        self.stopped = False
        self._lock = threading.Lock()

    # -- 进程控制 --------------------------------------------------------
    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        with self._lock:
            if self.alive():
                return
            os.makedirs(CACHE, exist_ok=True)
            os.makedirs(self.profile_dir, exist_ok=True)
            env = dict(os.environ)
            env["CF_HEADLESS"] = "1" if self.headless else "0"
            env["CFG_BROWSER_DIR"] = self.profile_dir
            env["CFG_LIVE_FILE"] = self.live_path
            cmd = [
                "node", FETCHER,
                # 列表与 ID 补扫交给 CI/显式全量跑；面板专注题面（新→旧倒序），
                # 不请求 /gyms/page/N —— 列表页最容易触发 Cloudflare 质询
                "--mode", "problems",
                "--concurrency", "1",
            ]
            if self.minutes:
                cmd += ["--minutes", str(self.minutes)]
            with open(self.log_path, "ab", buffering=0) as log_fh:
                log_fh.write(("\n===== worker %d start %s =====\n"
                              % (self.index, time.strftime("%F %T"))).encode())
                self.proc = subprocess.Popen(
                    cmd, cwd=ROOT, env=env,
                    stdout=log_fh, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            self.started_at = time.time()
            self.runs += 1
            self.stopped = False

    def stop(self, timeout=12.0):
        with self._lock:
            self.stopped = True
            proc = self.proc
            if proc is None or proc.poll() is not None:
                return
            try:
                proc.terminate()
            except Exception:
                pass
        deadline = time.time() + timeout
        while time.time() < deadline:
            if proc.poll() is not None:
                return
            time.sleep(0.2)
        try:
            proc.kill()
        except Exception:
            pass

    def reap(self):
        """进程意外退出时返回退出码，供监管线程决定是否重启。"""
        if self.proc is None:
            return None
        code = self.proc.poll()
        return code

    # -- 状态 ------------------------------------------------------------
    def live(self):
        snap = read_json(self.live_path, None) or {}
        workers = snap.get("workers") or []
        cur = workers[0] if workers else {}
        age = None
        if snap.get("updatedAt"):
            try:
                # node 写的是 toISOString()（UTC）
                age = time.time() - calendar.timegm(time.strptime(snap["updatedAt"][:19], "%Y-%m-%dT%H:%M:%S"))
            except Exception:
                age = None
        return {
            "index": self.index,
            "alive": self.alive(),
            "pid": self.proc.pid if self.proc else None,
            "runs": self.runs,
            "url": cur.get("url"),
            "phase": cur.get("phase") or ("stopped" if self.stopped else "starting"),
            "pageStatus": cur.get("status"),
            "pageElapsedMs": cur.get("elapsedMs"),
            "startedAt": cur.get("startedAt"),
            "updatedAgeSec": round(age, 1) if age is not None else None,
            "logTail": tail_lines(self.log_path, 8),
        }


# --------------------------------------------------------------------------
# 全局状态采集
# --------------------------------------------------------------------------

class Monitor:
    def __init__(self, workers):
        self.workers = workers
        self.samples = deque()          # (ts, done_count)
        self.lock = threading.Lock()
        self.counts_cache = {"ts": 0.0, "done": 0}
        self.started_at = time.time()

    def problem_files(self):
        """题面文件数（目录列举，1 万级也只需几毫秒）。"""
        now = time.time()
        with self.lock:
            if now - self.counts_cache["ts"] < 1.0:
                return self.counts_cache["done"]
        try:
            n = sum(1 for name in os.listdir(PROBLEMS) if name.endswith(".json"))
        except OSError:
            n = 0
        with self.lock:
            self.counts_cache = {"ts": now, "done": n}
        return n

    def rate_per_min(self):
        done = self.problem_files()
        now = time.time()
        with self.lock:
            self.samples.append((now, done))
            while self.samples and now - self.samples[0][0] > 300:
                self.samples.popleft()
            if len(self.samples) < 2:
                return 0.0
            t0, c0 = self.samples[0]
            span = now - t0
            if span < 20:
                return 0.0
            return max(0.0, (done - c0) / (span / 60.0))

    def snapshot(self):
        contests = read_json(os.path.join(DATA, "contests.json"), []) or []
        attempts = read_json(os.path.join(DATA, ".attempts.json"), {}) or {}
        done = self.problem_files()
        by_status = {}
        total_problems = 0
        with_problems = 0
        for c in contests:
            st = c.get("gymStatus") or "unknown"
            by_status[st] = by_status.get(st, 0) + 1
            n = len(c.get("problems") or [])
            total_problems += n
            if n:
                with_problems += 1
        rate = self.rate_per_min()
        pending = max(0, total_problems - done)
        eta_sec = (pending / rate * 60.0) if rate > 0 and pending else None
        return {
            "now": time.strftime("%F %T"),
            "uptimeSec": int(time.time() - self.started_at),
            "contests": len(contests),
            "contestsWithProblems": with_problems,
            "byStatus": by_status,
            "problemsDiscovered": total_problems,
            "problemsDone": done,
            "problemsPending": pending,
            "attemptFailures": len(attempts),
            "ratePerMin": round(rate, 2),
            "etaSec": int(eta_sec) if eta_sec else None,
            "workers": [w.live() for w in self.workers],
        }


# --------------------------------------------------------------------------
# HTTP 面板
# --------------------------------------------------------------------------

PAGE = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cf-gyms 抓取控制台</title>
<style>
  :root{
    --bg:#0b0f17; --panel:#121826; --panel2:#0f1521; --line:#1f2a3d;
    --text:#e6edf7; --muted:#8b9bb4; --accent:#5b9cff; --ok:#3ddc97;
    --warn:#ffb454; --bad:#ff6b6b;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  a{color:var(--accent)}
  .wrap{max-width:1180px;margin:0 auto;padding:22px 18px 60px}
  h1{font-size:19px;margin:0 0 2px;letter-spacing:.3px}
  .sub{color:var(--muted);font-size:12.5px;margin-bottom:18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .stat .k{color:var(--muted);font-size:11.5px;letter-spacing:.4px;text-transform:uppercase}
  .stat .v{font-size:22px;font-weight:650;margin-top:3px;font-variant-numeric:tabular-nums}
  .stat .n{color:var(--muted);font-size:11.5px;margin-top:2px}
  .bar{height:8px;background:#0a0e16;border:1px solid var(--line);border-radius:99px;overflow:hidden;margin:4px 0 18px}
  .bar > i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#3ddc97);width:0}
  .rowhead{display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px}
  .rowhead h2{font-size:14px;margin:0;color:var(--muted);font-weight:600;letter-spacing:.4px;text-transform:uppercase}
  .btns button{background:#172033;color:var(--text);border:1px solid var(--line);border-radius:8px;
    padding:6px 12px;font-size:12.5px;cursor:pointer;margin-left:8px}
  .btns button:hover{border-color:#2b3b57;background:#1b263c}
  .btns button.primary{background:#1d4ed8;border-color:#2563eb}
  .btns button.danger{background:#7f1d1d;border-color:#991b1b}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
  .card .top{display:flex;align-items:center;gap:9px;margin-bottom:8px}
  .dot{width:9px;height:9px;border-radius:50%;background:#41506a;flex:0 0 auto}
  .dot.on{background:var(--ok);box-shadow:0 0 0 3px rgba(61,220,151,.14);animation:pulse 1.6s infinite}
  .dot.warn{background:var(--warn)}
  .dot.off{background:#54617a}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  .who{font-weight:600}
  .tag{font-size:11.5px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 8px}
  .url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:#bcd0ee;
    background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .meta{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:12px;margin-top:8px}
  .meta b{color:#cfe0f7;font-weight:600}
  details{margin-top:10px}
  summary{cursor:pointer;color:var(--muted);font-size:12px}
  pre{margin:8px 0 0;padding:10px;background:#0a0e16;border:1px solid var(--line);border-radius:8px;
    color:#93a5c1;font-size:11.5px;line-height:1.5;overflow:auto;max-height:190px}
  .foot{color:#5f6c82;font-size:11.5px;margin-top:22px;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
  <h1>cf-gyms 抓取控制台</h1>
  <div class="sub">按开赛时间倒序（最近的场次优先）持续抓取 · 有头 Chromium 过 Cloudflare · <span id="clock">–</span></div>

  <div class="grid">
    <div class="stat"><div class="k">已抓题面</div><div class="v" id="done">–</div><div class="n" id="doneNote">–</div></div>
    <div class="stat"><div class="k">当前速率</div><div class="v" id="rate">–</div><div class="n">题 / 分钟（近 5 分钟）</div></div>
    <div class="stat"><div class="k">预计剩余</div><div class="v" id="eta">–</div><div class="n">按当前速率估算</div></div>
    <div class="stat"><div class="k">比赛</div><div class="v" id="contests">–</div><div class="n" id="contestsNote">–</div></div>
    <div class="stat"><div class="k">运行时长</div><div class="v" id="uptime">–</div><div class="n" id="fails">–</div></div>
  </div>

  <div class="bar"><i id="bar"></i></div>

  <div class="rowhead">
    <h2>浏览器（worker）</h2>
    <div class="btns">
      <button class="primary" onclick="ctl('start')">启动</button>
      <button class="danger" onclick="ctl('stop')">停止</button>
      <button onclick="ctl('restart')">重启</button>
    </div>
  </div>
  <div id="cards"></div>

  <div class="foot">
    数据源：data/cf-gyms/{contests.json, problems/*.json} · 进度快照：data/cf-gyms/.live-w*.json<br>
    停止按钮会让 worker 完成当前页面后存档退出（断点续传，不会丢已抓内容）。
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const fmtDur = (s) => {
  if (s == null) return '–';
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm' + String(s%60).padStart(2,'0') + 's';
  return Math.floor(s/3600) + 'h' + String(Math.floor((s%3600)/60)).padStart(2,'0') + 'm';
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function statusClass(w){
  if (!w.alive) return 'off';
  if (w.phase === 'navigating') return 'on';
  if (w.pageStatus && w.pageStatus !== 'ok') return 'warn';
  return 'on';
}

function renderCards(ws){
  $('cards').innerHTML = ws.map(w => {
    const url = w.url ? w.url.replace(/^https?:\/\/codeforces\.com/, '') : '（等待任务）';
    const elapsed = w.pageElapsedMs ? (w.pageElapsedMs/1000).toFixed(1)+'s' : '–';
    const stale = (w.updatedAgeSec != null && w.updatedAgeSec > 30) ? ' · 快照 ' + fmtDur(w.updatedAgeSec) + ' 前' : '';
    return `
      <div class="card">
        <div class="top">
          <span class="dot ${statusClass(w)}"></span>
          <span class="who">Worker #${w.index}</span>
          <span class="tag">${w.alive ? '运行中 · pid ' + (w.pid||'') : '已停止'}</span>
          <span class="tag">${esc(w.phase)}</span>
          ${w.pageStatus ? `<span class="tag">上次: ${esc(w.pageStatus)}</span>` : ''}
        </div>
        <div class="url" title="${esc(w.url||'')}">${esc(url)}</div>
        <div class="meta">
          <span>本页耗时 <b>${elapsed}</b></span>
          <span>启动次数 <b>${w.runs}</b></span>
          <span>最后快照 <b>${w.updatedAgeSec == null ? '–' : fmtDur(w.updatedAgeSec)+' 前'}</b></span>
        </div>
        <details><summary>最近日志</summary>
          <pre>${esc((w.logTail||[]).join('\n'))}</pre>
        </details>
      </div>`;
  }).join('');
}

async function refresh(){
  try{
    const r = await fetch('/api/state', {cache:'no-store'});
    const s = await r.json();
    $('clock').textContent = s.now;
    $('done').textContent = s.problemsDone;
    $('doneNote').textContent = `已发现 ${s.problemsDiscovered} 题 · 待抓 ${s.problemsPending}`;
    $('rate').textContent = s.ratePerMin ? s.ratePerMin.toFixed(1) : '0';
    $('eta').textContent = s.etaSec ? fmtDur(s.etaSec) : '–';
    $('contests').textContent = s.contests;
    $('contestsNote').textContent = `${s.contestsWithProblems} 场已展开题目`;
    $('uptime').textContent = fmtDur(s.uptimeSec);
    $('fails').textContent = `失败记账 ${s.attemptFailures} 条（会自动重试）`;
    const total = Math.max(1, s.problemsDiscovered + s.problemsPending);
    const pct = Math.min(100, (s.problemsDone / total) * 100);
    $('bar').style.width = pct.toFixed(1) + '%';
    renderCards(s.workers || []);
  }catch(e){
    $('clock').textContent = '连接中断，重试中…';
  }
}

async function ctl(action){
  await fetch('/api/' + action, {method:'POST'});
  refresh();
}

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    monitor = None
    workers = None
    server_version = "cfgyms-ui/1.0"

    def log_message(self, fmt, *args):  # 安静：只记错误
        if args and str(args[0]).startswith(("4", "5")):
            sys.stderr.write("http %s\n" % (fmt % args))

    def _send(self, code, body, ctype="application/json"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self._send(200, PAGE, "text/html")
        if path == "/api/state":
            return self._send(200, json.dumps(self.monitor.snapshot(), ensure_ascii=False))
        if path == "/healthz":
            return self._send(200, json.dumps({"ok": True}))
        return self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/start":
            for w in self.workers:
                w.start()
            return self._send(200, json.dumps({"ok": True}))
        if path == "/api/stop":
            for w in self.workers:
                w.stop()
            return self._send(200, json.dumps({"ok": True}))
        if path == "/api/restart":
            for w in self.workers:
                w.stop()
            time.sleep(1.0)
            for w in self.workers:
                w.start()
            return self._send(200, json.dumps({"ok": True}))
        return self._send(404, json.dumps({"error": "not found"}))


# --------------------------------------------------------------------------
# 监管线程：worker 异常退出自动重启（连续短命则退避）
# --------------------------------------------------------------------------

def supervise(workers, stop_event):
    while not stop_event.is_set():
        for w in workers:
            if w.stopped or w.alive():
                continue
            code = w.reap()
            if code is None:
                continue
            lived = time.time() - (w.started_at or time.time())
            w.short_runs = w.short_runs + 1 if lived < 90 else 0
            delay = 5 if w.short_runs < 3 else 120
            sys.stderr.write("[supervisor] worker %d exited code=%s after %s, restart in %ss\n"
                             % (w.index, code, human_duration(lived), delay))
            for _ in range(int(delay * 2)):
                if stop_event.is_set():
                    return
                time.sleep(0.5)
            w.start()
        stop_event.wait(2.0)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="cf-gyms 抓取控制台（单文件）")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--minutes", type=int, default=0, help="单轮题面阶段预算（0=不限）")
    ap.add_argument("--headless", action="store_true", help="无头模式（实测过不了 Turnstile，仅调试）")
    ap.add_argument("--no-autostart", action="store_true", help="只起面板，不自动开始抓取")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    workers = [Worker(i, headless=args.headless, minutes=args.minutes or None)
               for i in range(max(1, args.workers))]
    monitor = Monitor(workers)
    Handler.monitor = monitor
    Handler.workers = workers

    stop_event = threading.Event()
    sup = threading.Thread(target=supervise, args=(workers, stop_event), daemon=True)
    sup.start()

    if not args.no_autostart:
        for w in workers:
            w.start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://%s:%d/" % (args.host, args.port)
    print("cf-gyms 控制台: %s  (workers=%d, %s)" % (
        url, len(workers), "headless" if args.headless else "headed"))
    print("按 Ctrl+C 停止所有 worker 并退出")

    def shutdown(signum=None, frame=None):
        stop_event.set()
        for w in workers:
            w.stop()
        try:
            httpd.shutdown()
        except Exception:
            pass

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        shutdown()
    finally:
        for w in workers:
            w.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
