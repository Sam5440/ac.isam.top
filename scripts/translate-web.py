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
  - 手动拉取（2026-11-15 起，与 CI 同一条管线）：「拉取」页把参数传给
    scripts/fetch.mjs（ABC/ARC/AGC/CF/牛客 扫描 + 历史回填；强制 --no-translate
    --no-gyms，翻译统一走本控制台引擎）或 scripts/fetch-cf-gyms.mjs
    （gym 题面回填 / 全量 / 进度查看），实时日志回显、随时停止（SIGTERM 存档
    退出）、结束后自动重扫让新题面进入翻译队列。
  - 网页端显示进度、每模型请求数与 token 消耗（输入 / 输出 / 缓存读取），每次可
    选择翻译数量；仅监听 127.0.0.1。
  - 样例说明补译（2026-11-17 起）：samples[].note → samples[].noteZh。AtCoder
    的样例解释不在 statementMd 里，题面翻译覆盖不到，必须单独一轮。控制台有
    「补样例说明」按钮；也可以一次性命令行执行（不启动 Web）：

        python3 scripts/translate-web.py --notes --platform atcoder --problems abc484_b
        python3 scripts/translate-web.py --notes --limit 50 --dry-run
"""

import argparse
import atexit
import glob
import json
import os
import re
import shutil
import socket
import subprocess
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

PLATFORMS = ("atcoder", "codeforces", "nowcoder", "cf-gyms")
PLATFORM_LABEL = {"atcoder": "AtCoder", "codeforces": "Codeforces", "nowcoder": "牛客", "cf-gyms": "CF Gym"}

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


# Windows 文件名非法字符（与 lib/problem-id.mjs 同口径）：< > : " / \ | ? * 与控制字符
_ILLEGAL_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def problem_file_stem(pid):
    """题目 id → 磁盘文件名主干（与 lib/problem-id.mjs 的 problemFileName 同口径）。

    剥 URL 查询串/锚点 → 剔除 Windows 非法字符 → 去首尾空白与尾随点 → 小写。
    历史事故：gym 题号曾带 "?statementsLocale=ru" 直接落盘，'?' 让文件在 Windows
    上永远 checkout 不出来。查询与写入必须共用这一条规则。
    """
    raw = str(pid or "").strip()
    raw = re.split(r"[?#]", raw, maxsplit=1)[0]
    raw = _ILLEGAL_FILENAME_CHARS.sub("", raw).strip(" .").strip()
    return raw.lower()


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")

NOTES_SYSTEM = """你是顶级算法竞赛选手兼技术翻译，负责把算法竞赛题面里的「样例说明」从英文（或日文）翻译成简体中文。

硬性规则：
1. 输出必须是严格的 JSON 对象：{"notes": ["<第 1 条中文说明>", "<第 2 条中文说明>"]}，不要输出任何 JSON 之外的文字。
2. notes 数组长度必须与输入条数完全相同、顺序一致：一条输入对应一条输出，不合并、不拆分、不新增、不省略。
3. 数学公式（$...$、$$...$$、\\(...\\)、\\[...\\]）与行内代码（`...`）逐字符原样保留，包括空格与反斜杠。
4. 变量名、编号、样例中的输入输出数值保持原样；术语用国内 OJ 惯用译法（如 vertex→顶点，sequence→序列）。
5. 语句通顺，不要逐词直译；不要补解释、不要加「题意是」之类的话，不要改动原说明的信息量。
6. 保留原文的换行结构：原文行尾的硬换行标记（反斜杠）与段落空行原样保留，不要合并成一行。"""


def parse_ts(s):
    """ISO 时间 → epoch 秒；解析失败返回 None。"""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ---------------------------------------------------------------- 样例说明（note）工具
#
# 与 lib/sample-notes.js 同口径：有实质 note、无 noteZh 的说明才进队列。
# AtCoder 的样例解释挂在「Sample Output N」小节末尾，抓取时进了
# samples[].note（scripts/lib/atcoder.mjs 的 flushGroup），不在 statementMd
# 里——题面翻译永远覆盖不到，必须单独一轮补。

# 样例块里的样板标签（CF 英文页面 / 俄语页面 / 中文页面）；剔除后若无正文即为样板。
JUNK_NOTE_WORDS = re.compile(
    r"(?:input|output|copy|sample|example|standard|входные|выходные|данные|копировать|пример|ввод|вывод|输入|输出|复制|样例|示例)",
    re.IGNORECASE,
)
JUNK_NOTE_PUNCT = re.compile(r"[\s:：,，.。!！?？;；—–\-]")


def meaningful_note(note):
    """真实说明文本；CF 的「Input/Copy/Output/Copy」这类样板返回空串。"""
    t = str(note or "").strip()
    if not t:
        return ""
    if not JUNK_NOTE_PUNCT.sub("", JUNK_NOTE_WORDS.sub("", t)):
        return ""
    return t


def pending_note_indices(samples):
    """待翻译说明的下标（有实质 note、无 noteZh）。"""
    out = []
    for i, s in enumerate(samples or []):
        if not isinstance(s, dict):
            continue
        if not meaningful_note(s.get("note")):
            continue
        if str(s.get("noteZh") or "").strip():
            continue
        out.append(i)
    return out

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


def translate_notes(cfg, model, title, notes, log, on_chunk=None, cancel=None, pid=None):
    """逐条翻译样例说明。返回 (中文列表, usage)；条数不一致视为失败（下轮重试）。"""
    body = "\n\n".join("[{}]\n{}".format(i + 1, n) for i, n in enumerate(notes))
    user = "题目：{}\n\n请逐条翻译以下 {} 条样例说明：\n\n<notes>\n{}\n</notes>".format(
        title, len(notes), body)
    ua = quote(str(pid or "").strip()[:60] or "unknown", safe="")
    content, usage = chat_with_retry(
        cfg, model,
        [{"role": "system", "content": NOTES_SYSTEM},
         {"role": "user", "content": user}],
        log, on_chunk=on_chunk, cancel=cancel, ua=ua,
    )
    parsed = extract_json(content)
    arr = parsed.get("notes") if isinstance(parsed, dict) else None
    if not isinstance(arr, list) or len(arr) != len(notes):
        raise RuntimeError("notes translation unparsable")
    return ([str(x or "").strip() for x in arr], usage)


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
        self.fetch = {                # 拉取任务（子进程封装 CI 管线）
            "active": False, "stopping": False, "kind": None, "cmd": [],
            "startedAt": None, "endedAt": None, "exit": None,
            "popen": None, "seq": 0, "logs": deque(maxlen=2000), "watchdog": None,
        }
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
                # 与 build-index.mjs 口径一致：statementZhMd 存在即已翻译。
                # zh==en 是合法状态（牛客官方原文 / 纯图片·纯公式题面无可译文本）
                translated = bool(p.get("statementZhMd"))
                if not translated:
                    untranslated += 1
                # 样例说明（samples[].note → noteZh）：走独立的补译队列，
                # 与题面是否已翻译无关（老题题面早就翻了，说明还是英文）。
                samples = p.get("samples") or []
                notes_total = sum(1 for x in samples
                                  if isinstance(x, dict) and meaningful_note(x.get("note")))
                # 官方中文题（牛客 language=zh）的说明本就是中文，不计入待补
                notes_missing = 0 if p.get("language") == "zh" else len(pending_note_indices(samples))
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
                    "notesTotal": notes_total,
                    "notesMissing": notes_missing,
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
        pending_notes = [p for p in items if p.get("notesMissing")]
        self.log("scan", "全量 {} 题（未翻译 {}，样例说明待补 {} 题 / {} 条），耗时 {:.1f}s".format(
            len(items), len(self.problems), len(pending_notes),
            sum(p.get("notesMissing") or 0 for p in pending_notes), time.time() - t0))
        return {"untranslated": len(self.problems), "total": len(items),
                "translated": len(items) - len(self.problems), "byPlatform": by_platform,
                "notesPendingProblems": len(pending_notes),
                "notesPending": sum(p.get("notesMissing") or 0 for p in pending_notes)}

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
        f = os.path.join(self.data_dir, platform, "problems", problem_file_stem(pid) + ".json")
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

    # ---------- 样例说明（note → noteZh） ----------

    def notes_stats(self, platform=""):
        """样例说明补译进度（基于最近一次扫描的快照，不重新读盘）。"""
        with self.lock:
            rows = list(self.all_problems)
        if platform:
            rows = [p for p in rows if p["platform"] == platform]
        with_notes = [p for p in rows if (p.get("notesTotal") or 0) > 0]
        pending = [p for p in with_notes if (p.get("notesMissing") or 0) > 0]
        by_platform = {}
        for p in pending:
            by_platform[p["platform"]] = by_platform.get(p["platform"], 0) + 1
        return {
            "problems": len(with_notes),
            "notes": sum(p.get("notesTotal") or 0 for p in with_notes),
            "pendingProblems": len(pending),
            "pendingNotes": sum(p.get("notesMissing") or 0 for p in pending),
            "byPlatform": by_platform,
            "scannedAt": self.scan_at,
        }

    def notes_queue(self, platform="", problems=None, limit=0, retranslate=False):
        """说明补译队列（可按平台 / 题号限定），按比赛时间倒序。

        retranslate=True 时不再只看「缺译」，凡是有实质说明的题都进队列
        （用于提示词升级后重刷质量，已有 noteZh 会被覆盖）。
        """
        wanted = {str(x).strip().lower() for x in (problems or []) if str(x).strip()}
        with self.lock:
            rows = list(self.all_problems)
        queue = []
        for p in rows:
            if platform and p["platform"] != platform:
                continue
            if wanted and str(p.get("id", "")).lower() not in wanted:
                continue
            pending = (p.get("notesMissing") or 0) > 0
            if not pending and not (retranslate and (p.get("notesTotal") or 0) > 0):
                continue
            queue.append(p)
        if limit and limit > 0:
            queue = queue[:limit]
        return queue

    def notes_start(self, limit=0, platform="", problems=None, retranslate=False):
        """启动一轮「只补样例说明」翻译（与题面翻译互斥，共用任务/进度面板）。"""
        with self.lock:
            if self.run and self.run["active"]:
                return False, "已有翻译任务在运行"
        rows = self.notes_queue(platform=platform, problems=problems, limit=limit,
                                retranslate=retranslate)
        if not rows:
            return False, "没有待补样例说明的题目（试试点「重新扫描」）"
        models = [m for m in self.cfg["models"] if m.get("model") and m.get("concurrency", 0) > 0]
        if not models:
            return False, "没有可用模型配置"
        queue = [{
            "mode": "notes",
            "platform": r["platform"], "id": r["id"], "file": r["file"],
            "title": r["title"], "contestTitle": r["contestTitle"],
        } for r in rows]
        run = {
            "active": True, "stopping": False, "limit": limit or 0,
            "id": int(time.time() * 1000),
            "cancel": CancelToken(),
            "kind": "notes",
            "retranslate": bool(retranslate),
            "source": {"platform": platform, "problems": list(problems or [])},
            "total": len(queue), "done": 0, "failed": 0, "skipped": 0, "cancelled": 0,
            "startedAt": time.time(), "endedAt": None,
            "lastError": None, "consec4xx": 0,
            "queue": queue, "cursor": 0,
            "current": {},
            "models": {m["model"]: {"concurrency": m["concurrency"], "requests": 0, "ok": 0,
                                    "fail": 0, "in": 0, "out": 0, "cached": 0}
                       for m in models},
            "recentFailures": deque(maxlen=12),
        }
        with self.lock:
            self.run = run
        self.log("main", "开始{}样例说明 {} 题（{}），模型：{}".format(
            "重译" if retranslate else "补", len(queue), platform or "全部平台",
            ", ".join("{}×{}".format(m["model"], m["concurrency"]) for m in models)))
        threading.Thread(target=self._run_lanes, args=(run,), daemon=True).start()
        return True, "已启动样例说明补译 {} 题".format(len(queue))

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
        # 样例说明一轮通常只有几十题（甚至 1 题），别按题面模式的 180 并发开线程
        lane_cap = len(run["queue"]) if run.get("kind") == "notes" else 0
        for m in self.cfg["models"]:
            mcfg = self.model_cfg(m)   # 该模型的独立 baseUrl/apiKey（空则回落全局）
            concurrency = int(m.get("concurrency", 0))
            if lane_cap:
                concurrency = min(concurrency, max(1, lane_cap))
            for _ in range(concurrency):
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
        if run.get("kind") == "notes":
            # 说明补译完成后刷新扫描快照，面板上的「待补」条数立刻下降
            try:
                self.scan()
            except Exception:  # noqa: BLE001
                pass

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
                if run.get("kind") == "notes":
                    self._translate_notes_one(run, model, mcfg, task, lane)
                else:
                    self._translate_one(run, model, mcfg, task, lane)
            finally:
                with self.lock:
                    run["current"].pop(lane, None)

    def _account_usage(self, run, model, pin, pout, pcached):
        """记一次成功请求的 token 用量（本轮 + 进程累计）。"""
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
        self._account_usage(run, model, pin, pout, pcached)
        with self.lock:
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

    def _translate_notes_one(self, run, model, mcfg, task, lane):
        """只补样例说明：读盘 → 重算待补下标 → 一次请求翻本题全部说明 → 合并写回。"""
        rec = self._new_task("{}:{}:{}".format(run["id"], lane, task["id"]), model,
                             task["platform"], task["id"], task["title"], task["contestTitle"])
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

        indices = pending_note_indices(p.get("samples"))
        if not indices and run.get("retranslate"):
            # 重译模式：不再只挑缺译的，凡有实质说明都重刷（覆盖已有 noteZh）
            indices = [i for i, s in enumerate(p.get("samples") or [])
                       if isinstance(s, dict) and meaningful_note(s.get("note"))]
        if not indices:
            with self.lock:
                run["skipped"] += 1
                rec.update(status="skipped", endedAt=time.time(), error="没有待补说明")
            self.log("task", "↷ {} 样例说明已齐全，跳过".format(task["id"]))
            return

        notes = [meaningful_note(p["samples"][i].get("note")) for i in indices]

        def on_chunk(piece, kind="content"):
            self._append_chunk(rec, piece, kind)

        try:
            with self.lock:
                run["models"][model]["requests"] += 1
            zh, usage = translate_notes(mcfg, model, p.get("title") or "", notes, self.log,
                                        on_chunk=on_chunk, cancel=run["cancel"], pid=task["id"])
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
            return
        except Exception as e:  # noqa: BLE001
            with self.lock:
                run["failed"] += 1
                run["models"][model]["fail"] += 1
                run["lastError"] = str(e)
                run["consec4xx"] = 0
                run["recentFailures"].append({"id": task["id"], "error": str(e)})
                rec.update(status="failed", error=str(e), endedAt=time.time())
            self.log("task", "✗ {} — 样例说明 {}".format(task["id"], e))
            return

        pin, pout, pcached = usage
        self._account_usage(run, model, pin, pout, pcached)
        with self.lock:
            rec["usage"] = {"in": pin, "out": pout, "cached": pcached}

        try:
            changed = self._save_notes(task["file"], p, indices, zh, model)
            with self.lock:
                run["done"] += 1
                rec.update(status="done", saved=True, endedAt=time.time())
            self.log("task", "✓ {} 样例说明 ×{} ← {} (in {} / out {})".format(
                task["id"], changed, model, pin, pout))
        except Exception as e:  # noqa: BLE001
            with self.lock:
                run["failed"] += 1
                run["recentFailures"].append({"id": task["id"], "error": "保存失败: " + str(e)})
                rec.update(status="failed", saved=False, error="保存失败: " + str(e), endedAt=time.time())
            self.log("task", "✗ {} — 保存失败 {}".format(task["id"], e))

    def _save_notes(self, file, disk_problem, indices, zh, model):
        """把 noteZh 合并进磁盘现值后原子写回（与题面翻译/其它进程可并行）。"""
        with self.write_lock:
            try:
                with open(file, encoding="utf-8") as f:
                    cur = json.load(f)
            except (OSError, json.JSONDecodeError):
                cur = disk_problem
            samples = cur.get("samples")
            if not isinstance(samples, list):
                samples = []
            changed = 0
            for k, idx in enumerate(indices):
                if idx < 0 or idx >= len(samples) or not isinstance(samples[idx], dict):
                    continue
                text = str(zh[k] or "").strip() if k < len(zh) else ""
                if not text:
                    continue
                samples[idx]["noteZh"] = text
                changed += 1
            cur["samples"] = samples
            if changed:
                cur["noteTranslatedAt"] = now_iso()
                cur["noteTranslateModel"] = model
            tmp = "{}.tmp-web-{}".format(file, os.getpid())
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, indent=2)
                f.write("\n")
            os.replace(tmp, file)
            return changed

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
                    "kind": run.get("kind", "statement"),
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
                "notes": self.notes_stats(),
                "cumulative": self.cumulative,
                "log": list(self._logs)[-40:],
            }

    # ---------- 拉取（与 CI 同管线） ----------

    FETCH_HARD_LIMIT_SEC = 180 * 60   # 标准拉取硬上限（CI 最坏 65 分钟，本地放宽）

    @staticmethod
    def _int_or(v, default):
        try:
            return int(float(str(v).strip()))
        except (ValueError, TypeError):
            return default

    def _fetch_popen(self, kind, args, env_extra, budget_min):
        """启动拉取子进程并接管日志/看门狗。互斥已由 fetch_start 保证。"""
        env = dict(os.environ)
        env.update(env_extra)
        proc = subprocess.Popen(args, cwd=self.root, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        f = self.fetch
        f.update(active=True, stopping=False, kind=kind, cmd=list(args),
                 startedAt=time.time(), endedAt=None, exit=None, popen=proc)
        self.log("fetch", "启动拉取子进程（cwd={}）：{}".format(self.root, " ".join(args)))
        atexit.register(self._fetch_kill_atexit, proc)

        def _feed():
            for raw in iter(proc.stdout.readline, b""):
                line = re.sub(r"\x1b\[[0-9;]*m", "", raw.decode("utf-8", "replace")).rstrip("\r\n")
                if not line.strip():
                    continue
                with self.lock:
                    f["seq"] += 1
                    f["logs"].append((f["seq"], line[:500]))
            code = proc.wait()
            if f["watchdog"]:
                f["watchdog"].cancel()
                f["watchdog"] = None
            with self.lock:
                f.update(active=False, endedAt=time.time(), exit=code, popen=None)
            self.log("fetch", "拉取进程退出：码 {}（{}，用时 {:.0f}s）".format(
                code, "手动停止" if f["stopping"] else "自然结束",
                (f["endedAt"] or time.time()) - (f["startedAt"] or time.time())))
            if f["stopping"]:
                self.log("fetch", "已按请求停止；gym 子进程退出前会存档现场，续跑无缝")
            # 结束后自动重扫：新题面立即进入翻译队列
            try:
                self.scan()
            except Exception as e:  # noqa: BLE001
                self.log("fetch", "自动重扫失败：{}".format(e))

        threading.Thread(target=_feed, daemon=True).start()

        hard = self.FETCH_HARD_LIMIT_SEC if budget_min is None else (budget_min + 15) * 60

        def _expire():
            if proc.poll() is not None:
                return
            with self.lock:
                f["stopping"] = True
            self.log("fetch", "⏱ 达到时间预算（{} min），SIGTERM 存档退出…".format(budget_min))
            try:
                proc.terminate()
            except OSError:
                pass

        wd = threading.Timer(hard, _expire)
        wd.daemon = True
        wd.start()
        f["watchdog"] = wd
        return proc

    @staticmethod
    def _fetch_kill_atexit(proc):
        try:
            if proc.poll() is None:
                proc.kill()
        except OSError:
            pass

    def fetch_start(self, p):
        with self.lock:
            if self.fetch["active"]:
                return False, "已有拉取任务在运行（先停止或等它结束）"
        kind = str(p.get("kind") or "standard")
        env_extra = {"CF_HEADLESS": "0" if p.get("headed") else "1"}
        if kind == "standard":
            # 各类型扫描场次；0 = 跳过。翻译与 gym 尾阶段强制关闭：
            # 翻译统一走本控制台引擎，gym 用「拉取」页的 Gym 面板单独控制。
            nums = {k: max(0, min(2000, self._int_or(p.get(k), 0)))
                    for k in ("abc", "arc", "agc", "cf", "nc", "backfill")}
            if not any(nums.values()):
                return False, "请至少填写一个扫描/回填数量"
            args = ["node", "scripts/fetch.mjs",
                    "--abc", str(nums["abc"]), "--arc", str(nums["arc"]), "--agc", str(nums["agc"]),
                    "--cf", str(nums["cf"]), "--nc", str(nums["nc"]),
                    "--backfill", str(nums["backfill"]),
                    "--no-translate", "--no-gyms"]
            budget = None
        elif kind == "gym":
            mode = str(p.get("mode") or "problems")
            if mode not in ("problems", "full"):
                mode = "problems"
            pages = max(1, min(100000, self._int_or(p.get("pages"), 60)))
            minutes = max(1, min(720, self._int_or(p.get("minutes"), 10)))
            sweep = max(0, min(100000, self._int_or(p.get("sweep"), 0)))
            args = ["node", "scripts/fetch-cf-gyms.mjs", "--mode", mode,
                    "--max-problem-pages", str(pages),
                    "--minutes", str(minutes),
                    "--sweep-limit", str(sweep)]
            if p.get("login"):
                args.append("--login")
            lg = self._int_or(p.get("limitGyms"), 0)
            if lg > 0:
                args += ["--limit-gyms", str(lg)]
            og = str(p.get("onlyGym") or "").strip()
            if og:
                args += ["--only-gym", og]
            budget = minutes   # 预算到点存档退出（脚本自带），+15min 宽限兜底
        else:
            return False, "未知拉取类型: " + kind
        with self.lock:
            self.fetch["logs"].clear()
            self.fetch["seq"] = 0
        self._fetch_popen(kind, args, env_extra, budget)
        label = {"standard": "标准三平台", "gym": "CF Gym"}[kind]
        return True, "已启动拉取（{}）".format(label)

    def fetch_stop(self):
        with self.lock:
            f = self.fetch
            if not f["active"]:
                return False
            proc = f["popen"]
            f["stopping"] = True
        self.log("fetch", "停止指令：SIGTERM（gym 子进程将存档退出）…")
        try:
            proc.terminate()
        except OSError:
            pass
        # 45s 宽限给 gym 存档（fetch.mjs 的 spawnGymPull 用 60s 同款语义）
        t = threading.Timer(45, self._fetch_kill_late, args=(proc,))
        t.daemon = True
        t.start()
        return True

    def _fetch_kill_late(self, proc):
        try:
            if proc.poll() is None:
                self.log("fetch", "SIGTERM 45s 未退出，SIGKILL")
                proc.kill()
        except OSError:
            pass

    def fetch_tail(self, cursor):
        with self.lock:
            f = self.fetch
            meta = {"active": f["active"], "stopping": f["stopping"], "kind": f["kind"],
                    "cmd": f["cmd"], "startedAt": f["startedAt"], "endedAt": f["endedAt"],
                    "exit": f["exit"]}
            lines = list(f["logs"])
        tail = [(s, t) for s, t in lines if s > cursor][-600:]
        # 客户端游标落后于窗口（旧日志已被挤出）：要求前端清空重建
        reset = bool(lines) and cursor != 0 and cursor < lines[0][0] - 1
        return dict(meta, lines=[{"i": s, "text": t} for s, t in tail],
                    cursor=lines[-1][0] if lines else 0, reset=reset)

    def fetch_envcheck(self):
        """拉取前环境自检：node / Playwright Chromium / pdftotext / 脚本就位。"""
        def node_v():
            try:
                r = subprocess.run(["node", "-v"], capture_output=True, text=True, timeout=10, cwd=self.root)
                return (r.stdout or "").strip() or None
            except Exception:  # noqa: BLE001
                return None

        def chromium():
            bases = []
            p = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
            if p:
                bases.append(p)
            home = os.path.expanduser("~")
            bases += [os.path.join(home, "Library", "Caches", "ms-playwright"),
                      os.path.join(home, ".cache", "ms-playwright")]
            for b in bases:
                if os.path.isdir(b) and glob.glob(os.path.join(b, "chromium-*")):
                    return True
            return False

        return {
            "node": node_v(),
            "chromium": chromium(),
            "pdftotext": bool(shutil.which("pdftotext")),
            "scripts": {
                "fetch": os.path.exists(os.path.join(self.root, "scripts", "fetch.mjs")),
                "gym": os.path.exists(os.path.join(self.root, "scripts", "fetch-cf-gyms.mjs")),
            },
        }

    def gym_status(self):
        """跑 fetch-cf-gyms.mjs --mode status（只读本地状态文件，不碰网络）。"""
        try:
            r = subprocess.run(["node", "scripts/fetch-cf-gyms.mjs", "--mode", "status"],
                               capture_output=True, text=True, timeout=25, cwd=self.root)
            text = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
            m = re.search(r"\{[\s\S]*\}", text)
            if not m:
                return {"ok": False, "error": (text.strip()[-300:] or "无输出")}
            return {"ok": True, "data": json.loads(m.group(0))}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "status 查询超时（25s）"}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}


APP = None

# ---------------------------------------------------------------- HTTP

PAGE = r"""
<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a12">
<title>翻译控制台 · ac.isam.top</title>
<style>
/* ========================================================================
   shadcn/ui 设计系统（new-york style · dark）—— 纯 CSS 组件实现，零依赖。
   令牌与主站 ac.isam.top 暗色主题一致（oklch · hue 274）。
   ======================================================================== */
:root{
  --background:oklch(0.145 0.015 274);
  --foreground:oklch(0.96 0.005 274);
  --card:oklch(0.185 0.018 274);
  --card-foreground:oklch(0.96 0.005 274);
  --popover:oklch(0.205 0.02 274);
  --popover-foreground:oklch(0.96 0.005 274);
  --primary:oklch(0.62 0.19 272);
  --primary-foreground:oklch(0.985 0.005 274);
  --secondary:oklch(0.26 0.02 274);
  --secondary-foreground:oklch(0.96 0.005 274);
  --muted:oklch(0.24 0.018 274);
  --muted-foreground:oklch(0.68 0.015 274);
  --accent:oklch(0.28 0.03 274);
  --accent-foreground:oklch(0.96 0.005 274);
  --destructive:oklch(0.62 0.2 25);
  --destructive-foreground:oklch(0.985 0.005 274);
  --success:oklch(0.72 0.17 155);
  --warning:oklch(0.79 0.15 85);
  --info:oklch(0.75 0.13 220);
  --border:oklch(0.29 0.02 274);
  --input:oklch(0.31 0.02 274);
  --ring:oklch(0.62 0.19 272);
  --radius:0.625rem;
  --safe-b:env(safe-area-inset-bottom,0px);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;border-color:var(--border)}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:oklch(0.35 0.02 274);border-radius:8px}
::-webkit-scrollbar-thumb:hover{background:oklch(0.42 0.02 274)}
::-webkit-scrollbar-track{background:transparent}
.muted{color:var(--muted-foreground)} .ok{color:var(--success)} .err{color:var(--destructive)} .warn{color:var(--warning)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
svg.ic{width:15px;height:15px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ===== 顶栏 + 导航 ===== */
.top{position:sticky;top:0;z-index:40;background:color-mix(in oklab,var(--background) 82%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.top-in{max-width:1200px;margin:0 auto;padding:0 16px;display:flex;align-items:center;gap:14px;height:52px}
.brand{display:flex;align-items:center;gap:9px;flex-shrink:0}
.brand b{font-size:14.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.brand .logo{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;
  background:color-mix(in oklab,var(--primary) 18%,transparent);color:var(--primary)}
.brand .logo svg.ic{width:16px;height:16px}
.wrap{max-width:1200px;margin:0 auto;padding:18px 16px calc(56px + var(--safe-b))}

/* ===== Tabs（shadcn TabsList / TabsTrigger） ===== */
.tabs{display:inline-flex;align-items:center;background:var(--muted);border-radius:calc(var(--radius) - 2px);padding:3px;gap:2px;
  overflow-x:auto;max-width:100%;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{border:none;background:transparent;color:var(--muted-foreground);font:inherit;font-size:12.5px;font-weight:500;
  padding:5px 12px;border-radius:calc(var(--radius) - 4px);cursor:pointer;transition:.15s;white-space:nowrap;
  display:inline-flex;align-items:center;gap:6px}
.tab svg.ic{width:14px;height:14px}
.tab.active{background:var(--card);color:var(--foreground);box-shadow:0 1px 3px oklch(0 0 0/.3)}
#mainTabs .tab{padding:6px 13px}

/* ===== Button（shadcn 全变体） ===== */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;
  border-radius:calc(var(--radius) - 2px);font-size:13px;font-weight:500;height:36px;padding:0 15px;
  cursor:pointer;user-select:none;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
  background:var(--primary);color:var(--primary-foreground);border:1px solid var(--primary)}
.btn:hover{background:color-mix(in oklab,var(--primary) 88%,white)}
.btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--background),0 0 0 4px color-mix(in oklab,var(--ring) 55%,transparent)}
.btn:active{filter:brightness(.92)}
.btn.secondary{background:var(--secondary);color:var(--secondary-foreground);border-color:var(--border)}
.btn.secondary:hover{background:var(--accent)}
.btn.outline{background:transparent;color:var(--foreground);border:1px solid var(--input)}
.btn.outline:hover{background:var(--accent);color:var(--accent-foreground)}
.btn.ghost{background:transparent;color:var(--foreground);border:1px solid transparent}
.btn.ghost:hover{background:var(--accent)}
.btn.destructive{background:transparent;color:var(--destructive);border:1px solid color-mix(in oklab,var(--destructive) 45%,transparent)}
.btn.destructive:hover{background:color-mix(in oklab,var(--destructive) 14%,transparent)}
.btn.link{background:transparent;border-color:transparent;color:var(--primary);text-decoration:underline;text-underline-offset:3px}
.btn.link:hover{text-decoration:underline}
.btn.sm{height:32px;padding:0 11px;font-size:12.5px;border-radius:calc(var(--radius) - 4px)}
.btn.lg{height:40px;padding:0 18px;font-size:14px}
.btn.icon{width:34px;height:34px;padding:0}
.btn:disabled{opacity:.5;cursor:not-allowed;pointer-events:none}

/* ===== Card ===== */
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);
  border-radius:var(--radius);box-shadow:0 1px 2px oklch(0 0 0/.3)}
.card-h{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.card-h b{font-size:14px;font-weight:600}
.card-h .desc{color:var(--muted-foreground);font-size:11.5px;font-weight:400;margin:1px 0 0}
.card-c{padding:16px 18px}
.grid{display:grid;gap:14px}
.card + .card{margin-top:14px}

/* ===== Badge ===== */
.badge{display:inline-flex;align-items:center;gap:4px;border-radius:9999px;
  border:1px solid var(--border);padding:1.5px 8px;font-size:11px;font-weight:500;line-height:1.5;white-space:nowrap;
  color:var(--muted-foreground);background:var(--secondary)}
.badge.primary{background:color-mix(in oklab,var(--primary) 18%,transparent);color:var(--primary);border-color:color-mix(in oklab,var(--primary) 40%,transparent)}
.badge.outline{background:transparent}
.badge.secondary{background:var(--secondary);color:var(--secondary-foreground)}
.badge.success{background:color-mix(in oklab,var(--success) 15%,transparent);color:var(--success);border-color:color-mix(in oklab,var(--success) 40%,transparent)}
.badge.warn{background:color-mix(in oklab,var(--warning) 15%,transparent);color:var(--warning);border-color:color-mix(in oklab,var(--warning) 40%,transparent)}
.badge.destr{background:color-mix(in oklab,var(--destructive) 15%,transparent);color:var(--destructive);border-color:color-mix(in oklab,var(--destructive) 40%,transparent)}
.badge.info{background:color-mix(in oklab,var(--info) 15%,transparent);color:var(--info);border-color:color-mix(in oklab,var(--info) 40%,transparent)}

/* ===== 表单（Input / Select / Textarea / Label / Switch） ===== */
.input,.select,.textarea{width:100%;background:transparent;border:1px solid var(--input);
  border-radius:calc(var(--radius) - 4px);padding:7px 12px;font:inherit;font-size:13px;color:var(--foreground);
  outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.input::placeholder,.textarea::placeholder{color:color-mix(in oklab,var(--muted-foreground) 70%,transparent)}
.input:focus,.select:focus,.textarea:focus{border-color:var(--ring);
  box-shadow:0 0 0 2px color-mix(in oklab,var(--ring) 30%,transparent)}
.input:disabled,.select:disabled{opacity:.5;cursor:not-allowed}
.select{appearance:none;-webkit-appearance:none;padding-right:28px;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b93a7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center}
label.f{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted-foreground);font-weight:500}
label.f b{color:var(--foreground);font-weight:500;font-size:12px}
/* ===== Select / Combobox（shadcn SelectTrigger + Popover 内容） ===== */
.sel{position:relative;display:flex;min-width:0}
.sel-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;width:100%;
  height:36px;padding:0 12px;font:inherit;font-size:13px;color:var(--foreground);
  background:transparent;border:1px solid var(--input);border-radius:calc(var(--radius) - 4px);
  cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s;white-space:nowrap}
.sel-btn:hover{background:color-mix(in oklab,var(--accent) 55%,transparent)}
.sel-btn:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 2px color-mix(in oklab,var(--ring) 30%,transparent)}
.sel-btn:disabled{opacity:.5;cursor:not-allowed;pointer-events:none}
.sel-btn .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sel-btn .ph{color:var(--muted-foreground)}
.sel-btn svg.chev{width:14px;height:14px;flex-shrink:0;color:var(--muted-foreground);transition:transform .15s}
.sel.open .sel-btn svg.chev{transform:rotate(180deg)}
.sel-pop,.combo-pop{position:absolute;top:calc(100% + 6px);left:0;width:100%;min-width:100%;max-width:min(380px,80vw);
  max-height:300px;overflow:auto;z-index:70;background:var(--popover);color:var(--popover-foreground);
  border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);box-shadow:0 10px 38px oklch(0 0 0/.5);
  padding:4px;animation:pop .14s ease}
.combo-pop{top:calc(100% + 4px);max-height:260px}
.sel.pop-up .sel-pop,.combo.pop-up .combo-pop{top:auto;bottom:calc(100% + 6px)}
@keyframes pop{from{opacity:0;transform:translateY(-4px)}}
.sel-it{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;
  padding:6px 8px;font:inherit;font-size:13px;color:var(--foreground);background:transparent;border:none;
  border-radius:calc(var(--radius) - 4px);cursor:pointer}
.sel-it:hover{background:var(--accent)}
.sel-it .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sel-it .sub{font-size:11px;color:var(--muted-foreground);flex-shrink:0}
.sel-it svg.check{width:14px;height:14px;flex-shrink:0}
.sel-it.sel-on{font-weight:500;background:color-mix(in oklab,var(--accent) 60%,transparent)}
.sel-emb{font-size:12px;color:var(--muted-foreground);padding:7px 8px}
.combo{position:relative;display:flex;min-width:0}
.combo .input{width:100%}
.fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
/* Switch */
.sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;color:var(--foreground);user-select:none}
.sw input{position:absolute;opacity:0;width:0;height:0}
.sw .trk{width:34px;height:20px;border-radius:9999px;background:var(--input);position:relative;transition:.18s;border:1px solid var(--border);flex-shrink:0}
.sw .trk::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:9999px;background:var(--background);
  box-shadow:0 1px 2px oklch(0 0 0/.4);transition:.18s}
.sw input:checked+.trk{background:var(--primary);border-color:var(--primary)}
.sw input:checked+.trk::after{left:16px;background:var(--primary-foreground)}
.sw input:focus-visible+.trk{box-shadow:0 0 0 2px color-mix(in oklab,var(--ring) 40%,transparent)}
/* 预设 chips */
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.chip{border:1px dashed var(--input);background:transparent;color:var(--muted-foreground);border-radius:9999px;
  font-size:11.5px;padding:3px 10px;cursor:pointer;transition:.15s;font-family:inherit}
.chip:hover{color:var(--foreground);background:var(--accent);border-style:solid}
/* 模型行 */
.mrow{display:grid;grid-template-columns:1fr 64px 32px;gap:6px;align-items:center}
.mrow2{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.mcard{border:1px solid var(--border);border-radius:calc(var(--radius) - 4px);padding:9px 10px;margin-bottom:8px;background:var(--muted)}
.mrow .del{width:32px;height:32px;padding:0;color:var(--destructive);background:transparent;border:1px solid color-mix(in oklab,var(--destructive) 35%,transparent);border-radius:calc(var(--radius) - 4px);cursor:pointer;display:grid;place-items:center}
.mrow .del:hover{background:color-mix(in oklab,var(--destructive) 14%,transparent)}

/* ===== 统计块 ===== */
.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:14px}
.stat .s{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:10px 12px}
.stat .s b{font-size:1.3rem;font-weight:600;display:block;line-height:1.3;letter-spacing:-.02em}
.stat .s span{color:var(--muted-foreground);font-size:11.5px}

/* ===== Progress ===== */
.progress{height:8px;background:color-mix(in oklab,var(--primary) 20%,var(--muted));border-radius:9999px;overflow:hidden}
.progress>i{display:block;height:100%;background:var(--primary);border-radius:9999px;transition:width .5s}

/* ===== Table（shadcn Table） ===== */
.tbl-wrap{overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:calc(var(--radius) - 4px)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--muted-foreground);text-align:left;font-weight:500;padding:9px 10px;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--card)}
td{padding:8px 10px;border-bottom:1px solid color-mix(in oklab,var(--border) 55%,transparent);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr.click{cursor:pointer}
tbody tr.click:hover td{background:color-mix(in oklab,var(--accent) 55%,transparent)}
tbody tr.sel td{background:color-mix(in oklab,var(--primary) 10%,transparent)}

/* ===== Terminal（拉取日志） ===== */
.term{background:oklch(0.125 0.012 274);border:1px solid var(--border);border-radius:calc(var(--radius) - 4px);
  padding:10px 12px;height:240px;overflow:auto;font:11.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;color:oklch(0.76 0.015 274);word-break:break-all}
.log{background:oklch(0.125 0.012 274);border:1px solid var(--border);border-radius:calc(var(--radius) - 4px);
  padding:10px 12px;height:200px;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;
  white-space:pre-wrap;color:oklch(0.76 0.015 274);word-break:break-all}

/* ===== Sheet（shadcn Sheet · right） ===== */
.sheet-mask{position:fixed;inset:0;background:oklch(0 0 0/.62);display:none;z-index:60;backdrop-filter:blur(2px)}
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
.xbtn{width:30px;height:30px;padding:0;border-radius:calc(var(--radius) - 4px);display:grid;place-items:center}

/* ===== 题面渲染 ===== */
.stmt{font-size:13.5px;line-height:1.75;word-break:break-word;color:var(--foreground)}
.stmt h1,.stmt h2,.stmt h3{font-size:1.05em;font-weight:600;margin:1.2em 0 .5em;color:var(--foreground)}
.stmt p{margin:.6em 0}
.stmt code{background:var(--muted);border-radius:4px;padding:1px 5px;font-family:ui-monospace,Menlo,monospace;font-size:.9em}
.stmt pre{background:oklch(0.125 0.012 274);border:1px solid var(--border);border-radius:8px;padding:10px 12px;overflow:auto}
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

/* ===== 当前进行中的翻译 lane ===== */
.current{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.current .c{background:var(--muted);border:1px solid var(--border);border-radius:calc(var(--radius) - 4px);
  padding:5px 10px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px}
.current .c:hover{border-color:var(--ring)}

/* ===== Toast（sonner 风格 · 右下角堆叠） ===== */
#toasts{position:fixed;right:16px;bottom:calc(16px + var(--safe-b));display:flex;flex-direction:column;gap:8px;z-index:90;pointer-events:none}
.toast{pointer-events:auto;display:flex;align-items:center;gap:9px;background:var(--popover);color:var(--popover-foreground);
  border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);padding:10px 14px;max-width:min(460px,88vw);
  box-shadow:0 8px 30px oklch(0 0 0/.5);font-size:13px;animation:tin .22s ease}
.toast svg.ic{width:16px;height:16px}
.toast.ok svg.ic{color:var(--success)} .toast.err svg.ic{color:var(--destructive)}
.toast.out{opacity:0;transform:translateY(6px);transition:.25s}
@keyframes tin{from{opacity:0;transform:translateY(8px)}}

/* ===== 其他 ===== */
.alert{background:color-mix(in oklab,var(--destructive) 12%,var(--card));border:1px solid color-mix(in oklab,var(--destructive) 40%,transparent);
  color:var(--destructive);border-radius:var(--radius);padding:9px 14px;margin-bottom:14px;font-size:12.5px}
.envline{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pager{display:flex;gap:6px;align-items:center;margin-top:10px;flex-wrap:wrap}
.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hint{color:var(--muted-foreground);font-size:11.5px;margin-top:10px;line-height:1.6}
.sep{height:1px;background:var(--border);margin:14px 0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.hide-sm{display:revert}
@media(max-width:720px){.hide-sm{display:none!important}}
@media(max-width:720px){
  .wrap{padding:14px 10px calc(48px + var(--safe-b))}
  .card-h,.card-c{padding:12px 14px}
  .stat{grid-template-columns:repeat(2,1fr)}
  .stat .s b{font-size:1.1rem}
  .btn{height:38px}
  .btn.sm{height:34px}
  .top-in{padding:0 10px;gap:8px}
  .log{height:150px;font-size:11px}
  .tab{padding:6px 10px;font-size:12px}
  .sheet{transition:transform .16s ease}
  .fgrid{grid-template-columns:repeat(2,1fr)}
}
</style>
</head>
<body>

<header class="top">
  <div class="top-in">
    <div class="brand">
      <span class="logo"><svg class="ic" viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 6h8"/><path d="M17 3v10"/><path d="M14 21 20 8l6 13"/></svg></span>
      <b>AI 翻译控制台</b>
      <span class="badge outline hide-sm">ac.isam.top</span>
    </div>
    <nav class="tabs" id="mainTabs">
      <button class="tab active" data-v="translate"><svg class="ic" viewBox="0 0 24 24"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 6h8"/><path d="M17 3v10"/><path d="M14 21 20 8l6 13"/></svg>翻译</button>
      <button class="tab" data-v="fetch"><svg class="ic" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>拉取</button>
      <button class="tab" data-v="tasks"><svg class="ic" viewBox="0 0 24 24"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>任务</button>
      <button class="tab" data-v="bank"><svg class="ic" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>题库</button>
      <button class="tab" data-v="logs"><svg class="ic" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>日志</button>
    </nav>
  </div>
</header>

<main class="wrap">
  <div id="fatalBar" class="alert" hidden></div>

  <!-- ============ Tab: 翻译 ============ -->
  <section id="tab-translate">
    <div class="stat" id="topStats"></div>

    <div class="card">
      <div class="card-h">
        <div><b>端点与模型</b><p class="desc">OpenAI 兼容端点 · 多模型并行 · 每模型可配独立 URL / Key</p></div>
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
        <div id="saveHint" class="muted" style="font-size:11.5px;margin-top:2px"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">
        <div><b>翻译任务</b><p class="desc">未翻译题面按比赛开始时间倒序派发 · 支持按筛选重译</p></div>
        <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
          <button class="btn ghost sm" id="btnScan">重新扫描</button>
          <button class="btn destructive sm" id="btnStop">停止</button>
          <button class="btn sm" id="btnStart">开始翻译</button>
        </span>
      </div>
      <div class="card-c">
        <div class="row" style="margin-bottom:4px">
          <label class="f">本次翻译数量<div id="limitMount" style="width:170px"></div></label>
          <span class="muted" id="scanInfo" style="font-size:12px;flex:1;min-width:200px;padding-bottom:8px"></span>
        </div>
        <div class="row" style="margin-bottom:4px">
          <span class="muted" id="notesInfo" style="font-size:12px;flex:1;min-width:200px;padding-bottom:8px">样例说明：扫描中…</span>
          <label class="f" style="flex:0 0 130px">平台<div id="notesPlatformMount"></div></label>
          <label class="f" style="flex:0 0 130px">数量<div id="notesLimitMount"></div></label>
          <button class="btn outline sm" id="btnNotes" title="只补 samples[].note 的中文说明，不重译题面">补样例说明</button>
        </div>
        <div id="runBox"></div>
        <div id="modelStats" style="margin-top:12px"></div>
      </div>
    </div>
  </section>

  <!-- ============ Tab: 拉取 ============ -->
  <section id="tab-fetch" hidden>
    <div class="card">
      <div class="card-h">
        <div><b>手动拉取题目</b><p class="desc">与 CI 同一条管线（scripts/fetch.mjs · fetch-cf-gyms.mjs）· 拉完自动重扫进入翻译队列</p></div>
        <span class="envline" id="fetchEnv"></span>
      </div>
      <div class="card-c">
        <div class="tabs" id="fetchModeTabs">
          <button class="tab active" data-v="standard">标准三平台</button>
          <button class="tab" data-v="gym">CF Gym</button>
        </div>

        <div id="fetchFormStd" style="margin-top:14px">
          <div class="fgrid">
            <label class="f">AtCoder ABC 场数<input class="input mono" id="fAbc" type="number" min="0" max="2000" value="0"></label>
            <label class="f">AtCoder ARC 场数<input class="input mono" id="fArc" type="number" min="0" max="2000" value="0"></label>
            <label class="f">AtCoder AGC 场数<input class="input mono" id="fAgc" type="number" min="0" max="2000" value="0"></label>
            <label class="f">Codeforces 场数<input class="input mono" id="fCf" type="number" min="0" max="2000" value="0"></label>
            <label class="f">牛客官方赛场数<input class="input mono" id="fNc" type="number" min="0" max="2000" value="0"></label>
            <label class="f">历史回填题数<input class="input mono" id="fBack" type="number" min="0" max="2000" value="0"></label>
          </div>
          <div class="chips" id="fetchPresets">
            <button class="chip" data-p="3,1,1,3,2,10">CI 同款（3/1/1/3/2 + 回填10）</button>
            <button class="chip" data-p="0,0,0,5,0,0">只拉 CF 最近 5 场</button>
            <button class="chip" data-p="3,0,0,0,0,0">只拉 ABC 最近 3 场</button>
            <button class="chip" data-p="0,0,0,0,2,0">只拉牛客最近 2 场</button>
            <button class="chip" data-p="0,0,0,0,0,20">仅历史回填 20 题</button>
          </div>
          <p class="hint">0 = 跳过该项。标准拉取强制 <span class="mono">--no-translate --no-gyms</span>：翻译统一走本页「翻译」引擎，gym 用右侧 Gym 面板单独拉。CF 抓取需要 Playwright 浏览器过 Cloudflare 质询。</p>
        </div>

        <div id="fetchFormGym" hidden style="margin-top:14px">
          <div class="fgrid">
            <label class="f">运行模式<div id="fGymModeMount"></div></label>
            <label class="f">题面页数上限<input class="input mono" id="fGymPages" type="number" min="1" max="100000" value="60"></label>
            <label class="f">分钟预算<input class="input mono" id="fGymMinutes" type="number" min="1" max="720" value="10"></label>
            <label class="f">老 ID 补扫数<input class="input mono" id="fGymSweep" type="number" min="0" max="100000" value="0"></label>
            <label class="f">限处理场次（可空）<input class="input mono" id="fGymLimit" type="number" min="1" placeholder="不限"></label>
            <label class="f">指定 Gym ID（可空）<input class="input mono" id="fGymOnly" placeholder="104869,104662"></label>
          </div>
          <div class="row" style="margin-top:12px">
            <label class="sw"><input type="checkbox" id="fGymLogin" checked><span class="trk"></span>登录 Codeforces（受限 gym 兜底）</label>
          </div>
          <p class="hint">分钟预算到点自动 SIGTERM 存档退出，续跑无缝；完整性校验与统计用「Gym 进度」查看。全量模式耗时长，建议先跑 problems。</p>
        </div>

        <div class="sep"></div>
        <div class="row">
          <label class="sw" title="有头浏览器过 Cloudflare 质询成功率最高（CI 同款）"><input type="checkbox" id="cfHeaded" checked><span class="trk"></span>CF 有头浏览器</label>
          <span style="flex:1"></span>
          <button class="btn outline sm" id="btnGymStatus">Gym 进度</button>
          <button class="btn destructive" id="btnFetchStop" hidden>停止拉取</button>
          <button class="btn" id="btnFetch">开始拉取</button>
        </div>
        <div id="fetchState" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h">
        <div><b>拉取日志</b><p class="desc">子进程实时输出 · 最近 2000 行</p></div>
        <label class="sw"><input type="checkbox" id="fetchFollow" checked><span class="trk"></span>自动跟随</label>
      </div>
      <div class="card-c"><div class="term" id="fetchLog"></div></div>
    </div>

    <div class="card" id="gymStatusCard" hidden>
      <div class="card-h"><div><b>Gym 进度</b><p class="desc">fetch-cf-gyms.mjs --mode status（只读本地状态，不碰网络）</p></div>
        <button class="btn ghost sm xbtn" id="btnGymStatusClose">✕</button></div>
      <div class="card-c"><pre class="term" id="gymStatusBox" style="height:auto;max-height:320px;white-space:pre-wrap"></pre></div>
    </div>
  </section>

  <!-- ============ Tab: 任务 ============ -->
  <section id="tab-tasks" hidden>
    <div class="card">
      <div class="card-h"><b>任务记录</b><span class="muted" style="font-size:11.5px">点击任意一行查看流式对话原文</span></div>
      <div class="card-c">
        <div class="tbl-wrap" style="max-height:460px">
          <table><thead><tr>
            <th>状态</th><th>平台</th><th>题目</th><th class="hide-sm">模型</th><th class="hide-sm">输出</th><th class="hide-sm">思考</th><th class="hide-sm">用时</th>
          </tr></thead><tbody id="taskBody"></tbody></table>
        </div>
      </div>
    </div>
  </section>

  <!-- ============ Tab: 题库 ============ -->
  <section id="tab-bank" hidden>
    <div class="card">
      <div class="card-h"><b>题库</b><span class="muted" style="font-size:11.5px" id="bankHint"></span></div>
      <div class="card-c">
        <div class="row" style="margin-bottom:10px">
          <div class="tabs" id="bankTabs">
            <button class="tab" data-v="translated">已翻译</button>
            <button class="tab active" data-v="untranslated">未翻译</button>
            <button class="tab" data-v="all">全部</button>
          </div>
          <div id="bankModelMount" style="min-width:180px;display:none"></div>
          <input class="input" id="bankQ" placeholder="搜索 题号 / 标题 / 比赛…" style="flex:1;min-width:160px">
          <button class="btn outline sm" id="btnBankGo">搜索</button>
          <button class="btn secondary sm" id="btnRetrans" style="display:none">⟳ 重译本组</button>
        </div>
        <div class="tbl-wrap" style="max-height:500px">
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
  </section>

  <!-- ============ Tab: 日志 ============ -->
  <section id="tab-logs" hidden>
    <div class="card">
      <div class="card-h"><b>运行日志</b><span class="muted" style="font-size:11.5px">最近 40 条</span></div>
      <div class="card-c"><div class="log" id="logBox"></div></div>
    </div>
  </section>
</main>

<div class="sheet-mask" id="mask"></div>

<!-- 任务流式 Sheet -->
<div class="sheet" id="drawer">
  <div class="sheet-h">
    <div class="t"><b id="dtTitle">任务</b><span id="dtMeta" class="mono"></span></div>
    <button class="btn ghost sm xbtn" id="btnClose"><svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
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
    <label class="sw"><input type="checkbox" id="dtFollow" checked><span class="trk"></span>跟随</label>
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
    <button class="btn ghost sm xbtn" id="pdClose"><svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
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

<div id="toasts"></div>

<script>
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtN=n=>(n??0).toLocaleString("en-US");
const fmtT=s=>s==null?"—":(s>=3600?(s/3600).toFixed(1)+"h":s>=60?Math.round(s/60)+"m":Math.round(s)+"s");
const fmtTs=ts=>{if(!ts)return "—";const d=new Date(ts);return isNaN(d)?"—":d.toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})};
const PL={atcoder:"AtCoder",codeforces:"CF",nowcoder:"牛客","cf-gyms":"Gym"};
const PC={atcoder:"success",codeforces:"primary",nowcoder:"warn","cf-gyms":"info"};
const SC={running:["primary","进行中"],done:["success","完成"],failed:["destr","失败"],skipped:["outline","跳过"],cancelled:["outline","已中断"]};
const IC_OK='<svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_ERR='<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
function badge(cls,txt){return '<span class="badge '+cls+'">'+esc(txt)+'</span>'}
function toast(msg,kind){
  const t=document.createElement("div");
  t.className="toast"+(kind==="err"?" err":kind==="ok"?" ok":"");
  t.innerHTML=(kind==="err"?IC_ERR:IC_OK)+"<span>"+esc(msg)+"</span>";
  $("#toasts").appendChild(t);
  setTimeout(()=>{t.classList.add("out");setTimeout(()=>t.remove(),260)},3600);
}
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{"Content-Type":"application/json"}},opt));let j={};try{j=await r.json()}catch(e){j={error:"HTTP "+r.status}};if(j.error)toast(j.error,"err");return j}

/* ================= shadcn Select / Combobox 组件 ================= */
const CHECK_SVG='<svg class="check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
const OPEN_POPS=new Set();
function closeAllPops(){OPEN_POPS.forEach(fn=>fn());OPEN_POPS.clear()}
let modelCatalog=[];   // 从端点加载的模型清单 [{id,name,owner}]
function comboShow(pop,inp){
  const q=inp.value.trim().toLowerCase();
  const list=modelCatalog.filter(m=>!q||m.id.toLowerCase().includes(q)).slice(0,60);
  if(!list.length){pop.hidden=true;return}
  const closer=()=>{pop.hidden=true;OPEN_POPS.delete(closer)};
  pop.innerHTML=list.map(m=>'<button type="button" class="sel-it" data-id="'+esc(m.id)+'"><span class="lbl mono">'+esc(m.id)+'</span><span class="sub">'+esc(m.owner||"")+'</span></button>').join("");
  pop.querySelectorAll(".sel-it").forEach(b=>b.onclick=()=>{
    inp.value=b.dataset.id;inp.dispatchEvent(new Event("input"));closer();
  });
  const wrap=pop.parentElement, r=wrap.getBoundingClientRect();
  pop.classList.toggle("pop-up",r.bottom+300>innerHeight&&r.top>300);
  closeAllPops();OPEN_POPS.add(closer);
  pop.hidden=false;
}
function shadcnSelect(mount,{items=[],value=null,placeholder="请选择",onPick=null}){
  const el=document.createElement("div");el.className="sel";
  el.innerHTML='<button type="button" class="sel-btn" aria-haspopup="listbox"><span class="val"></span><svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button><div class="sel-pop" role="listbox" hidden></div>';
  mount.appendChild(el);
  const btn=el.querySelector(".sel-btn"),val=el.querySelector(".val"),pop=el.querySelector(".sel-pop");
  const cur={items,value};
  const find=v=>cur.items.find(x=>String(x.v)===String(v));
  function renderPop(){
    pop.innerHTML=cur.items.length?cur.items.map(it=>
      '<button type="button" role="option" class="sel-it'+(String(it.v)===String(cur.value)?" sel-on":"")+'" data-v="'+esc(String(it.v))+'"><span class="lbl">'+esc(it.label)+'</span>'+(String(it.v)===String(cur.value)?CHECK_SVG:"")+'</button>').join("")
      :'<div class="sel-emb">无选项</div>';
    pop.querySelectorAll(".sel-it").forEach(b=>b.onclick=()=>{set(b.dataset.v);close();if(onPick)onPick(b.dataset.v)});
  }
  function syncVal(){
    const it=find(cur.value);
    val.innerHTML=it?esc(it.label):'<span class="ph">'+esc(placeholder)+'</span>';
    val.title=it?it.label:"";
  }
  function set(v){cur.value=v;syncVal();renderPop()}
  function close(){el.classList.remove("open");pop.hidden=true;OPEN_POPS.delete(close)}
  function open(){
    closeAllPops();OPEN_POPS.add(close);el.classList.add("open");pop.hidden=false;
    const r=btn.getBoundingClientRect();
    el.classList.toggle("pop-up",r.bottom+330>innerHeight&&r.top>340);
  }
  btn.onclick=()=>{pop.hidden?open():close()};
  const api={el,get:()=>cur.value,close,
    setItems(items2,keep=true){
      cur.items=items2;
      if(!keep||!find(cur.value)){cur.value=items2.length?items2[0].v:null}
      syncVal();renderPop();
    },
    setValue(v){set(v)}};
  set(value);
  return api;
}
document.addEventListener("click",e=>{
  if(!e.target.closest(".sel")&&!e.target.closest(".combo"))closeAllPops();
});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAllPops()});
const limitSel=shadcnSelect($("#limitMount"),{items:[
  {v:"50",label:"50 题"},{v:"200",label:"200 题"},{v:"500",label:"500 题"},
  {v:"1000",label:"1000 题"},{v:"0",label:"全部未翻译"}],value:"0"});
const notesPlatformSel=shadcnSelect($("#notesPlatformMount"),{items:[
  {v:"",label:"全部平台"},{v:"atcoder",label:"AtCoder"},{v:"codeforces",label:"Codeforces"},
  {v:"nowcoder",label:"牛客"},{v:"cf-gyms",label:"Gym"}],value:"atcoder"});
const notesLimitSel=shadcnSelect($("#notesLimitMount"),{items:[
  {v:"20",label:"20 题"},{v:"50",label:"50 题"},{v:"200",label:"200 题"},
  {v:"0",label:"全部待补"}],value:"50"});
const gymModeSel=shadcnSelect($("#fGymModeMount"),{items:[
  {v:"problems",label:"problems · 题面回填 + 老ID补扫"},
  {v:"full",label:"full · 全量（列表全扫 + 全区间补扫）"}],value:"problems"});

/* ================= Tab 切换 ================= */
function showTab(v){
  $$("#mainTabs .tab").forEach(t=>t.classList.toggle("active",t.dataset.v===v));
  ["translate","fetch","tasks","bank","logs"].forEach(k=>{$("#tab-"+k).hidden=k!==v});
  if(v==="tasks")loadTasks();
  if(v==="bank")loadBank();
  if(v==="fetch")loadEnvCheck();
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
    const wrap=document.createElement("div");wrap.className="combo";
    const inp=document.createElement("input");inp.className="input mono";inp.value=m.model;inp.placeholder="provider/model-name";
    const pop=document.createElement("div");pop.className="combo-pop";pop.hidden=true;
    inp.addEventListener("focus",()=>comboShow(pop,inp));
    inp.addEventListener("input",()=>{cfgModels[i].model=inp.value.trim();modelsDirty=true;comboShow(pop,inp)});
    wrap.append(inp,pop);
    const cc=document.createElement("input");cc.className="input mono";cc.type="number";cc.min="1";cc.max="200";cc.value=m.concurrency;cc.title="并发数（最大 200）";
    cc.oninput=()=>{cfgModels[i].concurrency=Math.max(1,Math.min(200,+cc.value||1));modelsDirty=true};
    const del=document.createElement("button");del.className="del";del.innerHTML='<svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';del.title="删除此模型";
    del.onclick=()=>{if(cfgModels.length<=1){toast("至少保留一个模型","err");return}cfgModels.splice(i,1);modelsDirty=true;renderModels()};
    row.append(wrap,cc,del);
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
  if(!j.models||!j.models.length){toast("端点未返回模型清单","err");return}
  modelCatalog=j.models;
  toast("已载入 "+j.models.length+" 个模型，输入框聚焦可下拉选择","ok");
};
async function saveConfig(silent){
  const j=await api("/api/config",{method:"POST",body:JSON.stringify({baseUrl:$("#baseUrl").value.trim(),apiKey:$("#apiKey").value,models:cfgModels})});
  if(j.config){cfgModels=j.config.models;modelsDirty=false;renderModels();$("#apiKey").value="";
    $("#saveHint").textContent="已保存 "+new Date().toLocaleTimeString("zh-CN")+" · key "+(j.config.apiKeySet?"已设置":"为空");
    if(!silent)toast("配置已保存，下一轮生效","ok")}
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
$("#btnStart").onclick=async()=>{if(modelsDirty)await saveConfig(true);const j=await api("/api/start",{method:"POST",body:JSON.stringify({limit:+limitSel.get()})});if(j.message)toast(j.message,"ok");showTab("translate");refresh()};
$("#btnNotes").onclick=async()=>{
  if(modelsDirty)await saveConfig(true);
  const n=+notesLimitSel.get(),plat=notesPlatformSel.get();
  if(!confirm("只补样例说明（samples[].note → noteZh），不重译题面。\n"+(plat||"全部平台")+" · "+(n?n+" 题":"全部待补")+"，继续？"))return;
  const j=await api("/api/notes/start",{method:"POST",body:JSON.stringify({limit:n,platform:plat})});
  if(j.message){toast(j.message,"ok");showTab("translate");refresh()}
};
$("#btnStop").onclick=async()=>{await api("/api/stop",{method:"POST"});toast("停止中…")};
$("#btnScan").onclick=async()=>{toast("扫描中…");const j=await api("/api/scan",{method:"POST"});if(!j.error){toast("全量 "+fmtN(j.total)+" 题 · 未翻译 "+fmtN(j.untranslated),"ok");loadBank()}refresh()};

/* ================= 主状态轮询 ================= */
let lastLogLen=0,lastRunField="",lastScanJson="";
async function refresh(){
  const s=await fetch("/api/state").then(r=>r.json()).catch(()=>null);
  if(!s)return;
  if(document.activeElement!==$("#baseUrl"))$("#baseUrl").value=s.config.baseUrl;
  if(!modelsDirty&&JSON.stringify(cfgModels)!==JSON.stringify(s.config.models)){cfgModels=s.config.models.map(m=>({...m}));renderModels()}
  const sc=s.scan;
  const topHtml=
    '<div class="s"><b>'+fmtN(sc.total)+'</b><span>题库总题数</span></div>'+
    '<div class="s"><b class="ok">'+fmtN(sc.translated)+'</b><span>已翻译</span></div>'+
    '<div class="s"><b class="warn">'+fmtN(sc.untranslated)+'</b><span>未翻译</span></div>'+
    '<div class="s"><b>'+Object.keys(sc.byModel||{}).length+'</b><span>翻译模型数</span></div>'+
    (s.run&&s.run.active?'<div class="s"><b class="ok">'+fmtN(s.run.done)+'</b><span>本轮已完成</span></div>':'');
  if(topHtml!==lastScanJson){$("#topStats").innerHTML=topHtml;lastScanJson=topHtml;
    $("#scanInfo").textContent="未翻译 "+fmtN(sc.untranslated)+"（AtCoder "+fmtN(sc.byPlatform.atcoder||0)+" / CF "+fmtN(sc.byPlatform.codeforces||0)+" / 牛客 "+fmtN(sc.byPlatform.nowcoder||0)+" / Gym "+fmtN(sc.byPlatform["cf-gyms"]||0)+"）";
    fillModelFilter(sc.byModel||{});
    const hm=Object.entries(sc.byModel||{}).map(([m,c])=>'<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><span class="badge outline mono" style="max-width:230px;overflow:hidden;text-overflow:ellipsis">'+esc(m)+'</span><b style="font-size:12px">'+fmtN(c.total)+'</b></div>').join("");
    $("#modelStats").innerHTML=hm?'<div style="font-size:12px;color:var(--muted-foreground);margin-bottom:4px;font-weight:500">已翻译题面的翻译模型分布</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 14px">'+hm+'</div>':"";
  }
  // 样例说明补译进度（与题面翻译分开统计）
  const nt=s.notes||{};
  if($("#notesInfo"))$("#notesInfo").textContent="样例说明：待补 "+fmtN(nt.pendingProblems||0)+" 题 / "+fmtN(nt.pendingNotes||0)+
    " 条（已有 "+fmtN(nt.notes||0)+" 条中文说明）";
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
  const items=[{v:"",label:"全部翻译模型"}].concat(Object.keys(byModel).sort().map(m=>({v:m,label:m+"（"+fmtN(byModel[m].total)+"）"})));
  bankModelSel.setItems(items,true);
  bankModel=String(bankModelSel.get()||"");
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
  if(!key){toast("任务记录不存在或已被回收","err");return}
  drawerKey=key;drawerCursor=0;drawerRText="";drawerRCursor=0;drawerText="";drawerView="content";
  $$("#dtTabs .tab").forEach(t=>t.classList.toggle("active",t.dataset.v==="content"));
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
const bankModelSel=shadcnSelect($("#bankModelMount"),{items:[{v:"",label:"全部翻译模型"}],value:"",placeholder:"全部翻译模型",onPick:v=>{bankModel=String(v||"");bankOffset=0;loadBank()}});
$$("#bankTabs .tab").forEach(t=>t.onclick=()=>{
  bankOnly=t.dataset.v;bankOffset=0;
  $$("#bankTabs .tab").forEach(x=>x.classList.toggle("active",x===t));
  $("#bankModelMount").style.display=bankOnly==="untranslated"?"none":"";
  loadBank();
});
$("#btnRetrans").onclick=async()=>{
  const n=$("#btnRetrans").dataset.n||"?";
  if(!confirm("用当前配置的模型重新翻译本组 "+n+" 题？已有译文会被覆盖。"))return;
  const j=await api("/api/start",{method:"POST",body:JSON.stringify({limit:0,retranslate:true,only:bankOnly,model:bankModel,q:bankQ})});
  if(j.message){toast(j.message,"ok");showTab("translate");refresh()}
};
$("#btnBankGo").onclick=()=>{bankQ=$("#bankQ").value.trim();bankModel=String(bankModelSel.get()||"");bankOffset=0;loadBank()};
$("#bankQ").onkeydown=e=>{if(e.key==="Enter")$("#btnBankGo").onclick()};
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
  if(!j||j.error){toast(j&&j.error||"读取失败","err");return}
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
  try{await navigator.clipboard.writeText(txt);toast("已复制"+(pdView==="zh"?"译文":"原文"),"ok")}catch(e){toast("复制失败："+e.message,"err")}
};

/* ================= 拉取（与 CI 同管线） ================= */
let fetchMode="standard",fetchCur=0,fetchActive=false,fetchEnvLoaded=false;
$$("#fetchModeTabs .tab").forEach(t=>t.onclick=()=>{
  fetchMode=t.dataset.v;
  $$("#fetchModeTabs .tab").forEach(x=>x.classList.toggle("active",x===t));
  $("#fetchFormStd").hidden=fetchMode!=="standard";
  $("#fetchFormGym").hidden=fetchMode!=="gym";
});
$$("#fetchPresets .chip").forEach(c=>c.onclick=()=>{
  const v=c.dataset.p.split(",");
  const ids=["fAbc","fArc","fAgc","fCf","fNc","fBack"];
  ids.forEach((id,i)=>{$("#"+id).value=v[i]||0});
});
async function loadEnvCheck(){
  if(fetchEnvLoaded)return;
  const j=await fetch("/api/fetch/envcheck").then(r=>r.json()).catch(()=>null);
  if(!j)return;
  fetchEnvLoaded=true;
  const items=[];
  items.push(j.node?'<span class="badge success">node '+esc(j.node)+'</span>':'<span class="badge destr">node 缺失</span>');
  items.push(j.chromium?'<span class="badge success">Chromium ✓</span>':'<span class="badge warn">Chromium 未装（CF 抓取需要，npx playwright install chromium）</span>');
  items.push(j.pdftotext?'<span class="badge success">pdftotext ✓</span>':'<span class="badge warn">pdftotext 缺失（gym PDF 题面需要，brew install poppler）</span>');
  const ok=j.scripts&&j.scripts.fetch&&j.scripts.gym;
  items.push(ok?'<span class="badge success">管线脚本 ✓</span>':'<span class="badge destr">管线脚本缺失</span>');
  $("#fetchEnv").innerHTML=items.join(" ");
}
function renderFetchState(j){
  const box=$("#fetchState");
  $("#btnFetch").disabled=!!j.active;
  $("#btnFetchStop").hidden=!j.active;
  let html="";
  if(j.active||j.exit!=null){
    const st=j.active
      ?(j.stopping?'<span class="badge warn">停止中…</span>':'<span class="badge primary">拉取中</span>')
      :(j.exit===0?'<span class="badge success">已完成</span>'
        :(j.stopping?'<span class="badge outline">已停止（现场已存档，可续跑）</span>':'<span class="badge destr">退出码 '+j.exit+'</span>'));
    const kindTxt=j.kind==="gym"?"CF Gym":"标准三平台";
    html='<div class="frow"><b>'+st+'</b><span class="badge outline">'+kindTxt+'</span>'+
      (j.active&&j.startedAt?'<span class="muted mono">已运行 '+fmtT(Date.now()/1000-j.startedAt)+'</span>':"")+
      (!j.active&&j.endedAt&&j.startedAt?'<span class="muted mono">用时 '+fmtT(j.endedAt-j.startedAt)+'</span>':"")+
      '</div><div class="mono muted" style="font-size:11px;margin-top:6px;word-break:break-all">$ '+esc((j.cmd||[]).join(" "))+'</div>';
  }else{
    html='<div class="muted" style="font-size:12.5px">空闲 — 选择类型与数量后点「开始拉取」。</div>';
  }
  if(box._h!==html){box._h=html;box.innerHTML=html}
}
async function pollFetch(){
  const j=await fetch("/api/fetch/state?cursor="+fetchCur).then(r=>r.json()).catch(()=>null);
  if(!j)return;
  if(j.reset){fetchCur=0;$("#fetchLog").textContent=""}
  if(j.lines&&j.lines.length){
    const box=$("#fetchLog");
    const near=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
    for(const l of j.lines)box.appendChild(document.createTextNode(l.text+"\n"));
    while(box.childNodes.length>1500)box.removeChild(box.firstChild);
    if($("#fetchFollow").checked||near)box.scrollTop=box.scrollHeight;
  }
  fetchCur=j.cursor;
  renderFetchState(j);
  const was=fetchActive;fetchActive=!!j.active;
  if(was&&!j.active){
    if(j.exit===0)toast("拉取完成，已自动重新扫描","ok");
    else if(j.exit!=null&&j.stopping)toast("拉取已停止 · gym 现场已存档，可续跑");
    else if(j.exit!=null)toast("拉取进程异常退出（码 "+j.exit+"）","err");
    api("/api/scan",{method:"POST"}).then(()=>{});
  }
}
$("#btnFetch").onclick=async()=>{
  const p={kind:fetchMode,headed:$("#cfHeaded").checked};
  if(fetchMode==="standard"){
    const ids=["fAbc","fArc","fAgc","fCf","fNc","fBack"],keys=["abc","arc","agc","cf","nc","backfill"];
    ids.forEach((id,i)=>{p[keys[i]]=(+$("#"+id).value||0)});
    if(!keys.some(k=>p[k]>0)){toast("请至少填写一个扫描/回填数量","err");return}
  }else{
    p.mode=gymModeSel.get();
    p.pages=+$("#fGymPages").value||60;
    p.minutes=+$("#fGymMinutes").value||10;
    p.sweep=+$("#fGymSweep").value||0;
    p.login=$("#fGymLogin").checked;
    const lg=$("#fGymLimit").value.trim();if(lg)p.limitGyms=+lg;
    const og=$("#fGymOnly").value.trim();if(og)p.onlyGym=og;
  }
  const j=await api("/api/fetch/start",{method:"POST",body:JSON.stringify(p)});
  if(j.ok){toast(j.message||"已启动拉取","ok");fetchCur=0;$("#fetchLog").textContent="";fetchActive=true;pollFetch()}
};
$("#btnFetchStop").onclick=async()=>{await api("/api/fetch/stop",{method:"POST"});toast("停止中…（gym 会存档现场）")};
$("#btnGymStatus").onclick=async()=>{
  const b=$("#btnGymStatus");b.disabled=true;b.textContent="查询中…";
  const j=await fetch("/api/fetch/gym-status").then(r=>r.json()).catch(()=>null);
  b.disabled=false;b.textContent="Gym 进度";
  $("#gymStatusCard").hidden=false;
  $("#gymStatusBox").textContent=j&&j.ok?JSON.stringify(j.data,null,2):"✗ "+((j&&j.error)||"查询失败");
};
$("#btnGymStatusClose").onclick=()=>{$("#gymStatusCard").hidden=true};

/* ================= 启动 ================= */
function guard(name,fn){try{fn()}catch(e){console.error("["+name+"]",e);
  const b=$("#fatalBar");if(b){b.hidden=false;b.textContent="初始化异常 ["+name+"]: "+e.message}}}
guard("models",renderModels);
guard("state",refresh);
guard("bank",loadBank);
guard("fetch",pollFetch);
setInterval(()=>guard("state",refresh),1000);
setInterval(()=>{if(!drawerKey)guard("tasks",loadTasks)},5000);
setInterval(()=>{if(fetchActive||$("#tab-fetch").hidden===false)guard("fetch",pollFetch)},1000);
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
        elif u.path == "/api/notes":
            self._json(APP.notes_stats((q.get("platform") or [""])[0]))
        elif u.path == "/api/tasks":
            self._json({"tasks": APP.tasks_list()})
        elif u.path == "/api/task":
            key = (q.get("key") or [""])[0]
            cursor = int((q.get("cursor") or ["0"])[0] or 0)
            rcursor = int((q.get("rcursor") or ["0"])[0] or 0)
            self._json(APP.task_detail(key, cursor, rcursor))
        elif u.path == "/api/models":
            self._json({"models": self._list_models()})
        elif u.path == "/api/fetch/state":
            cursor = int((q.get("cursor") or ["0"])[0] or 0)
            self._json(APP.fetch_tail(cursor))
        elif u.path == "/api/fetch/envcheck":
            self._json(APP.fetch_envcheck())
        elif u.path == "/api/fetch/gym-status":
            self._json(APP.gym_status())
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
        elif u.path == "/api/fetch/start":
            ok, msg = APP.fetch_start(body)
            self._json({"ok": ok, "message": msg} if ok else {"error": msg})
        elif u.path == "/api/fetch/stop":
            self._json({"ok": APP.fetch_stop()})
        elif u.path == "/api/notes/start":
            try:
                limit = int(body.get("limit") or 0)
            except (TypeError, ValueError):
                limit = 0
            platform = str(body.get("platform") or "").strip()
            problems = body.get("problems")
            if isinstance(problems, str):
                problems = [x for x in problems.split(",") if x.strip()]
            elif not isinstance(problems, list):
                problems = []
            ok, msg = APP.notes_start(limit=limit, platform=platform, problems=problems)
            self._json({"ok": ok, "message": msg} if ok else {"error": msg})
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


def run_notes_cli(app, args):
    """一次性补样例说明（不启动 Web 控制台）；返回进程退出码。"""
    ids = [x.strip() for x in str(args.problems or "").split(",") if x.strip()]
    platform = (args.platform or "").strip()
    app.scan()

    def flush_logs(seen):
        with app.lock:
            logs = list(app._logs)
        for line in logs[seen:]:
            print(line, flush=True)
        return len(logs)

    seen = flush_logs(0)   # 先把扫描日志吐出来
    stats = app.notes_stats(platform)
    print("[notes] 样例说明：{} 题有说明 / {} 条；待补 {} 题 / {} 条".format(
        stats["problems"], stats["notes"], stats["pendingProblems"], stats["pendingNotes"]), flush=True)
    rows = app.notes_queue(platform=platform, problems=ids, limit=args.limit,
                           retranslate=args.retranslate)
    if not rows:
        print("[notes] 没有待补说明的题目（数据已齐全或筛选条件过窄）", flush=True)
        return 0
    print("[notes] 本轮队列 {} 题：".format(len(rows)), flush=True)
    for r in rows[:50]:
        print("  - [{}] {} {}（{} 条待补）".format(r["platform"], r["id"], r["title"],
                                                  r.get("notesMissing")), flush=True)
    if len(rows) > 50:
        print("  ... 其余 {} 题省略".format(len(rows) - 50), flush=True)
    if args.dry_run:
        print("[notes] --dry-run：只列出，未发请求", flush=True)
        return 0

    ok, msg = app.notes_start(limit=args.limit, platform=platform, problems=ids,
                              retranslate=args.retranslate)
    if not ok:
        print("[notes] ✗ {}".format(msg), flush=True)
        return 2
    while True:
        with app.lock:
            run = app.run
            active = bool(run and run["active"])
        seen = flush_logs(seen)
        if not active:
            break
        time.sleep(0.4)
    seen = flush_logs(seen)
    with app.lock:
        run = app.run or {}
    done, failed = run.get("done", 0), run.get("failed", 0)
    print("[notes] 结束：完成 {} / 失败 {} / 跳过 {} / 中断 {}".format(
        done, failed, run.get("skipped", 0), run.get("cancelled", 0)), flush=True)
    return 0 if failed == 0 else 1


def main():
    global APP
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0，可被局域网/手机访问）")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--notes", action="store_true",
                    help="只补样例说明（samples[].note → noteZh），一次性执行、不启动 Web 控制台")
    ap.add_argument("--platform", default="",
                    help="--notes 时限定平台（atcoder / codeforces / nowcoder；默认全部）")
    ap.add_argument("--problems", default="",
                    help="--notes 时限定题号，逗号分隔（如 abc484_b,abc480_a）")
    ap.add_argument("--limit", type=int, default=0,
                    help="--notes 时本次最多处理多少题（0 = 全部待补）")
    ap.add_argument("--dry-run", action="store_true",
                    help="--notes 时只列出待补题目，不发请求、不写盘")
    ap.add_argument("--retranslate", action="store_true",
                    help="--notes 时重译已有说明（覆盖 noteZh，用于提示词升级后重刷质量）")
    args = ap.parse_args()
    APP = App(args.root)
    if args.notes:
        return run_notes_cli(APP, args)
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
    sys.exit(main() or 0)
