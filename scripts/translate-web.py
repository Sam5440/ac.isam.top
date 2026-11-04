#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
翻译 Web 控制台（零依赖，仅 Python 标准库）：

    python3 scripts/translate-web.py [--port 8765] [--root <仓库根目录>]

功能：
  - 扫描 data/<platform>/problems/ 全部题目，列出未翻译题（有 statementMd 且无
    statementZhMd），按比赛开始时间倒序（最新比赛在前；无时间者按 contestId 倒序垫底）。
  - 通过 OpenAI 兼容端点（默认 http://127.0.0.1:3425/v1）多模型并行翻译：
    zcode/GLM-5.3-Flash-Trial ×3 并发 + opencode-zen-free/glm-5.3-flash-free ×1 并发，
    从队列头按时间倒序派发。
  - 翻译协议与 scripts/lib/llm.mjs 完全一致（同一 system prompt、JSON 输出解析、
    兜底、重试与 401/403 快速失败），落盘字段与 Node 管线同构（titleZh / statementZhMd /
    translatedAt / translateModel），写入为 tmp+rename 原子替换并与磁盘现值合并，
    可与正在运行的 backfill-all 进程并行。
  - 网页端显示进度、每模型请求数与 token 消耗（输入 / 输出 / 缓存读取），每次可
    选择翻译数量；仅监听 127.0.0.1。
"""

import argparse
import json
import os
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

# ---------------------------------------------------------------- 常量

PLATFORMS = ("atcoder", "codeforces", "nowcoder")
PLATFORM_LABEL = {"atcoder": "AtCoder", "codeforces": "Codeforces", "nowcoder": "牛客"}

DEFAULT_CONFIG = {
    "baseUrl": "http://127.0.0.1:3425/v1",
    "apiKey": "",
    "models": [
        {"model": "zcode/GLM-5.3-Flash-Trial", "concurrency": 3},
        {"model": "opencode-zen-free/glm-5.3-flash-free", "concurrency": 1},
    ],
}

CHAT_TIMEOUT = 420          # 单次请求超时（秒），与 llm.mjs 一致
RETRIES = 2                 # 每题重试次数（不含首次），与 llm.mjs 一致
CONSEC_4XX_ABORT = 8        # 连续 401/403 次数达到即自动停止整轮

STATEMENT_SYSTEM = """你是顶级算法竞赛选手兼技术翻译，负责把算法竞赛题面从英文（或日文）翻译成简体中文。

硬性规则：
1. 输出必须是严格的 JSON 对象：{"titleZh": "<中文题名>", "bodyZh": "<翻译后的完整 Markdown 题面>"}，不要输出任何 JSON 之外的文字。
2. 数学公式一律原样保留：$...$ 与 $$...$$ 中的内容一个字符都不能改（包括空格、反斜杠、下标上标）。
3. 代码块（``` 围栏）与行内代码（`...`）原样保留，不翻译其中的内容。
4. 保持 Markdown 结构与段落顺序：标题层级、列表、表格、图片链接均保持不变。
5. 小节标题按此对照翻译：Problem Statement→题目描述；Constraints→约束条件；Input→输入格式；Output→输出格式；Note→说明；Scoring→评分；Interaction→交互；Examples→样例。其它标题酌情翻译。
6. 变量名、算法名（如 DP、DFS）、化学/物理符号保留原文；术语采用国内 OJ 惯用译法（如 subsequence→子序列，vertex→顶点，edge→边）。
7. 语句要符合中文表达习惯，不要逐词直译，也不要遗漏或添加内容。输入格式说明中的占位变量（如 N M、A_1 A_2 ... A_N）保持原样。
8. titleZh 只给题名的中文翻译，不要带题号前缀。"""


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def parse_ts(s):
    """ISO 时间 → epoch 秒；解析失败返回 None。"""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ---------------------------------------------------------------- 翻译协议（移植自 llm.mjs）

class FatalError(Exception):
    """不可重试错误（401/403 等）。"""


class Cancelled(Exception):
    """用户手动停止：中断在途请求。"""


class CancelToken:
    """停止信号 + 在途连接登记表。

    注意：不能用「短 socket 超时 + 轮询」来响应停止——socket 一旦超时就会把
    file object 标记成永久失效（后续读取抛 "cannot read from timed out object"），
    停顿超过超时时间就把正常连接弄坏了。正确做法是保持正常阻塞读，
    停止时由这里主动 close 掉在途连接，阻塞中的 read 会立即抛错。
    """

    def __init__(self):
        self.event = threading.Event()
        self._lock = threading.Lock()
        self._closers = set()

    def is_set(self):
        return self.event.is_set()

    def wait(self, timeout):
        return self.event.wait(timeout)

    def set(self):
        self.event.set()
        with self._lock:
            closers, self._closers = list(self._closers), set()
        for close in closers:
            try:
                close()
            except Exception:  # noqa: BLE001
                pass

    def register(self, close):
        with self._lock:
            already = self.event.is_set()
            if not already:
                self._closers.add(close)
        if already:      # 已停止：立刻关闭，避免登记后无人处理
            try:
                close()
            except Exception:  # noqa: BLE001
                pass

    def unregister(self, close):
        with self._lock:
            self._closers.discard(close)


def extract_json(text):
    t = str(text).strip()
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", t)
    if m:
        t = m.group(1).strip()
    first, last = t.find("{"), t.rfind("}")
    if first == -1 or last <= first:
        return None
    try:
        return json.loads(t[first:last + 1])
    except json.JSONDecodeError:
        return None


def usage_of(data):
    """从响应提取 (输入, 输出, 缓存读取) token 数；字段缺失按 0。"""
    u = data.get("usage") or {}
    details = u.get("prompt_tokens_details") or {}
    cached = int(details.get("cached_tokens") or 0)
    cached += int(u.get("cache_read_input_tokens") or 0)  # anthropic 风格代理
    return (int(u.get("prompt_tokens") or 0),
            int(u.get("completion_tokens") or 0),
            cached)


def chat_stream(cfg, model, messages, on_chunk, temperature=0.2, timeout=CHAT_TIMEOUT, cancel=None, ua=None):
    """流式 chat/completions（stream=true）。每收到一段增量调用 on_chunk(text)。

    返回 (完整内容, (in, out, cached))。上游不支持 SSE 时按普通 JSON 解析兜底。
    401/403 抛 FatalError，其它 HTTP 错误抛 RuntimeError。
    cancel 为 threading.Event：一旦置位立即中断连接并抛 Cancelled（用于「停止」）。
    """
    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise Cancelled("用户停止")

    check_cancel()
    body = json.dumps({"model": model, "messages": messages,
                       "temperature": temperature, "stream": True,
                       "stream_options": {"include_usage": True}}).encode("utf-8")
    # UA 用题目名（代理日志可按题对号）；默认避免暴露 Python-urllib
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream",
               "User-Agent": ua or "translate-web"}
    if cfg.get("apiKey"):
        headers["Authorization"] = "Bearer " + cfg["apiKey"]
    req = urllib.request.Request(cfg["baseUrl"].rstrip("/") + "/chat/completions",
                                 data=body, headers=headers, method="POST")
    deadline = time.time() + timeout

    # 用线程发送请求：卡在建连/首包时也能被 cancel 打断（urlopen 本身不可中断）
    box = {}

    def _open():
        try:
            box["resp"] = urllib.request.urlopen(req, timeout=timeout)
        except BaseException as e:  # noqa: BLE001
            box["err"] = e

    th = threading.Thread(target=_open, daemon=True)
    th.start()
    while th.is_alive():
        th.join(0.25)
        if cancel is not None and cancel.is_set():
            # 打断阻塞中的连接：能拿到 socket 就关它
            resp0 = box.get("resp")
            try:
                sock = getattr(getattr(getattr(resp0, "fp", None), "raw", None), "_sock", None)
                if sock:
                    sock.close()
            except Exception:  # noqa: BLE001
                pass
            raise Cancelled("用户停止")
    if "err" in box:
        e = box["err"]
        if isinstance(e, urllib.error.HTTPError):
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:200]
            except Exception:  # noqa: BLE001
                pass
            if e.code in (401, 403):
                raise FatalError("HTTP {} {}".format(e.code, detail))
            # 模型级不可用（额度耗尽/被下架）：重试与继续跑队列都没有意义
            low = detail.lower()
            if e.code in (400, 404) and any(k in low for k in ("quota", "not served", "switched off")):
                raise FatalError("HTTP {} {}".format(e.code, detail))
            raise RuntimeError("HTTP {} {}".format(e.code, detail))
        raise RuntimeError(str(e))
    resp = box["resp"]

    # 停止时由 CancelToken 主动关闭连接，阻塞中的 read 会立即抛错
    def _close_now():
        for obj in (resp, getattr(getattr(getattr(resp, "fp", None), "raw", None), "_sock", None)):
            try:
                if obj is not None:
                    obj.close()
            except Exception:  # noqa: BLE001
                pass

    if cancel is not None:
        cancel.register(_close_now)

    parts = []
    usage = (0, 0, 0)
    ctype = (resp.headers.get("Content-Type") or "").lower()
    try:
        if "text/event-stream" not in ctype:
            # 代理忽略了 stream 参数：整体 JSON
            raw = resp.read().decode("utf-8", "replace")
            check_cancel()
            try:
                data = json.loads(raw)
                text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
                usage = usage_of(data)
            except (json.JSONDecodeError, AttributeError, IndexError):
                text = raw  # 纯文本兜底
            if text:
                parts.append(text)
                on_chunk(text, "content")
            return "".join(parts), usage

        while True:
            check_cancel()
            if time.time() > deadline:
                raise RuntimeError("stream timeout")
            try:
                raw = resp.readline()      # 正常阻塞读（勿设短超时，见 CancelToken 注释）
            except Exception as e:  # noqa: BLE001
                if cancel is not None and cancel.is_set():
                    raise Cancelled("用户停止")
                raise RuntimeError(str(e))
            if not raw:
                break
            line = raw.decode("utf-8", "replace").strip()
            if not line or not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if ev.get("usage"):
                usage = usage_of(ev)
            for ch in ev.get("choices") or []:
                delta = ch.get("delta") or {}
                # 思考过程（DeepSeek/GLM 系：reasoning_content；部分代理用 reasoning）
                think = delta.get("reasoning_content") or delta.get("reasoning")
                if not think and ch.get("message"):
                    think = ch["message"].get("reasoning_content") or ch["message"].get("reasoning")
                if think:
                    on_chunk(think, "reasoning")
                piece = delta.get("content")
                if not piece and ch.get("message"):
                    piece = ch["message"].get("content")
                if piece:
                    parts.append(piece)
                    on_chunk(piece, "content")
                # 部分代理把 usage 挂在最后一个 choice 上
                if ch.get("usage"):
                    usage = usage_of(ch)
    finally:
        if cancel is not None:
            cancel.unregister(_close_now)
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass
    return "".join(parts), usage


def chat_with_retry(cfg, model, messages, log, temperature=0.2, timeout=CHAT_TIMEOUT, on_chunk=None, cancel=None, ua=None):
    last_err = None
    for attempt in range(RETRIES + 1):
        got = []  # 每次尝试独立收集，重试时清空（web 端用 retry 事件标记）
        try:
            def sink(piece, kind="content", got=got, attempt=attempt):
                if kind == "content":
                    got.append(piece)
                if on_chunk:
                    on_chunk(piece, kind)

            content, usage = chat_stream(cfg, model, messages, sink, temperature, timeout, cancel, ua=ua)
            if not content.strip():
                raise RuntimeError("empty completion")
            return content, usage
        except (FatalError, Cancelled):
            raise
        except Exception as e:  # noqa: BLE001
            last_err = e
            if on_chunk:
                on_chunk("\n\n[重试 {}/{} — {}]\n\n".format(attempt + 1, RETRIES, e), "content")
            if attempt < RETRIES:
                wait = 8.0 * (attempt + 1)
                log("llm", "retry {}/{} — {}".format(attempt + 1, RETRIES, e))
                # 重试等待期间也要能被停止打断
                if cancel is not None:
                    if cancel.wait(wait):
                        raise Cancelled("用户停止")
                else:
                    time.sleep(wait)
    raise last_err


def translate_statement(cfg, model, title, statement_md, log, on_chunk=None, cancel=None, pid=None):
    """返回 ({titleZh, bodyZh}, usage)；协议与 llm.mjs translateStatement 一致。"""
    user = "请翻译以下题面。\n\n题名：{}\n\n<statement>\n{}\n</statement>".format(title, statement_md)
    # User-Agent 直接用题号（如 2278A / abc482_f / nc142559pa），代理侧按题识别请求
    ua = quote(str(pid or "").strip()[:60] or "unknown", safe="")
    content, usage = chat_with_retry(
        cfg, model,
        [{"role": "system", "content": STATEMENT_SYSTEM},
         {"role": "user", "content": user}],
        log, on_chunk=on_chunk, cancel=cancel, ua=ua,
    )
    parsed = extract_json(content)
    if parsed and isinstance(parsed.get("bodyZh"), str) and parsed["bodyZh"].strip():
        title_zh = parsed.get("titleZh")
        return ({"titleZh": title_zh.strip() if isinstance(title_zh, str) and title_zh.strip() else title,
                 "bodyZh": parsed["bodyZh"].strip()}, usage)
    fallback = str(content).strip()
    if len(fallback) > 20:
        return ({"titleZh": title, "bodyZh": fallback}, usage)
    raise RuntimeError("translation unparsable")


# ---------------------------------------------------------------- 应用

class App:
    def __init__(self, root):
        self.root = root
        self.data_dir = os.path.join(root, "data")
        self.lock = threading.RLock()
        self.write_lock = threading.Lock()
        self.cfg_file = os.path.join(root, ".translate-web.config.json")
        self.cfg = self._load_cfg()
        self.problems = []            # 未翻译队列（扫描后）
        self.all_problems = []        # 全量题库（含已翻译，题库浏览用）
        self.contest_index = {}       # (platform, contestId) → 比赛（题库详情用）
        self.scan_at = None
        self.run = None               # 当前/最近一轮
        self.cumulative = {}          # model → 累计 token 统计（进程生命周期内）
        self._logs = deque(maxlen=300)
        self.tasks = {}               # taskKey → 任务记录（流式对话缓冲等）
        self._task_order = deque(maxlen=400)
        self.log("main", "翻译控制台启动，数据目录 " + self.data_dir)

    def _load_cfg(self):
        """读持久化配置（.translate-web.config.json），缺失/损坏时回落到默认。"""
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))
        try:
            with open(self.cfg_file, encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved.get("baseUrl"), str) and saved["baseUrl"].strip():
                cfg["baseUrl"] = saved["baseUrl"].strip()
            if isinstance(saved.get("apiKey"), str):
                cfg["apiKey"] = saved["apiKey"]

            def norm_model(m):
                return {
                    "model": str(m.get("model", "")).strip(),
                    "concurrency": max(1, min(200, int(m.get("concurrency") or 1))),
                    "baseUrl": str(m.get("baseUrl", "") or "").strip(),   # 空 = 用全局
                    "apiKey": str(m.get("apiKey", "") or ""),             # 空 = 用全局
                }

            models = [norm_model(m) for m in (saved.get("models") or [])
                      if str(m.get("model", "")).strip()]
            if models:
                cfg["models"] = models
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            pass
        return cfg

    def model_cfg(self, m):
        """单个模型生效的请求配置：模型自己的 baseUrl/apiKey 优先，空则回落全局。"""
        return {
            "baseUrl": (m.get("baseUrl") or "").strip() or self.cfg["baseUrl"],
            "apiKey": (m.get("apiKey") or "").strip() or self.cfg["apiKey"],
        }

    def save_cfg(self):
        with self.lock:
            data = json.loads(json.dumps(self.cfg))
        try:
            tmp = self.cfg_file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp, self.cfg_file)
        except OSError:
            pass

    def log(self, tag, msg):
        with self.lock:
            self._logs.append("[{}] [{}] {}".format(datetime.now().strftime("%H:%M:%S"), tag, msg))

    # ---------- 任务记录（流式对话） ----------

    def _new_task(self, key, model, platform, pid, title, contest_title):
        t = {
            "key": key, "model": model, "platform": platform, "id": pid,
            "title": title, "contestTitle": contest_title,
            "status": "running", "startedAt": time.time(), "endedAt": None,
            "output": [], "outLen": 0, "chunks": 0, "error": None,
            "reasoning": [], "rsLen": 0,
            "usage": None, "attempt": 1, "saved": False,
        }
        with self.lock:
            self.tasks[key] = t
            self._task_order.append(key)
            # 只保留最近 300 条完整记录，更早的释放正文
            while len(self.tasks) > 300:
                old = next(iter(self.tasks))
                self.tasks.pop(old, None)
        return t

    def _append_chunk(self, task, piece, kind="content"):
        with self.lock:
            if kind == "reasoning":
                task["reasoning"].append(piece)
                task["rsLen"] += len(piece)
            else:
                task["output"].append(piece)
                task["outLen"] += len(piece)
            task["chunks"] += 1

    def task_detail(self, key, cursor=0, rcursor=0):
        """返回任务详情：正文与思考过程各自的增量（带游标）。"""
        with self.lock:
            t = self.tasks.get(key)
            if not t:
                return {"error": "任务不存在或已被回收"}
            text = "".join(t["output"])
            rtext = "".join(t["reasoning"])
            head = {k: t[k] for k in ("key", "model", "platform", "id", "title", "contestTitle",
                                      "status", "startedAt", "endedAt", "outLen", "rsLen", "chunks",
                                      "error", "usage", "attempt", "saved")}
            cursor = max(0, min(int(cursor or 0), len(text)))
            rcursor = max(0, min(int(rcursor or 0), len(rtext)))
            return {"task": head,
                    "text": text[cursor:], "nextCursor": len(text),
                    "rtext": rtext[rcursor:], "nextRCursor": len(rtext)}

    def tasks_list(self):
        with self.lock:
            out = []
            for key in reversed(self._task_order):
                t = self.tasks.get(key)
                if not t:
                    continue
                out.append({k: t[k] for k in ("key", "model", "platform", "id", "title",
                                              "status", "startedAt", "endedAt", "outLen",
                                              "rsLen", "error", "saved")})
                if len(out) >= 120:
                    break
            return out

    # ---------- 扫描 ----------

    def scan(self):
        t0 = time.time()
        contests = {}
        for plat in PLATFORMS:
            path = os.path.join(self.data_dir, plat, "contests.json")
            try:
                with open(path, encoding="utf-8") as f:
                    for c in json.load(f):
                        contests[(plat, str(c.get("id")))] = c
            except (OSError, json.JSONDecodeError):
                continue
        self.contest_index = contests

        items = []
        untranslated = 0
        for plat in PLATFORMS:
            pdir = os.path.join(self.data_dir, plat, "problems")
            try:
                names = os.listdir(pdir)
            except OSError:
                continue
            for name in names:
                if not name.endswith(".json"):
                    continue
                path = os.path.join(pdir, name)
                try:
                    with open(path, encoding="utf-8") as f:
                        p = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                if not p.get("statementMd"):
                    continue
                c = contests.get((plat, str(p.get("contestId"))), {})
                translated = bool(p.get("statementZhMd")
                                  and str(p.get("statementZhMd")) != str(p.get("statementMd")))
                if not translated:
                    untranslated += 1
                items.append({
                    "platform": plat,
                    "id": p.get("id"),
                    "file": path,
                    "title": p.get("title") or "",
                    "titleZh": p.get("titleZh"),
                    "contestId": p.get("contestId"),
                    "contestTitle": c.get("title") or "",
                    "startTime": c.get("startTime"),
                    "startTs": parse_ts(c.get("startTime")) or 0.0,
                    "chars": len(p.get("statementMd") or ""),
                    "translated": translated,
                    "translateModel": p.get("translateModel"),
                    "translatedAt": p.get("translatedAt"),
                })

        def sort_key(p):
            cid = str(p["contestId"])
            try:
                cidn = int(float(cid))
            except ValueError:
                cidn = 0
            if p["startTs"] > 0:
                return (0, -p["startTs"], 0, cid, str(p["id"]))
            # 无开始时间（牛客）：时间倒序语义退化为 contestId 倒序，垫底
            return (1, 0.0, -cidn, cid, str(p["id"]))

        items.sort(key=sort_key)
        with self.lock:
            self.all_problems = items
            self.problems = [p for p in items if not p["translated"]]
            self.scan_at = time.time()
        by_platform = {}
        for p in self.problems:
            by_platform[p["platform"]] = by_platform.get(p["platform"], 0) + 1
        self.log("scan", "全量 {} 题（未翻译 {}），耗时 {:.1f}s".format(
            len(items), len(self.problems), time.time() - t0))
        return {"untranslated": len(self.problems), "total": len(items),
                "translated": len(items) - len(self.problems), "byPlatform": by_platform}

    def problems_page(self, offset, limit, only, q="", model=""):
        """题库分页：only = untranslated | translated | all；q 搜索；model 按翻译模型过滤。"""
        with self.lock:
            rows = list(self.all_problems)
        if only == "untranslated":
            rows = [p for p in rows if not p["translated"]]
        elif only == "translated":
            rows = [p for p in rows if p["translated"]]
        if model:
            rows = [p for p in rows if p.get("translateModel") == model]
        if q:
            k = q.lower()
            rows = [p for p in rows if k in str(p["id"]).lower() or k in (p["title"] or "").lower()
                    or k in (p.get("titleZh") or "").lower() or k in (p["contestTitle"] or "").lower()]
        total = len(rows)
        page = rows[offset:offset + limit]
        return {"total": total, "offset": offset,
                "rows": [{k: v for k, v in p.items() if k != "file"} for p in page]}

    def problem_detail(self, platform, pid):
        """读取单题完整内容（原文 + 译文 + 翻译元数据）。"""
        f = os.path.join(self.data_dir, platform, "problems", str(pid).lower() + ".json")
        try:
            with open(f, encoding="utf-8") as fh:
                p = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return {"error": "题目不存在: {}/{}".format(platform, pid)}
        with self.lock:
            c = self.contest_index.get((platform, str(p.get("contestId"))), {})
        return {
            "platform": platform, "id": p.get("id"), "title": p.get("title") or "",
            "titleZh": p.get("titleZh"), "contestTitle": c.get("title") or "",
            "startTime": c.get("startTime"), "url": p.get("url"),
            "difficulty": p.get("difficulty"), "tags": p.get("tags") or [],
            "translateModel": p.get("translateModel"),
            "translatedAt": p.get("translatedAt"),
            "statementMd": p.get("statementMd") or "",
            "statementZhMd": p.get("statementZhMd"),
            "samples": p.get("samples") or [],
        }

    def translated_stats(self):
        """按模型 × 平台统计已翻译题数（基于最近一次扫描的快照）。"""
        with self.lock:
            rows = self.all_problems
        out = {}
        for p in rows:
            if not p["translated"]:
                continue
            m = p.get("translateModel") or "(未知/官方原文)"
            slot = out.setdefault(m, {"total": 0, "byPlatform": {}})
            slot["total"] += 1
            slot["byPlatform"][p["platform"]] = slot["byPlatform"].get(p["platform"], 0) + 1
        return out

    # ---------- 运行 ----------

    def start(self, limit, only="untranslated", model="", q="", retranslate=False):
        """启动一轮翻译。

        only/model/q 决定队列来源：默认「全部未翻译」；retranslate=True 时从
        全量题库按筛选条件取（通常 only=translated + model=<某模型>），并且
        不跳过已有译文的题（用当前配置模型覆盖重译）。
        """
        with self.lock:
            if self.run and self.run["active"]:
                return False, "已有翻译任务在运行"
        scan = self.scan()
        with self.lock:
            if retranslate:
                rows = self.problems_page(0, 10 ** 9, only or "translated", q=q, model=model)["rows"]
                keys = {(r["platform"], str(r["id"])) for r in rows}
                queue = [p for p in self.all_problems if (p["platform"], str(p["id"])) in keys]
            else:
                queue = list(self.problems)
        if limit and limit > 0:
            queue = queue[:limit]
        if not queue:
            return False, "没有符合条件的题目"
        models = [m for m in self.cfg["models"] if m.get("model") and m.get("concurrency", 0) > 0]
        if not models:
            return False, "没有可用模型配置"
        run = {
            "active": True, "stopping": False, "limit": limit or 0,
            "id": int(time.time() * 1000),
            "cancel": CancelToken(),
            "retranslate": bool(retranslate),
            "source": {"only": only, "model": model, "q": q},
            "total": len(queue), "done": 0, "failed": 0, "skipped": 0, "cancelled": 0,
            "startedAt": time.time(), "endedAt": None,
            "lastError": None, "consec4xx": 0,
            "queue": queue, "cursor": 0,
            "current": {},   # lane → {id, title, model}
            "models": {m["model"]: {"concurrency": m["concurrency"], "requests": 0, "ok": 0,
                                    "fail": 0, "in": 0, "out": 0, "cached": 0}
                       for m in models},
            "recentFailures": deque(maxlen=12),
        }
        with self.lock:
            self.run = run
            for m, st in run["models"].items():
                acc = self.cumulative.setdefault(m, {"requests": 0, "ok": 0, "fail": 0,
                                                     "in": 0, "out": 0, "cached": 0})
        self.log("main", "开始{} {} 题（limit={}），模型：{}".format(
            "重译" if retranslate else "翻译", len(queue), limit or "全部",
            ", ".join("{}×{}".format(m["model"], m["concurrency"]) for m in models)))
        threading.Thread(target=self._run_lanes, args=(run,), daemon=True).start()
        return True, "已{} {} 题".format("重译" if retranslate else "启动", len(queue))

    def stop(self):
        """立即停止：中断所有在途请求，不再派发新题。"""
        with self.lock:
            if self.run and self.run["active"]:
                self.run["stopping"] = True
                self.run["cancel"].set()
                self.log("main", "停止指令：正在中断在途请求…")
                return True
        return False

    def _run_lanes(self, run):
        threads = []
        lane_id = 0
        for m in self.cfg["models"]:
            mcfg = self.model_cfg(m)   # 该模型的独立 baseUrl/apiKey（空则回落全局）
            for _ in range(int(m.get("concurrency", 0))):
                t = threading.Thread(target=self._worker, args=(run, m["model"], mcfg, lane_id), daemon=True)
                threads.append(t)
                lane_id += 1
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        with self.lock:
            run["active"] = False
            run["endedAt"] = time.time()
            run["current"] = {}
        self.log("main", "本轮结束：完成 {} / 失败 {} / 跳过 {} / 中断 {}（共 {}）{}".format(
            run["done"], run["failed"], run["skipped"], run.get("cancelled", 0), run["total"],
            "（已手动停止）" if run["cancel"].is_set() else ""))

    def _next_task(self, run):
        with self.lock:
            if run["stopping"] or run["cancel"].is_set():
                return None
            i = run["cursor"]
            if i >= len(run["queue"]):
                return None
            run["cursor"] = i + 1
            return run["queue"][i]

    def _worker(self, run, model, mcfg, lane):
        while True:
            task = self._next_task(run)
            if task is None:
                return
            with self.lock:
                run["current"][lane] = {"id": task["id"], "title": task["title"], "model": model}
            try:
                self._translate_one(run, model, mcfg, task, lane)
            finally:
                with self.lock:
                    run["current"].pop(lane, None)

    def _translate_one(self, run, model, mcfg, task, lane):
        rec = self._new_task("{}:{}:{}".format(run["id"], lane, task["id"]), model,
                             task["platform"], task["id"], task["title"], task["contestTitle"])
        # 执行时重读磁盘：可能已被其它进程（回填/上一轮）翻译
        try:
            with open(task["file"], encoding="utf-8") as f:
                p = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            with self.lock:
                run["failed"] += 1
                run["models"][model]["fail"] += 1
                run["recentFailures"].append({"id": task["id"], "error": str(e)})
                rec.update(status="failed", error=str(e), endedAt=time.time())
            self.log("task", "✗ {} — 读取失败 {}".format(task["id"], e))
            return
        if p.get("statementZhMd") and not run.get("retranslate"):
            with self.lock:
                run["skipped"] += 1
                rec.update(status="skipped", endedAt=time.time(), error="已有译文")
            self.log("task", "↷ {} 已有译文，跳过".format(task["id"]))
            return
        statement_md = p["statementMd"]

        def on_chunk(piece, kind="content"):
            self._append_chunk(rec, piece, kind)

        try:
            with self.lock:
                run["models"][model]["requests"] += 1
            result, usage = translate_statement(mcfg, model, p.get("title") or "", statement_md,
                                                self.log, on_chunk=on_chunk,
                                                cancel=run["cancel"], pid=task["id"])
        except Cancelled:
            with self.lock:
                run["cancelled"] += 1
                rec.update(status="cancelled", error="已手动停止", endedAt=time.time())
            self.log("task", "⏹ {} — 已中断".format(task["id"]))
            return
        except FatalError as e:
            with self.lock:
                run["failed"] += 1
                run["models"][model]["fail"] += 1
                run["lastError"] = str(e)
                run["consec4xx"] += 1
                run["recentFailures"].append({"id": task["id"], "error": str(e)})
                self.cumulative[model]["requests"] += 1
                self.cumulative[model]["fail"] += 1
                rec.update(status="failed", error=str(e), endedAt=time.time())
                if run["consec4xx"] >= CONSEC_4XX_ABORT:
                    run["stopping"] = True
            self.log("task", "✗ {} — 鉴权失败 {}: {}".format(task["id"], model, e))
            if run["stopping"]:
                self.log("main", "连续鉴权失败 ≥{}，自动停止本轮".format(CONSEC_4XX_ABORT))
            return
        except Exception as e:  # noqa: BLE001
            with self.lock:
                run["failed"] += 1
                run["models"][model]["fail"] += 1
                run["lastError"] = str(e)
                run["consec4xx"] = 0
                run["recentFailures"].append({"id": task["id"], "error": str(e)})
                rec.update(status="failed", error=str(e), endedAt=time.time())
            self.log("task", "✗ {} — {}".format(task["id"], e))
            return

        pin, pout, pcached = usage
        with self.lock:
            run["consec4xx"] = 0
            st = run["models"][model]
            st["ok"] += 1
            st["in"] += pin
            st["out"] += pout
            st["cached"] += pcached
            st["done"] = st.get("done", 0) + 1
            acc = self.cumulative.setdefault(model, {"requests": 0, "ok": 0, "fail": 0,
                                                     "in": 0, "out": 0, "cached": 0})
            acc["requests"] += 1
            acc["ok"] += 1
            acc["in"] += pin
            acc["out"] += pout
            acc["cached"] += pcached
            rec["usage"] = {"in": pin, "out": pout, "cached": pcached}
            rec["titleZh"] = result["titleZh"]

        try:
            self._save(task["file"], p, result, model)
            with self.lock:
                run["done"] += 1
                rec.update(status="done", saved=True, endedAt=time.time())
            self.log("task", "✓ {} ← {} (in {} / cached {} / out {})".format(
                task["id"], model, pin, pcached, pout))
        except Exception as e:  # noqa: BLE001
            with self.lock:
                run["failed"] += 1
                run["recentFailures"].append({"id": task["id"], "error": "保存失败: " + str(e)})
                rec.update(status="failed", saved=False, error="保存失败: " + str(e), endedAt=time.time())
            self.log("task", "✗ {} — 保存失败 {}".format(task["id"], e))

    def _save(self, file, disk_problem, result, model):
        """与磁盘现值合并后原子写回（可与 backfill-all 并行）。"""
        with self.write_lock:
            try:
                with open(file, encoding="utf-8") as f:
                    cur = json.load(f)
            except (OSError, json.JSONDecodeError):
                cur = disk_problem
            cur["titleZh"] = result["titleZh"]
            cur["statementZhMd"] = result["bodyZh"]
            cur["translatedAt"] = now_iso()
            cur["translateModel"] = model
            tmp = "{}.tmp-web-{}".format(file, os.getpid())
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp, file)

    # ---------- 状态 ----------

    def snapshot(self):
        with self.lock:
            run = self.run
            if run:
                elapsed = (run["endedAt"] or time.time()) - run["startedAt"]
                processed = run["done"] + run["failed"] + run["skipped"]
                eta = (elapsed / processed * (run["total"] - processed)) if processed and run["total"] > processed else None
                run_view = {
                    "active": run["active"], "stopping": run["stopping"],
                    "retranslate": bool(run.get("retranslate")),
                    "limit": run["limit"], "total": run["total"],
                    "done": run["done"], "failed": run["failed"], "skipped": run["skipped"],
                    "cancelled": run.get("cancelled", 0),
                    "queueLeft": max(0, len(run["queue"]) - run["cursor"]),
                    "elapsedSec": round(elapsed, 1), "etaSec": round(eta) if eta else None,
                    "lastError": run["lastError"],
                    "current": [dict(v, lane=k,
                                     taskKey="{}:{}:{}".format(run["id"], k, v["id"]))
                                for k, v in sorted(run["current"].items())],
                    "models": run["models"],
                    "recentFailures": list(run["recentFailures"]),
                    "startedAt": run["startedAt"],
                    "id": run["id"],
                }
            else:
                run_view = None
            all_n = len(self.all_problems)
            un_n = len(self.problems)
            # 按翻译模型聚合（基于扫描快照；正在翻译的增量由 run.models 补足）
            by_model = {}
            for p in self.all_problems:
                if not p["translated"]:
                    continue
                m = p.get("translateModel") or "(未知)"
                slot = by_model.setdefault(m, {"total": 0})
                slot["total"] += 1
            return {
                "config": {
                    "baseUrl": self.cfg["baseUrl"],
                    "apiKeySet": bool(self.cfg["apiKey"]),
                    "models": self.cfg["models"],
                },
                "scan": {"at": self.scan_at, "total": all_n, "untranslated": un_n,
                         "translated": all_n - un_n,
                         "byPlatform": {k: sum(1 for p in self.problems if p["platform"] == k)
                                        for k in PLATFORMS},
                         "byModel": by_model},
                "run": run_view,
                "cumulative": self.cumulative,
                "log": list(self._logs)[-40:],
            }

APP = None

# ---------------------------------------------------------------- HTTP

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#09090f">
<title>翻译控制台 · ac.isam.top</title>
<style>
/* ===== shadcn/ui 设计令牌（与主站 ac.isam.top 暗色主题一致的 oklch 变量） ===== */
:root{
  --background:oklch(0.145 0.015 274); --foreground:oklch(0.96 0.005 274);
  --card:oklch(0.19 0.018 274); --card-foreground:oklch(0.96 0.005 274);
  --popover:oklch(0.21 0.02 274); --popover-foreground:oklch(0.96 0.005 274);
  --primary:oklch(0.62 0.19 272); --primary-foreground:oklch(0.985 0.005 274);
  --secondary:oklch(0.26 0.02 274); --secondary-foreground:oklch(0.96 0.005 274);
  --muted:oklch(0.25 0.018 274); --muted-foreground:oklch(0.68 0.015 274);
  --accent:oklch(0.28 0.03 274); --accent-foreground:oklch(0.96 0.005 274);
  --destructive:oklch(0.62 0.2 25); --destructive-foreground:oklch(0.985 0.005 274);
  --success:oklch(0.72 0.17 155); --warning:oklch(0.79 0.15 85);
  --border:oklch(0.28 0.02 274); --input:oklch(0.28 0.02 274); --ring:oklch(0.62 0.19 272);
  --radius:0.625rem;
  --safe-b:env(safe-area-inset-bottom,0px);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;border-color:var(--border)}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:20px 16px calc(64px + var(--safe-b))}
h1{font-size:1.15rem;font-weight:600;letter-spacing:-.01em;margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
h1 .sub{color:var(--muted-foreground);font-size:12.5px;font-weight:400}
.muted{color:var(--muted-foreground)} .ok{color:var(--success)} .err{color:var(--destructive)} .warn{color:var(--warning)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
/* ===== 卡片 ===== */
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);
  border-radius:var(--radius);box-shadow:0 1px 2px oklch(0 0 0 / .35)}
.card-h{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.card-h b{font-size:14px;font-weight:600}
.card-c{padding:16px 18px}
.grid{display:grid;gap:14px}
@media(min-width:900px){.grid.cols-2{grid-template-columns:1fr 1fr}}
/* ===== 按钮 ===== */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;
  border-radius:calc(var(--radius) - 2px);font-size:13px;font-weight:500;height:36px;padding:0 14px;
  cursor:pointer;transition:background .15s,border-color .15s,color .15s;user-select:none;
  background:var(--primary);color:var(--primary-foreground);border:1px solid var(--primary)}
.btn:hover{filter:brightness(1.1)} .btn:active{filter:brightness(.95)}
.btn.secondary{background:var(--secondary);color:var(--secondary-foreground);border-color:var(--border)}
.btn.secondary:hover{background:var(--accent)}
.btn.outline{background:transparent;color:var(--foreground);border:1px solid var(--input)}
.btn.outline:hover{background:var(--accent)}
.btn.ghost{background:transparent;color:var(--foreground);border:1px solid transparent}
.btn.ghost:hover{background:var(--accent)}
.btn.destructive{background:transparent;color:var(--destructive);border:1px solid color-mix(in oklab,var(--destructive) 45%,transparent)}
.btn.destructive:hover{background:color-mix(in oklab,var(--destructive) 14%,transparent)}
.btn.sm{height:30px;padding:0 10px;font-size:12px}
.btn.icon{width:32px;height:32px;padding:0}
.btn:disabled{opacity:.5;cursor:not-allowed;pointer-events:none}
/* ===== 表单 ===== */
.input,.select,.textarea{width:100%;background:transparent;border:1px solid var(--input);
  border-radius:calc(var(--radius) - 2px);padding:7px 12px;font:inherit;font-size:13px;color:var(--foreground);
  outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.input:focus,.select:focus,.textarea:focus{border-color:var(--ring);box-shadow:0 0 0 2px color-mix(in oklab,var(--ring) 30%,transparent)}
.select{appearance:none;-webkit-appearance:none;padding-right:28px;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b93a7' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center}
label.f{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted-foreground)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
/* ===== 徽章 ===== */
.badge{display:inline-flex;align-items:center;gap:4px;border-radius:9999px;
  border:1px solid var(--border);padding:1px 8px;font-size:11px;font-weight:500;line-height:1.5;white-space:nowrap;
  color:var(--muted-foreground);background:var(--secondary)}
.badge.primary{background:color-mix(in oklab,var(--primary) 18%,transparent);color:var(--primary);border-color:color-mix(in oklab,var(--primary) 40%,transparent)}
.badge.outline{background:transparent}
.badge.success{background:color-mix(in oklab,var(--success) 15%,transparent);color:var(--success);border-color:color-mix(in oklab,var(--success) 40%,transparent)}
.badge.warn{background:color-mix(in oklab,var(--warning) 15%,transparent);color:var(--warning);border-color:color-mix(in oklab,var(--warning) 40%,transparent)}
.badge.destr{background:color-mix(in oklab,var(--destructive) 15%,transparent);color:var(--destructive);border-color:color-mix(in oklab,var(--destructive) 40%,transparent)}
/* ===== 表格 ===== */
.tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:calc(var(--radius) - 2px)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--muted-foreground);text-align:left;font-weight:500;padding:8px 10px;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--card)}
td{padding:7px 10px;border-bottom:1px solid color-mix(in oklab,var(--border) 55%,transparent);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr.click{cursor:pointer}
tbody tr.click:hover td{background:var(--accent)}
tbody tr.sel td{background:color-mix(in oklab,var(--primary) 10%,transparent)}
/* ===== Tabs ===== */
.tabs{display:inline-flex;background:var(--muted);border-radius:calc(var(--radius) - 2px);padding:3px;gap:2px}
.tab{border:none;background:transparent;color:var(--muted-foreground);font:inherit;font-size:12.5px;font-weight:500;
  padding:5px 12px;border-radius:calc(var(--radius) - 4px);cursor:pointer;transition:.15s;white-space:nowrap}
.tab.active{background:var(--card);color:var(--foreground);box-shadow:0 1px 3px oklch(0 0 0/.3)}
/* ===== 统计块 ===== */
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
.stat .s{background:var(--muted);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:10px 12px}
.stat .s b{font-size:1.35rem;font-weight:600;display:block;line-height:1.3;letter-spacing:-.02em}
.stat .s span{color:var(--muted-foreground);font-size:11.5px}
/* ===== 进度条 ===== */
.progress{height:8px;background:var(--muted);border-radius:9999px;overflow:hidden}
.progress>i{display:block;height:100%;background:var(--primary);border-radius:9999px;transition:width .5s}
/* ===== 日志 ===== */
.log{background:oklch(0.13 0.012 274);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);
  padding:10px 12px;height:190px;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;color:oklch(0.75 0.015 274);word-break:break-all}
/* ===== Sheet 抽屉 ===== */
.sheet-mask{position:fixed;inset:0;background:oklch(0 0 0/.6);display:none;z-index:60;backdrop-filter:blur(2px)}
.sheet{position:fixed;top:0;right:0;height:100%;width:min(820px,100%);background:var(--card);
  border-left:1px solid var(--border);display:flex;flex-direction:column;z-index:61;
  transform:translateX(103%);transition:transform .2s ease;box-shadow:-16px 0 48px oklch(0 0 0/.45)}
.sheet.open{transform:none}
.sheet-h{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0}
.sheet-h .t{flex:1;min-width:0}
.sheet-h .t b{display:block;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sheet-h .t span{font-size:12px;color:var(--muted-foreground);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sheet-b{flex:1;overflow:auto;padding:16px;-webkit-overflow-scrolling:touch}
.sheet-f{display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0;flex-wrap:wrap;align-items:center}
/* ===== 题面渲染 ===== */
.stmt{font-size:13.5px;line-height:1.75;word-break:break-word;color:var(--foreground)}
.stmt h1,.stmt h2,.stmt h3{font-size:1.05em;font-weight:600;margin:1.2em 0 .5em;color:var(--foreground)}
.stmt p{margin:.6em 0}
.stmt code{background:var(--muted);border-radius:4px;padding:1px 5px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}
.stmt pre{background:oklch(0.13 0.012 274);border:1px solid var(--border);border-radius:8px;padding:10px 12px;overflow:auto}
.stmt pre code{background:transparent;padding:0}
.stmt a{color:var(--primary);text-decoration:underline;text-underline-offset:2px}
.stmt img{max-width:100%;border-radius:8px}
.stmt blockquote{border-left:3px solid var(--border);margin:.6em 0;padding:.2em .8em;color:var(--muted-foreground)}
.stmt ul,.stmt ol{padding-left:1.4em;margin:.5em 0}
.stmt table{border:1px solid var(--border)}
.stmt td,.stmt th{padding:4px 8px}
.stmt .math{color:var(--warning);font-family:ui-monospace,Menlo,monospace;font-size:.92em}
.chat{font:12.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:oklch(0.8 0.01 274)}
.chat .cur{display:inline-block;width:7px;height:13px;background:var(--primary);vertical-align:-2px;animation:blink 1s steps(2) infinite}
@keyframes blink{50%{opacity:0}}
/* ===== 其他 ===== */
.current{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.current .c{background:var(--muted);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);
  padding:5px 10px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px}
.current .c:hover{border-color:var(--ring)}
.mrow{display:grid;grid-template-columns:1fr 64px 32px;gap:6px;align-items:center}
.mrow2{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.mcard{border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:9px 10px;margin-bottom:8px;background:var(--muted)}
@media(max-width:720px){.mrow{grid-template-columns:1fr 56px 34px}.mrow2{grid-template-columns:1fr}}
.mrow .del{width:32px;height:32px;padding:0;color:var(--destructive);background:transparent;border:1px solid color-mix(in oklab,var(--destructive) 35%,transparent);border-radius:calc(var(--radius) - 2px)}
.mrow .del:hover{background:color-mix(in oklab,var(--destructive) 14%,transparent)}
.hide-sm{display:revert}
@media(max-width:720px){.hide-sm{display:none!important}}
#toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + var(--safe-b));
  background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:var(--radius);
  padding:10px 16px;max-width:min(460px,90vw);display:none;z-index:80;box-shadow:0 8px 30px oklch(0 0 0/.5);font-size:13px}
.pager{display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:720px){
  .wrap{padding:12px 10px calc(56px + var(--safe-b))}
  .card-h,.card-c{padding:12px 14px}
  .stat{grid-template-columns:repeat(2,1fr)}
  .stat .s b{font-size:1.15rem}
  .btn{height:38px}
  .btn.sm{height:34px}
  .mrow{grid-template-columns:1fr 56px 34px}
  .log{height:140px;font-size:11px}
  .tab{padding:6px 10px;font-size:12px}
  .sheet{transition:transform .16s ease}
}
</style>
</head>
<body>
<div class="wrap">
  <div id="fatalBar" style="display:none;background:color-mix(in oklab,var(--destructive) 12%,var(--card));border:1px solid color-mix(in oklab,var(--destructive) 40%,transparent);color:var(--destructive);border-radius:var(--radius);padding:9px 14px;margin-bottom:12px;font-size:12.5px"></div>

  <h1>AI 翻译控制台 <span class="sub">ac.isam.top · 未翻译题面按比赛时间倒序翻译</span></h1>

  <div class="stat" style="margin:14px 0 16px" id="topStats"></div>

  <!-- ============ Tab: 翻译 ============ -->
  <div class="grid" id="tab-translate">
  <div class="card">
    <div class="card-h"><b>端点与模型</b>
      <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
        <button class="btn outline sm" id="btnSave">保存配置</button>
        <button class="btn outline sm" id="btnPing">测试连接</button>
      </span>
    </div>
    <div class="card-c">
      <div class="row" style="margin-bottom:12px">
        <label class="f" style="flex:1;min-width:220px">API Base URL<input class="input mono" id="baseUrl" placeholder="http://127.0.0.1:3425/v1"></label>
        <label class="f" style="flex:0 0 170px">API Key（可空）<input class="input" id="apiKey" type="password" placeholder="留空不发送" autocomplete="off"></label>
        <span id="pingResult" class="mono muted" style="flex:1;min-width:140px;padding-bottom:8px"></span>
      </div>
      <div class="row" style="margin-bottom:6px">
        <span class="muted" style="font-size:12px;font-weight:500">模型与并发（可任意增删）</span>
        <button class="btn ghost sm" id="btnAddModel">＋ 添加模型</button>
        <button class="btn ghost sm" id="btnLoadModels">从端点加载清单</button>
        <span id="modelHint" class="muted" style="font-size:11.5px;align-self:center"></span>
      </div>
      <div id="modelRows"></div>
      <datalist id="modelList"></datalist>
      <div id="saveHint" class="muted" style="font-size:11.5px;margin-top:2px"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><b>翻译任务</b>
      <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
        <button class="btn ghost sm" id="btnScan">重新扫描</button>
        <button class="btn destructive sm" id="btnStop">停止</button>
        <button class="btn sm" id="btnStart">开始翻译</button>
      </span>
    </div>
    <div class="card-c">
      <div class="row" style="margin-bottom:4px">
        <label class="f">本次翻译数量
          <select class="select" id="limit" style="width:170px">
            <option value="50">50 题</option>
            <option value="200">200 题</option>
            <option value="500">500 题</option>
            <option value="1000">1000 题</option>
            <option value="0" selected>全部未翻译</option>
          </select>
        </label>
        <span class="muted" id="scanInfo" style="font-size:12px;flex:1;min-width:200px;padding-bottom:8px"></span>
      </div>
      <div id="runBox"></div>
      <div id="modelStats" style="margin-top:12px"></div>
    </div>
  </div>
  </div>

  <!-- ============ Tab: 任务 ============ -->
  <div class="card" id="tab-tasks" style="display:none">
    <div class="card-h"><b>任务记录</b><span class="muted" style="font-size:11.5px">点击任意一行查看流式对话原文</span></div>
    <div class="card-c">
      <div class="tbl-wrap" style="max-height:420px">
        <table><thead><tr>
          <th>状态</th><th>平台</th><th>题目</th><th class="hide-sm">模型</th><th class="hide-sm">输出</th><th class="hide-sm">思考</th><th class="hide-sm">用时</th>
        </tr></thead><tbody id="taskBody"></tbody></table>
      </div>
    </div>
  </div>

  <!-- ============ Tab: 题库 ============ -->
  <div class="card" id="tab-bank" style="display:none">
    <div class="card-h"><b>题库</b>
      <span class="muted" style="font-size:11.5px" id="bankHint"></span>
    </div>
    <div class="card-c">
      <div class="row" style="margin-bottom:10px">
        <div class="tabs" id="bankTabs">
          <button class="tab" data-v="translated">已翻译</button>
          <button class="tab active" data-v="untranslated">未翻译</button>
          <button class="tab" data-v="all">全部</button>
        </div>
        <select class="select" id="bankModel" style="width:auto;min-width:170px;display:none"><option value="">全部翻译模型</option></select>
        <input class="input" id="bankQ" placeholder="搜索 题号 / 标题 / 比赛…" style="flex:1;min-width:160px">
        <button class="btn outline sm" id="btnBankGo">搜索</button>
        <button class="btn secondary sm" id="btnRetrans" style="display:none">⟳ 重译本组</button>
      </div>
      <div class="tbl-wrap" style="max-height:480px">
        <table><thead><tr id="bankHead">
          <th>日期</th><th>平台</th><th class="hide-sm">比赛</th><th>题目</th><th class="hide-sm">题号</th><th>状态</th><th class="hide-sm">翻译模型</th>
        </tr></thead><tbody id="bankBody"></tbody></table>
      </div>
      <div class="pager">
        <button class="btn outline sm" id="btnPrev">← 上一页</button>
        <button class="btn outline sm" id="btnNext">下一页 →</button>
        <span id="pageInfo" class="muted mono" style="font-size:11.5px"></span>
      </div>
    </div>
  </div>

  <!-- ============ Tab: 日志 ============ -->
  <div class="card" id="tab-logs" style="display:none">
    <div class="card-h"><b>运行日志</b><span class="muted" style="font-size:11.5px">最近 40 条</span></div>
    <div class="card-c"><div class="log" id="logBox"></div></div>
  </div>

  <!-- 顶部 Tab 切换 -->
  <div style="position:sticky;bottom:calc(12px + var(--safe-b));display:flex;justify-content:center;margin-top:16px;z-index:50">
    <div class="tabs" id="mainTabs" style="box-shadow:0 4px 24px oklch(0 0 0/.45)">
      <button class="tab active" data-v="translate">翻译</button>
      <button class="tab" data-v="tasks">任务记录</button>
      <button class="tab" data-v="bank">题库</button>
      <button class="tab" data-v="logs">日志</button>
    </div>
  </div>
</div>

<div class="sheet-mask" id="mask"></div>
<div class="sheet" id="drawer">
  <div class="sheet-h">
    <div class="t"><b id="dtTitle">任务</b><span id="dtMeta" class="mono"></span></div>
    <button class="btn ghost sm" id="btnClose">关闭 ✕</button>
  </div>
  <div style="padding:8px 16px 0;border-bottom:1px solid var(--border);flex-shrink:0">
    <div class="tabs" id="dtTabs">
      <button class="tab active" data-v="content">输出</button>
      <button class="tab" data-v="reasoning">思考过程</button>
    </div>
  </div>
  <div class="sheet-b"><div class="chat" id="dtBody"></div></div>
  <div class="sheet-f">
    <span id="dtStatus" class="mono muted" style="flex:1;min-width:180px"></span>
    <label class="row" style="gap:5px;font-size:12px;color:var(--muted-foreground);align-items:center"><input type="checkbox" id="dtFollow" checked style="width:auto"> 跟随</label>
    <button class="btn outline sm" id="dtJump">跳到末尾</button>
  </div>
</div>

<!-- 题面查看 Sheet -->
<div class="sheet" id="psheet" style="z-index:62">
  <div class="sheet-h">
    <div class="t">
      <b id="pdTitle">题面</b>
      <span id="pdMeta" class="muted mono"></span>
      <span id="pdBadges" style="display:inline-flex;gap:5px;flex-wrap:wrap;margin-top:5px"></span>
    </div>
    <button class="btn ghost sm" id="pdClose">关闭 ✕</button>
  </div>
  <div class="sheet-b">
    <div class="tabs" style="margin-bottom:12px" id="pdTabs">
      <button class="tab active" data-v="zh">中文译文</button>
      <button class="tab" data-v="orig">原文</button>
    </div>
    <div class="stmt" id="pdBody"></div>
  </div>
  <div class="sheet-f">
    <a id="pdLink" class="btn outline sm" target="_blank" rel="noreferrer" href="#">在原站打开</a>
    <a id="pdSite" class="btn outline sm" target="_blank" rel="noreferrer" href="#">在题库站打开</a>
    <button class="btn secondary sm" id="pdCopy">复制译文</button>
  </div>
</div>
<div id="toast"></div>

<script>
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtN=n=>(n??0).toLocaleString("en-US");
const fmtT=s=>s==null?"—":(s>=3600?(s/3600).toFixed(1)+"h":s>=60?Math.round(s/60)+"m":Math.round(s)+"s");
const fmtTs=ts=>{if(!ts)return "—";const d=new Date(ts);return isNaN(d)?"—":d.toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})};
const PL={atcoder:"AtCoder",codeforces:"CF",nowcoder:"牛客"};
const PC={atcoder:"success",codeforces:"primary",nowcoder:"warn"};
const SC={running:["primary","进行中"],done:["success","完成"],failed:["destr","失败"],skipped:["outline","跳过"],cancelled:["outline","已中断"]};
function badge(cls,txt){return '<span class="badge '+cls+'">'+esc(txt)+'</span>'}
function toast(msg){const t=$("#toast");t.textContent=msg;t.style.display="block";clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",3200)}
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{"Content-Type":"application/json"}},opt));let j={};try{j=await r.json()}catch(e){j={error:"HTTP "+r.status}};if(j.error)toast(j.error);return j}

/* ================= Tab 切换 ================= */
function showTab(v){
  $$("#mainTabs .tab").forEach(t=>t.classList.toggle("active",t.dataset.v===v));
  $("#tab-translate").style.display=v==="translate"?"":"none";
  $("#tab-tasks").style.display=v==="tasks"?"":"none";
  $("#tab-bank").style.display=v==="bank"?"":"none";
  $("#tab-logs").style.display=v==="logs"?"":"none";
  if(v==="tasks")loadTasks();
  if(v==="bank")loadBank();
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("#mainTabs .tab").forEach(t=>t.onclick=()=>showTab(t.dataset.v));

/* ================= 模型配置 ================= */
let cfgModels=[{model:"zcode/GLM-5.3-Flash",concurrency:3}];
let modelsDirty=false;
function renderModels(){
  const box=$("#modelRows");box.innerHTML="";
  cfgModels.forEach((m,i)=>{
    const card=document.createElement("div");card.className="mcard";
    const row=document.createElement("div");row.className="mrow";
    const inp=document.createElement("input");inp.className="input mono";inp.value=m.model;inp.placeholder="provider/model-name";inp.setAttribute("list","modelList");
    inp.oninput=()=>{cfgModels[i].model=inp.value.trim();modelsDirty=true};
    const cc=document.createElement("input");cc.className="input mono";cc.type="number";cc.min="1";cc.max="200";cc.value=m.concurrency;cc.title="并发数（最大 200）";
    cc.oninput=()=>{cfgModels[i].concurrency=Math.max(1,Math.min(200,+cc.value||1));modelsDirty=true};
    const del=document.createElement("button");del.className="del";del.textContent="✕";del.title="删除此模型";
    del.onclick=()=>{if(cfgModels.length<=1){toast("至少保留一个模型");return}cfgModels.splice(i,1);modelsDirty=true;renderModels()};
    row.append(inp,cc,del);
    const row2=document.createElement("div");row2.className="mrow2";
    const bu=document.createElement("input");bu.className="input mono";bu.value=m.baseUrl||"";bu.placeholder="独立 API URL（空 = 用全局）";
    bu.oninput=()=>{cfgModels[i].baseUrl=bu.value.trim();modelsDirty=true};
    const ak=document.createElement("input");ak.className="input mono";ak.type="password";ak.value=m.apiKey||"";ak.placeholder="独立 API Key（空 = 用全局）";ak.autocomplete="off";
    ak.oninput=()=>{cfgModels[i].apiKey=ak.value;modelsDirty=true};
    row2.append(bu,ak);
    card.append(row,row2);box.appendChild(card);
  });
  const total=cfgModels.reduce((a,m)=>a+(+m.concurrency||0),0);
  $("#modelHint").textContent=cfgModels.length+" 个模型 · 总并发 "+total+(total>200?"（注意并发过高可能被端点限流）":"");
}
$("#btnAddModel").onclick=()=>{cfgModels.push({model:"",concurrency:1});modelsDirty=true;renderModels()};
$("#btnLoadModels").onclick=async()=>{
  $("#btnLoadModels").disabled=true;
  const j=await api("/api/models");
  $("#btnLoadModels").disabled=false;
  if(!j.models||!j.models.length){toast("端点未返回模型清单");return}
  $("#modelList").innerHTML=j.models.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join("");
  toast("已载入 "+j.models.length+" 个模型，输入框可下拉选择");
};
async function saveConfig(silent){
  const j=await api("/api/config",{method:"POST",body:JSON.stringify({baseUrl:$("#baseUrl").value.trim(),apiKey:$("#apiKey").value,models:cfgModels})});
  if(j.config){cfgModels=j.config.models;modelsDirty=false;renderModels();$("#apiKey").value="";
    $("#saveHint").textContent="已保存 "+new Date().toLocaleTimeString("zh-CN")+" · key "+(j.config.apiKeySet?"已设置":"为空");
    if(!silent)toast("配置已保存，下一轮生效")}
  return j;
}
$("#btnSave").onclick=()=>saveConfig(false);
$("#btnPing").onclick=async()=>{
  $("#pingResult").textContent="测试中…";$("#btnPing").disabled=true;
  const j=await api("/api/ping",{method:"POST",body:JSON.stringify({baseUrl:$("#baseUrl").value.trim(),apiKey:$("#apiKey").value,models:cfgModels})});
  $("#btnPing").disabled=false;
  $("#pingResult").innerHTML=j.ok?'<span class="ok">✓ 可用 · '+esc(j.model)+" · "+j.latencyMs+"ms</span>":'<span class="err">✗ '+esc((j.error||"失败").slice(0,70))+"</span>";
};

/* ================= 任务控制 ================= */
$("#btnStart").onclick=async()=>{if(modelsDirty)await saveConfig(true);const j=await api("/api/start",{method:"POST",body:JSON.stringify({limit:+$("#limit").value})});if(j.message)toast(j.message);showTab("translate");refresh()};
$("#btnStop").onclick=async()=>{await api("/api/stop",{method:"POST"});toast("停止中…")};
$("#btnScan").onclick=async()=>{toast("扫描中…");const j=await api("/api/scan",{method:"POST"});if(!j.error){toast("全量 "+fmtN(j.total)+" 题 · 未翻译 "+fmtN(j.untranslated));loadBank()}refresh()};

/* ================= 主状态轮询 ================= */
let lastLogLen=0,lastRunField="",lastScanJson="";
async function refresh(){
  const s=await fetch("/api/state").then(r=>r.json()).catch(()=>null);
  if(!s)return;
  if(document.activeElement!==$("#baseUrl"))$("#baseUrl").value=s.config.baseUrl;
  if(!modelsDirty&&JSON.stringify(cfgModels)!==JSON.stringify(s.config.models)){cfgModels=s.config.models.map(m=>({...m}));renderModels()}
  const sc=s.scan;
  // 顶部统计
  const topHtml=
    '<div class="s"><b>'+fmtN(sc.total)+'</b><span>题库总题数</span></div>'+
    '<div class="s"><b class="ok">'+fmtN(sc.translated)+'</b><span>已翻译</span></div>'+
    '<div class="s"><b class="warn">'+fmtN(sc.untranslated)+'</b><span>未翻译</span></div>'+
    '<div class="s"><b>'+Object.keys(sc.byModel||{}).length+'</b><span>翻译模型数</span></div>'+
    (s.run&&s.run.active?'<div class="s"><b class="ok">'+fmtN(s.run.done)+'</b><span>本轮已完成</span></div>':'');
  if(topHtml!==lastScanJson){$("#topStats").innerHTML=topHtml;lastScanJson=topHtml;
    $("#scanInfo").textContent="未翻译 "+fmtN(sc.untranslated)+"（AtCoder "+fmtN(sc.byPlatform.atcoder||0)+" / CF "+fmtN(sc.byPlatform.codeforces||0)+" / 牛客 "+fmtN(sc.byPlatform.nowcoder||0)+"）";
    fillModelFilter(sc.byModel||{});
    const hm=Object.entries(sc.byModel||{}).map(([m,c])=>'<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><span class="badge outline mono" style="max-width:230px;overflow:hidden;text-overflow:ellipsis">'+esc(m)+'</span><b style="font-size:12px">'+fmtN(c.total)+'</b></div>').join("");
    $("#modelStats").innerHTML=hm?'<div style="font-size:12px;color:var(--muted-foreground);margin-bottom:4px;font-weight:500">已翻译题面的翻译模型分布</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 14px">'+hm+'</div>':"";
  }
  // 运行框
  const r=s.run,box=$("#runBox");
  if(!r){box.innerHTML='<div class="muted" style="font-size:12.5px">当前没有翻译任务 — 选择数量后点「开始翻译」。</div>'}
  else{
    const processed=r.done+r.failed+r.skipped+(r.cancelled||0);
    const pct=r.total?Math.round(processed/r.total*100):0;
    const rk=r.id+":"+r.done+":"+r.failed+":"+(r.cancelled||0)+":"+r.active+":"+(r.current||[]).map(c=>c.id).join(",");
    if(rk!==lastRunField){
      lastRunField=rk;
      box.innerHTML=
        '<div class="stat">'+
        '<div class="s"><b class="ok">'+fmtN(r.done)+'</b><span>已完成'+(r.skipped?'（跳过 '+fmtN(r.skipped)+'）':'')+'</span></div>'+
        '<div class="s"><b class="'+(r.failed?'err':'')+'">'+fmtN(r.failed)+'</b><span>失败</span></div>'+
        '<div class="s"><b>'+fmtN(r.cancelled||0)+'</b><span>已中断</span></div>'+
        '<div class="s"><b>'+fmtN(r.total)+'</b><span>'+(r.retranslate?'⟳ 重译':'本轮共')+(r.limit?'（限 '+fmtN(r.limit)+'）':'')+'</span></div>'+
        '<div class="s"><b>'+fmtT(r.elapsedSec)+'</b><span>'+(r.etaSec!=null?'预计还需 '+fmtT(r.etaSec):'已用时')+'</span></div>'+
        '<div class="s"><b>'+(r.active?(r.stopping?'<span class="warn">停止中</span>':'<span class="ok">运行中</span>'):'已结束')+'</b><span>状态</span></div>'+
        '</div>'+
        '<div class="progress" style="margin-top:12px"><i style="width:'+pct+'%"></i></div>'+
        '<div class="muted mono" style="margin-top:5px;font-size:11.5px">'+pct+'% · '+fmtN(processed)+'/'+fmtN(r.total)+(r.lastError?' · <span class="err">'+esc(r.lastError.slice(0,70))+'</span>':'')+'</div>'+
        ((r.current&&r.current.length)?'<div class="current">'+r.current.map(c=>
          '<div class="c" data-key="'+esc(c.taskKey)+'"><span class="badge outline mono">L'+c.lane+'</span><b class="mono" style="font-size:11.5px">'+esc(c.id)+'</b><span class="muted">'+esc((c.title||"").slice(0,16))+'</span><span class="badge primary">看流</span></div>').join("")+'</div>':"");
      box.querySelectorAll(".current .c").forEach(el=>el.onclick=()=>openTask(el.dataset.key));
    }
    // 本轮 token 表
    const ms=r.models;
    const rows=Object.keys(ms).map(m=>{
      const t=ms[m],ci=t.in?Math.round(t.cached/t.in*100):0;
      return "<tr><td class='mono' style='word-break:break-all'>"+esc(m)+" ×"+t.concurrency+"</td><td>"+fmtN(t.ok)+" / "+(t.fail?'<span class="err">'+fmtN(t.fail)+"</span>":"0")+"</td><td class='mono'>"+fmtN(t.in)+(t.cached?' <span class="muted">（缓存 '+fmtN(t.cached)+" · "+ci+"%）</span>":"")+"</td><td class='mono'>"+fmtN(t.out)+"</td></tr>";
    }).join("");
    $("#runBox").insertAdjacentHTML("beforeend",
      '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>本轮模型</th><th>成功/失败</th><th>输入 tokens</th><th>输出 tokens</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="4" class="muted">尚未开始</td></tr>')+'</tbody></table></div>'+
      (()=>{const cu=s.cumulative||{},ks=Object.keys(cu);if(!ks.length)return "";
        const ti=ks.reduce((a,k)=>a+cu[k].in,0),to=ks.reduce((a,k)=>a+cu[k].out,0),tc=ks.reduce((a,k)=>a+cu[k].cached,0);
        return '<div class="muted" style="margin-top:6px;font-size:11.5px">累计（自进程启动）：输入 '+fmtN(ti)+"（缓存读 "+fmtN(tc)+"）· 输出 "+fmtN(to)+" tokens</div>"})());
  }
  const lb=$("#logBox");const lg=s.log||[];
  if(lg.length!==lastLogLen){const near=lb.scrollTop+lb.clientHeight>=lb.scrollHeight-40;lb.textContent=lg.join("\n");if(near)lb.scrollTop=lb.scrollHeight;lastLogLen=lg.length}
}
function fillModelFilter(byModel){
  const sel=$("#bankModel");const cur=sel.value;
  const opts='<option value="">全部翻译模型</option>'+Object.keys(byModel).sort().map(m=>'<option value="'+esc(m)+'">'+esc(m)+'（'+fmtN(byModel[m].total)+'）</option>').join("");
  if(sel.innerHTML!==opts){sel.innerHTML=opts;sel.value=cur}
}

/* ================= 任务记录 ================= */
async function loadTasks(){
  const j=await fetch("/api/tasks").then(r=>r.json()).catch(()=>null);
  if(!j)return;
  $("#taskBody").innerHTML=(j.tasks||[]).map(t=>{
    const dur=t.endedAt?(t.endedAt-t.startedAt):(Date.now()/1000-t.startedAt);
    const [sc,sl]=SC[t.status]||["outline",t.status];
    return "<tr data-key='"+esc(t.key)+"' class='click"+(drawerKey===t.key?" sel":"")+"'>"+
      "<td>"+badge(sc,sl)+"</td>"+
      "<td>"+badge(PC[t.platform]||"outline",PL[t.platform]||t.platform)+"</td>"+
      "<td><b class='mono' style='font-size:12px'>"+esc(t.id)+"</b> "+esc((t.title||"").slice(0,32))+"</td>"+
      "<td class='mono muted hide-sm' style='word-break:break-all'>"+esc(t.model)+"</td>"+
      "<td class='mono muted hide-sm'>"+fmtN(t.outLen)+" ch</td>"+
      "<td class='mono muted hide-sm'>"+(t.rsLen?fmtN(t.rsLen)+" ch":"—")+"</td>"+
      "<td class='mono muted hide-sm'>"+fmtT(dur)+"</td></tr>";
  }).join("")||'<tr><td colspan="7" class="muted">还没有任务</td></tr>';
  $("#taskBody").querySelectorAll("tr[data-key]").forEach(tr=>tr.onclick=()=>openTask(tr.dataset.key));
}

/* ================= 任务流式 Sheet（输出 + 思考过程） ================= */
let drawerKey=null,drawerCursor=0,drawerTimer=null,drawerText="",drawerRText="",drawerRCursor=0,drawerView="content";
function openTask(key){
  if(!key){toast("任务记录不存在或已被回收");return}
  drawerKey=key;drawerCursor=0;drawerRText="";drawerRCursor=0;drawerText="";drawerView="content";
  $("#dtTabs").querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.v==="content"));
  $("#mask").style.display="block";$("#drawer").classList.add("open");
  document.body.style.overflow="hidden";
  pollTask(true);
  clearInterval(drawerTimer);
  drawerTimer=setInterval(()=>pollTask(false),700);
}
$$("#dtTabs .tab").forEach(t=>t.onclick=()=>{drawerView=t.dataset.v;$$("#dtTabs .tab").forEach(x=>x.classList.toggle("active",x===t));renderDrawer()});
function closeDrawer(){
  $("#mask").style.display="none";$("#drawer").classList.remove("open");
  document.body.style.overflow="";
  clearInterval(drawerTimer);drawerTimer=null;drawerKey=null;
  $$("#taskBody tr.sel").forEach(tr=>tr.classList.remove("sel"));
}
$("#btnClose").onclick=closeDrawer;
$("#mask").onclick=closeDrawer;
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if($("#psheet").classList.contains("open"))closeProblem();else if(drawerKey)closeDrawer()}});
async function pollTask(first){
  if(!drawerKey)return;
  const j=await fetch("/api/task?key="+encodeURIComponent(drawerKey)+"&cursor="+drawerCursor+"&rcursor="+drawerRCursor).then(r=>r.json()).catch(()=>null);
  if(!j||j.error)return;
  if(first||j.nextCursor<drawerCursor){drawerText="";drawerCursor=0}
  if(first||j.nextRCursor<drawerRCursor){drawerRText="";drawerRCursor=0}
  if(j.text)drawerText+=j.text;
  if(j.rtext)drawerRText+=j.rtext;
  drawerCursor=j.nextCursor;drawerRCursor=j.nextRCursor;
  const t=j.task,[sc,sl]=SC[t.status]||["outline",t.status];
  $("#dtTitle").textContent=sl+" · "+t.id+" "+(t.title||"");
  $("#dtMeta").textContent=t.model+" · "+(t.contestTitle||"")+" · 输出 "+fmtN(t.outLen)+" 字符"+(t.rsLen?" · 思考 "+fmtN(t.rsLen)+" 字符":"");
  const dur=t.endedAt?(t.endedAt-t.startedAt):(Date.now()/1000-t.startedAt);
  $("#dtStatus").innerHTML=badge(sc,sl)+" "+fmtT(dur)+
    (t.usage?" · in "+fmtN(t.usage.in)+(t.usage.cached?" / 缓存 "+fmtN(t.usage.cached):"")+" / out "+fmtN(t.usage.out):"")+
    (t.error?' · <span class="err">'+esc(String(t.error).slice(0,80))+"</span>":"");
  const dtTabR=$("#dtTabs .tab[data-v='reasoning']");
  if(dtTabR)dtTabR.textContent="思考过程"+(t.rsLen?"（"+fmtN(t.rsLen)+"）":"");
  renderDrawer(t.status==="running");
}
function renderDrawer(running){
  const box=$("#dtBody");
  const src=drawerView==="reasoning"?drawerRText:drawerText;
  const near=box.scrollTop+box.clientHeight>=box.scrollHeight-80;
  const show=src.length>60000?src.slice(-60000):src;
  const empty=drawerView==="reasoning"
    ?'等待思考过程…（模型不输出 reasoning_content 时此页保持为空）'
    :'等待模型首个 token…';
  box.innerHTML=esc(show)+((running&&drawerView==="content")?'<span class="cur"></span>':'')+(!src?'<span class="muted">'+empty+'</span>':'');
  if($("#dtFollow").checked||near)box.scrollTop=box.scrollHeight;
}
$("#dtJump").onclick=()=>{$("#dtFollow").checked=true;$("#dtBody").scrollTop=$("#dtBody").scrollHeight};

/* ================= 题库 ================= */
let bankOnly="untranslated",bankOffset=0,bankQ="",bankModel="";
const PAGE_SIZE=50;
$$("#bankTabs .tab").forEach(t=>t.onclick=()=>{
  bankOnly=t.dataset.v;bankOffset=0;
  $$("#bankTabs .tab").forEach(x=>x.classList.toggle("active",x===t));
  $("#bankModel").style.display=bankOnly==="untranslated"?"none":"";
  loadBank();
});
$("#btnRetrans").onclick=async()=>{
  const n=$("#btnRetrans").dataset.n||"?";
  if(!confirm("用当前配置的模型重新翻译本组 "+n+" 题？已有译文会被覆盖。"))return;
  const j=await api("/api/start",{method:"POST",body:JSON.stringify({limit:0,retranslate:true,only:bankOnly,model:bankModel,q:bankQ})});
  if(j.message){toast(j.message);showTab("translate");refresh()}
};
$("#btnBankGo").onclick=()=>{bankQ=$("#bankQ").value.trim();bankModel=$("#bankModel").value;bankOffset=0;loadBank()};
$("#bankQ").onkeydown=e=>{if(e.key==="Enter")$("#btnBankGo").onclick()};
$("#bankModel").onchange=()=>{bankModel=$("#bankModel").value;bankOffset=0;loadBank()};
$("#btnPrev").onclick=()=>{bankOffset=Math.max(0,bankOffset-PAGE_SIZE);loadBank()};
$("#btnNext").onclick=()=>{bankOffset+=PAGE_SIZE;loadBank()};
async function loadBank(){
  const j=await fetch("/api/problems?offset="+bankOffset+"&limit="+PAGE_SIZE+"&only="+bankOnly+"&q="+encodeURIComponent(bankQ)+"&model="+encodeURIComponent(bankModel)).then(r=>r.json()).catch(()=>null);
  if(!j)return;
  $("#bankHint").textContent="共 "+fmtN(j.total)+" 题 · "+({translated:"已翻译",untranslated:"未翻译",all:"全部"})[bankOnly]+" · 按比赛时间倒序";
  const rb=$("#btnRetrans");
  rb.style.display=bankOnly==="untranslated"?"none":"";
  rb.dataset.n=j.total;
  rb.textContent="⟳ 用当前模型重译这 "+fmtN(j.total)+" 题";
  $("#pageInfo").textContent=(j.total?bankOffset+1:0)+"–"+Math.min(bankOffset+PAGE_SIZE,j.total)+" / "+fmtN(j.total);
  $("#bankBody").innerHTML=j.rows.map(p=>{
    const day=p.startTs?new Date(p.startTs*1000).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}):"—";
    const m=p.translateModel||(p.translated?"（官方原文/未知）":"");
    return "<tr class='click' data-plat='"+esc(p.platform)+"' data-pid='"+esc(p.id)+"'>"+
      "<td class='mono muted'>"+day+"</td>"+
      "<td>"+badge(PC[p.platform]||"outline",PL[p.platform]||p.platform)+"</td>"+
      "<td class='muted hide-sm' style='max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>"+esc(p.contestTitle||p.contestId||"")+"</td>"+
      "<td><b class='mono' style='font-size:12px'>"+esc(p.id)+"</b> "+esc(p.title)+(p.titleZh&&p.translated?'<br><span class="ok" style="font-size:12px">'+esc(p.titleZh)+"</span>":"")+"</td>"+
      "<td class='mono muted hide-sm'>"+fmtN(p.chars)+"</td>"+
      "<td>"+(p.translated?badge("success","已译"):badge("warn","未译"))+"</td>"+
      "<td class='hide-sm'>"+(p.translated?'<span class="badge outline mono" style="max-width:210px;overflow:hidden;text-overflow:ellipsis">'+esc(m)+'</span>':'<span class="muted">—</span>')+"</td></tr>";
  }).join("")||'<tr><td colspan="7" class="muted">没有匹配的题目 — 试试点「重新扫描」或更换筛选条件</td></tr>';
  $("#bankBody").querySelectorAll("tr.click").forEach(tr=>tr.onclick=()=>openProblem(tr.dataset.plat,tr.dataset.pid));
}

/* ================= 题面 Sheet ================= */
let pdData=null,pdView="zh";
async function openProblem(plat,pid){
  const j=await fetch("/api/problem?platform="+encodeURIComponent(plat)+"&id="+encodeURIComponent(pid)).then(r=>r.json()).catch(()=>null);
  if(!j||j.error){toast(j&&j.error||"读取失败");return}
  pdData=j;pdView="zh";
  $("#pdTitle").textContent=(j.titleZh||j.title)+" · "+j.id;
  $("#pdMeta").textContent=(j.contestTitle||"")+(j.startTime?" · "+fmtTs(Date.parse(j.startTime)/1000):"");
  $("#pdBadges").innerHTML=
    badge(PC[j.platform]||"outline",PL[j.platform]||j.platform)+
    (j.statementZhMd?badge("success","已翻译"):badge("warn","未翻译"))+
    badge("outline","翻译模型："+(j.translateModel||"—"))+
    (j.translatedAt?badge("outline",fmtTs(Date.parse(j.translatedAt)/1000)):"")+
    (j.difficulty?badge("outline","难度 "+j.difficulty):"");
  $("#pdLink").href=j.url||"#";
  $("#pdSite").href="https://ac.yslsy.top/problems/"+encodeURIComponent(j.platform)+"/"+encodeURIComponent(j.id||"");
  $$("#pdTabs .tab").forEach(t=>t.classList.toggle("active",t.dataset.v==="zh"));
  $("#pdTabs").style.display=j.statementZhMd?"":"none";
  renderProblem();
  $("#mask").style.display="block";
  $("#psheet").classList.add("open");
  document.body.style.overflow="hidden";
}
function closeProblem(){$("#psheet").classList.remove("open");$("#mask").style.display="none";document.body.style.overflow="";pdData=null}
$("#pdClose").onclick=closeProblem;
$$("#pdTabs .tab").forEach(t=>t.onclick=()=>{pdView=t.dataset.v;$$("#pdTabs .tab").forEach(x=>x.classList.toggle("active",x===t));renderProblem()});
function mdRender(src){
  // 轻量 Markdown 渲染（先整体转义防注入；数学公式原样高亮显示）
  let t=esc(src||"");
  const codes=[];
  t=t.replace(/```[a-z]*\n([\s\S]*?)```/g,(_,c)=>{codes.push(c);return "\u0000C"+(codes.length-1)+"\u0000"});
  t=t.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  t=t.replace(/\$\$([^$]+)\$\$/g,(_,m)=>'<span class="math">$$'+m+'$$</span>');
  t=t.replace(/(^|[^\\])\$([^$\n]+)\$/g,(_,p,m)=>p+'<span class="math">$'+m+'$</span>');
  t=t.replace(/^### (.*)$/gm,"<h3>$1</h3>").replace(/^## (.*)$/gm,"<h2>$1</h2>").replace(/^# (.*)$/gm,"<h1>$1</h1>");
  t=t.replace(/^\s*&gt; (.*)$/gm,"<blockquote>$1</blockquote>");
  t=t.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>");
  t=t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  t=t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img alt="$1" src="$2" referrerpolicy="no-referrer">');
  t=t.replace(/\n/g,"<br>");
  t=t.replace(/\u0000C(\d+)\u0000/g,(_,i)=>"<pre><code>"+codes[+i].replace(/\n$/,"")+"</code></pre>");
  return t;
}
function renderProblem(){
  if(!pdData)return;
  const zh=pdData.statementZhMd,orig=pdData.statementMd;
  if(pdView==="zh"){
    $("#pdBody").innerHTML=zh?mdRender(zh):'<div class="muted">该题暂无中文译文（可回翻译页启动翻译）。</div>';
  }else{
    $("#pdBody").innerHTML=mdRender(orig);
  }
  $("#pdBody").parentElement.scrollTop=0;
}
$("#pdCopy").onclick=async()=>{
  if(!pdData)return;
  const txt=pdView==="zh"?(pdData.statementZhMd||""):(pdData.statementMd||"");
  try{await navigator.clipboard.writeText(txt);toast("已复制"+(pdView==="zh"?"译文":"原文"))}catch(e){toast("复制失败："+e.message)}
};

/* ================= 启动 ================= */
function guard(name,fn){try{fn()}catch(e){console.error("["+name+"]",e);
  const b=$("#fatalBar");if(b){b.style.display="block";b.textContent="初始化异常 ["+name+"]: "+e.message}}}
guard("models",renderModels);
guard("state",refresh);
guard("bank",loadBank);
setInterval(()=>guard("state",refresh),1000);
setInterval(()=>{if(!drawerKey)guard("tasks",loadTasks)},5000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "TranslateWeb/1.0"

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        elif u.path == "/api/state":
            self._json(APP.snapshot())
        elif u.path == "/api/problems":
            offset = max(0, int((q.get("offset") or ["0"])[0]))
            limit = min(200, max(1, int((q.get("limit") or ["50"])[0])))
            only = (q.get("only") or ["untranslated"])[0]
            qs = (q.get("q") or [""])[0]
            model = (q.get("model") or [""])[0]
            self._json(APP.problems_page(offset, limit, only, q=qs, model=model))
        elif u.path == "/api/problem":
            self._json(APP.problem_detail((q.get("platform") or [""])[0], (q.get("id") or [""])[0]))
        elif u.path == "/api/translated-stats":
            self._json({"stats": APP.translated_stats()})
        elif u.path == "/api/tasks":
            self._json({"tasks": APP.tasks_list()})
        elif u.path == "/api/task":
            key = (q.get("key") or [""])[0]
            cursor = int((q.get("cursor") or ["0"])[0] or 0)
            rcursor = int((q.get("rcursor") or ["0"])[0] or 0)
            self._json(APP.task_detail(key, cursor, rcursor))
        elif u.path == "/api/models":
            self._json({"models": self._list_models()})
        else:
            self._json({"error": "not found"}, 404)

    def _list_models(self):
        """代理 /v1/models 的模型清单（供页面下拉选择）。"""
        cfg = APP.cfg
        url = cfg["baseUrl"].rstrip("/") + "/models"
        headers = {}
        if cfg.get("apiKey"):
            headers["Authorization"] = "Bearer " + cfg["apiKey"]
        try:
            headers["User-Agent"] = "translate-web"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
            rows = data.get("data") if isinstance(data, dict) else data
            out = []
            for m in rows or []:
                mid = m.get("id") if isinstance(m, dict) else str(m)
                if not mid:
                    continue
                out.append({"id": mid,
                            "name": (m.get("display_name") or mid) if isinstance(m, dict) else mid,
                            "owner": (m.get("owned_by") or "") if isinstance(m, dict) else ""})
            out.sort(key=lambda x: x["id"])
            return out
        except Exception as e:  # noqa: BLE001
            APP.log("models", "获取模型列表失败 — {}".format(e))
            return []

    def do_POST(self):
        u = urlparse(self.path)
        body = self._read_body()
        if u.path == "/api/scan":
            self._json(APP.scan())
        elif u.path == "/api/start":
            limit = int(body.get("limit") or 0)
            only = str(body.get("only") or "untranslated")
            model = str(body.get("model") or "")
            q = str(body.get("q") or "")
            retranslate = bool(body.get("retranslate"))
            ok, msg = APP.start(limit, only=only, model=model, q=q, retranslate=retranslate)
            self._json({"ok": ok, "message": msg} if ok else {"error": msg})
        elif u.path == "/api/stop":
            self._json({"ok": APP.stop()})
        elif u.path == "/api/config":
            with APP.lock:
                if isinstance(body.get("baseUrl"), str) and body["baseUrl"].strip():
                    APP.cfg["baseUrl"] = body["baseUrl"].strip()
                if isinstance(body.get("apiKey"), str):
                    APP.cfg["apiKey"] = body["apiKey"].strip()
            if isinstance(body.get("models"), list) and body["models"]:
                APP.cfg["models"] = [
                    {"model": str(m.get("model", "")).strip(),
                     "concurrency": max(1, min(200, int(m.get("concurrency") or 1))),
                     "baseUrl": str(m.get("baseUrl", "") or "").strip(),
                     "apiKey": str(m.get("apiKey", "") or "")}
                    for m in body["models"] if str(m.get("model", "")).strip()
                ]
            self._json({"config": {"baseUrl": APP.cfg["baseUrl"],
                                   "apiKeySet": bool(APP.cfg["apiKey"]),
                                   "models": APP.cfg["models"]}})
            APP.save_cfg()
        elif u.path == "/api/ping":
            # 允许用页面当前值临时探活（不必先保存）；探第一个模型
            with APP.lock:
                cfg = json.loads(json.dumps(APP.cfg))
            if isinstance(body.get("baseUrl"), str) and body["baseUrl"].strip():
                cfg["baseUrl"] = body["baseUrl"].strip()
            if isinstance(body.get("apiKey"), str) and body["apiKey"].strip():
                cfg["apiKey"] = body["apiKey"].strip()
            models = body.get("models") if isinstance(body.get("models"), list) else []
            models = [m for m in models if str(m.get("model", "")).strip()] or cfg["models"]
            first = models[0]
            mcfg = {
                "baseUrl": (first.get("baseUrl") or "").strip() or cfg["baseUrl"],
                "apiKey": (first.get("apiKey") or "").strip() or cfg["apiKey"],
            }
            try:
                model = str(first["model"]).strip()
                t0 = time.time()
                text, usage = chat_stream(mcfg, model, [{"role": "user", "content": "hi"}],
                                          lambda _p, _k="content": None, temperature=0, timeout=30,
                                          ua="translate-web/ping")
                self._json({"ok": True, "model": model,
                            "latencyMs": int((time.time() - t0) * 1000), "usage": usage,
                            "reply": text[:60]})
            except Exception as e:  # noqa: BLE001
                self._json({"ok": False, "error": str(e)})
        else:
            self._json({"error": "not found"}, 404)


def lan_ips():
    """列出本机可用于局域网访问的 IPv4 地址。

    不用「UDP connect 8.8.8.8」那招——本机路由走代理/utun 时会拿到 198.18.x.x
    这类虚拟网卡地址，别人根本连不上。改为解析 ifconfig，只取私网段，
    en* 物理网卡优先。
    """
    import subprocess
    out = []
    try:
        text = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return out
    iface = ""
    for line in text.splitlines():
        if line and not line[0].isspace():
            iface = line.split(":")[0]
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "inet":
            ip = parts[1]
            if ip.startswith(("127.", "169.254.", "198.18.", "198.19.")):
                continue      # 回环 / 自分配 / 代理虚拟网卡
            out.append((0 if iface.startswith("en") else 1, ip))
    return [ip for _, ip in sorted(out)]


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0，可被局域网/手机访问）")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()
    APP = App(args.root)
    APP.scan()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print("翻译控制台: http://127.0.0.1:{}/".format(args.port), flush=True)
    for ip in lan_ips():
        print("局域网/手机: http://{}:{}/".format(ip, args.port), flush=True)
    print("监听 {}:{}  (Ctrl-C 退出)".format(args.host, args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
