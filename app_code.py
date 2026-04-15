import os
import time
import gc

import app_state as st
from app_common import (
    append_run_log,
    atomic_write_json,
    atomic_write_text,
    ensure_dir,
    is_safe_history_file,
    parse_json_body,
    query_param,
    read_json,
    read_text,
    runtime_get,
    runtime_set_many,
    runtime_snapshot,
    send_json,
    ticks_ms,
)
from app_device import (
    code_gpio_read,
    code_gpio_release,
    code_gpio_write,
    code_led_set,
    code_servo_angle,
    code_servo_speed,
)


def code_prepare_dirs():
    ensure_dir(st.CODE_DIR)
    ensure_dir(st.CODE_HISTORY_DIR)
    if read_json(st.CODE_META_FILE, None) is None:
        atomic_write_json(st.CODE_META_FILE, {
            "activeVersion": "",
            "activeSavedAt": 0,
            "activeFile": "",
            "lastRunAt": 0,
            "lastRunStatus": "idle",
        })
    if read_json(st.CODE_HISTORY_INDEX_FILE, None) is None:
        atomic_write_json(st.CODE_HISTORY_INDEX_FILE, [])
    if read_text(st.CODE_DRAFT_FILE, None) is None:
        atomic_write_text(st.CODE_DRAFT_FILE, "# 在这里写调试代码\n")
    if read_text(st.CODE_ACTIVE_FILE, None) is None:
        atomic_write_text(st.CODE_ACTIVE_FILE, "# 当前固化代码为空\n")
    if read_text(st.CODE_RUN_LOG_FILE, None) is None:
        atomic_write_text(st.CODE_RUN_LOG_FILE, "")
    if read_json(st.CODE_RUNTIME_CONFIG_FILE, None) is None:
        atomic_write_json(st.CODE_RUNTIME_CONFIG_FILE, sanitize_runtime_config(st.DEFAULT_CODE_RUNTIME_CONFIG))
    load_runtime_config()


def mark_run_finished(status, output, error, version="", note=""):
    ended = ticks_ms()
    started = runtime_get("startedMs", ended)
    runtime_set_many({
        "running": False,
        "status": status,
        "output": output,
        "error": error,
        "endedMs": ended,
        "durationMs": max(0, ended - started),
        "lastVersion": version,
        "lastNote": note,
    })


def _to_int(value, default_value, min_value, max_value):
    try:
        iv = int(value)
    except Exception:
        iv = int(default_value)
    if iv < min_value:
        iv = min_value
    if iv > max_value:
        iv = max_value
    return iv


def sanitize_runtime_config(data):
    if not isinstance(data, dict):
        data = {}
    base = st.DEFAULT_CODE_RUNTIME_CONFIG

    limits_enabled = bool(data.get("limitsEnabled", True))
    boot_autorun_enabled = bool(data.get("bootAutorunEnabled", False))

    import_blocklist = data.get("importBlocklist", None)
    # 兼容旧配置：若只有白名单字段，自动迁移到默认黑名单
    if import_blocklist is None and isinstance(data.get("importWhitelist"), list):
        import_blocklist = list(base["importBlocklist"])
    if not isinstance(import_blocklist, list):
        import_blocklist = base["importBlocklist"]
    safe_blocklist = []
    for name in import_blocklist:
        s = str(name).strip()
        if not s:
            continue
        if s not in safe_blocklist:
            safe_blocklist.append(s)
    if not safe_blocklist and limits_enabled:
        safe_blocklist = list(base["importBlocklist"])

    heartbeat_stall_src = data.get("heartbeatStallMs", data.get("timeoutMs", base["heartbeatStallMs"]))
    if not limits_enabled:
        return {
            "limitsEnabled": False,
            "bootAutorunEnabled": boot_autorun_enabled,
            "codeTextLimit": base["codeTextLimit"],
            "callBudget": base["callBudget"],
            "iterBudget": base["iterBudget"],
            "outputMaxChars": base["outputMaxChars"],
            "outputMaxLines": base["outputMaxLines"],
            "runLogMaxChars": base.get("runLogMaxChars", 16000),
            "httpHeaderMaxBytes": base["httpHeaderMaxBytes"],
            "httpBodyMaxBytes": base["httpBodyMaxBytes"],
            "importBlocklist": list(base["importBlocklist"]),
            "heartbeatIntervalMs": base["heartbeatIntervalMs"],
            "heartbeatStallMs": base["heartbeatStallMs"],
        }
    return {
        "limitsEnabled": limits_enabled,
        "bootAutorunEnabled": boot_autorun_enabled,
        "codeTextLimit": _to_int(data.get("codeTextLimit", base["codeTextLimit"]), base["codeTextLimit"], 0, 600000),
        "callBudget": _to_int(data.get("callBudget", base["callBudget"]), base["callBudget"], 0, 1000000),
        "iterBudget": _to_int(data.get("iterBudget", base["iterBudget"]), base["iterBudget"], 0, 1000000),
        "outputMaxChars": _to_int(data.get("outputMaxChars", base["outputMaxChars"]), base["outputMaxChars"], 0, 800000),
        "outputMaxLines": _to_int(data.get("outputMaxLines", base["outputMaxLines"]), base["outputMaxLines"], 0, 200000),
        "runLogMaxChars": _to_int(data.get("runLogMaxChars", base.get("runLogMaxChars", 16000)), base.get("runLogMaxChars", 16000), 0, 1200000),
        "httpHeaderMaxBytes": _to_int(data.get("httpHeaderMaxBytes", base["httpHeaderMaxBytes"]), base["httpHeaderMaxBytes"], 0, 262144),
        "httpBodyMaxBytes": _to_int(data.get("httpBodyMaxBytes", base["httpBodyMaxBytes"]), base["httpBodyMaxBytes"], 0, 2000000),
        "importBlocklist": safe_blocklist,
        "heartbeatIntervalMs": _to_int(data.get("heartbeatIntervalMs", base["heartbeatIntervalMs"]), base["heartbeatIntervalMs"], 0, 10000),
        "heartbeatStallMs": _to_int(heartbeat_stall_src, base["heartbeatStallMs"], 0, 600000),
    }


def apply_runtime_config(cfg):
    limits_enabled = bool(cfg.get("limitsEnabled", True))
    st.CODE_LIMITS_ENABLED = limits_enabled
    st.CODE_BOOT_AUTORUN_ENABLED = bool(cfg.get("bootAutorunEnabled", False))

    if limits_enabled:
        st.CODE_MAX_TEXT = cfg["codeTextLimit"]
        st.CODE_RUN_TIMEOUT_MS = cfg["heartbeatStallMs"]
        st.CODE_MAX_CALLS = cfg["callBudget"]
        st.CODE_MAX_RANGE_ITEMS = cfg["iterBudget"]
        st.CODE_OUTPUT_MAX_CHARS = cfg["outputMaxChars"]
        st.CODE_OUTPUT_MAX_LINES = cfg["outputMaxLines"]
        st.CODE_RUN_LOG_MAX_CHARS = cfg["runLogMaxChars"]
        st.MAX_HEADER_BYTES = cfg["httpHeaderMaxBytes"]
        st.MAX_BODY_BYTES = cfg["httpBodyMaxBytes"]
        st.CODE_IMPORT_BLOCKLIST = tuple(cfg["importBlocklist"])
        st.CODE_LOOP_HEARTBEAT_INTERVAL_MS = cfg["heartbeatIntervalMs"]
        st.CODE_LOOP_STALL_MS = cfg["heartbeatStallMs"]
    else:
        # 关闭运行限制时，仅让运行时生效为无限制；保存值仍保留在 Flash。
        st.CODE_MAX_TEXT = 0
        st.CODE_RUN_TIMEOUT_MS = 0
        st.CODE_MAX_CALLS = 0
        st.CODE_MAX_RANGE_ITEMS = 0
        st.CODE_OUTPUT_MAX_CHARS = 0
        st.CODE_OUTPUT_MAX_LINES = 0
        st.CODE_RUN_LOG_MAX_CHARS = 0
        st.MAX_HEADER_BYTES = 0
        st.MAX_BODY_BYTES = 0
        st.CODE_IMPORT_BLOCKLIST = ()
        st.CODE_LOOP_HEARTBEAT_INTERVAL_MS = 0
        st.CODE_LOOP_STALL_MS = 0

    runtime_set_many({
        "limits": {
            "maxMs": st.CODE_RUN_TIMEOUT_MS,
            "maxOutputChars": st.CODE_OUTPUT_MAX_CHARS,
            "maxOutputLines": st.CODE_OUTPUT_MAX_LINES,
            "maxCalls": st.CODE_MAX_CALLS,
            "maxRangeItems": st.CODE_MAX_RANGE_ITEMS,
            "heartbeatIntervalMs": st.CODE_LOOP_HEARTBEAT_INTERVAL_MS,
            "heartbeatStallMs": st.CODE_LOOP_STALL_MS,
            "enabled": st.CODE_LIMITS_ENABLED,
        }
    })


def get_runtime_config():
    return sanitize_runtime_config(read_json(st.CODE_RUNTIME_CONFIG_FILE, st.DEFAULT_CODE_RUNTIME_CONFIG))


def load_runtime_config():
    cfg = sanitize_runtime_config(read_json(st.CODE_RUNTIME_CONFIG_FILE, st.DEFAULT_CODE_RUNTIME_CONFIG))
    apply_runtime_config(cfg)
    atomic_write_json(st.CODE_RUNTIME_CONFIG_FILE, cfg)
    return cfg


def preprocess_user_code(code_text):
    # 给 while 块注入循环守卫，避免纯死循环长期占用资源
    lines = code_text.split("\n")
    out = []
    for line in lines:
        out.append(line)
        stripped = line.lstrip()
        if not stripped.startswith("while "):
            continue
        colon_pos = stripped.find(":")
        if colon_pos < 0:
            continue
        if not stripped.endswith(":"):
            raise RuntimeError("inline while is not allowed")
        indent = line[:len(line) - len(stripped)]
        out.append(indent + "    __loop_guard__()")
        out.append(indent + "    __soft_watch__()")
    return "\n".join(out)


def run_user_code_job(job_id, code_text, source):
    class RunLimitError(Exception):
        pass

    output_lines = []
    line_buffer = ""
    output_chars = 0
    output_truncated = False
    mem_before = gc.mem_free() if hasattr(gc, "mem_free") else 0
    calls = {"count": 0}
    heartbeat = {"lastMs": ticks_ms(), "lastTouchMs": 0}

    def raise_limit(reason):
        raise RunLimitError(reason)

    def touch_budget(_tag=""):
        if runtime_get("stopRequested", False):
            raise_limit("stopped")
        calls["count"] += 1
        if st.CODE_MAX_CALLS > 0 and calls["count"] > st.CODE_MAX_CALLS:
            raise_limit("call budget exceeded")
        now = ticks_ms()
        if st.CODE_LOOP_STALL_MS > 0 and now - heartbeat["lastMs"] > st.CODE_LOOP_STALL_MS:
            raise_limit("heartbeat lost")

    def soft_watch(force=False):
        now = ticks_ms()
        if (not force) and (now - heartbeat["lastTouchMs"] < st.CODE_LOOP_HEARTBEAT_INTERVAL_MS):
            return
        heartbeat["lastMs"] = now
        heartbeat["lastTouchMs"] = now

    def append_output(chunk):
        nonlocal line_buffer, output_chars, output_truncated
        if not chunk or output_truncated:
            return
        if st.CODE_OUTPUT_MAX_CHARS > 0:
            left = st.CODE_OUTPUT_MAX_CHARS - output_chars
            if left <= 0:
                output_truncated = True
                return
            if len(chunk) > left:
                chunk = chunk[:left]
                output_truncated = True

        output_chars += len(chunk)
        line_buffer += chunk
        while "\n" in line_buffer:
            line, line_buffer = line_buffer.split("\n", 1)
            output_lines.append(line)
            if st.CODE_OUTPUT_MAX_LINES > 0 and len(output_lines) > st.CODE_OUTPUT_MAX_LINES:
                output_lines.pop(0)
                output_truncated = True

    def compose_output_text():
        text = "\n".join(output_lines)
        if line_buffer and not output_truncated:
            if text:
                text += "\n"
            text += line_buffer
        if not text:
            text = "(no stdout)"
        if output_truncated:
            text += "\n[output truncated]"
        return text

    def push_stream_snapshot():
        runtime_set_many({
            "output": compose_output_text(),
            "error": "",
        })

    def safe_print(*args, **kwargs):
        touch_budget("print")
        if kwargs.get("file") is not None:
            raise_limit("print file is blocked")
        sep = kwargs.get("sep", " ")
        end = kwargs.get("end", "\n")
        text = ""
        for i, part in enumerate(args):
            if i > 0:
                text += str(sep)
            text += str(part)
        text += str(end)
        append_output(text)
        push_stream_snapshot()

    def safe_sleep_ms(ms):
        touch_budget("sleep_ms")
        ms = max(0, int(ms))
        if ms > 600000:
            ms = 600000
        time.sleep(ms / 1000.0)
        touch_budget("sleep_ms_after")

    def safe_range(*args):
        touch_budget("range")
        base = range(*args)
        if st.CODE_MAX_RANGE_ITEMS > 0 and len(base) > st.CODE_MAX_RANGE_ITEMS:
            raise_limit("range too large")
        for item in base:
            touch_budget("range_item")
            yield item

    def safe_enumerate(iterable, start=0):
        touch_budget("enumerate")
        idx = int(start)
        count = 0
        for item in iterable:
            touch_budget("enumerate_item")
            yield idx, item
            idx += 1
            count += 1
            if st.CODE_MAX_RANGE_ITEMS > 0 and count > st.CODE_MAX_RANGE_ITEMS:
                raise_limit("enumerate too large")

    def guarded_call(fn, tag, *args):
        touch_budget(tag)
        return fn(*args)

    def safe_import(name, _globals=None, _locals=None, fromlist=(), level=0):
        touch_budget("import")
        base = str(name).split(".", 1)[0]
        blocklist = getattr(st, "CODE_IMPORT_BLOCKLIST", ())
        if blocklist and base in blocklist:
            raise_limit("import blocked: " + base)
        try:
            return __import__(name, _globals, _locals, fromlist, level)
        except TypeError:
            return __import__(name)

    safe_builtins = {
        "print": safe_print,
        "__import__": safe_import,
        "len": len,
        "range": safe_range,
        "min": min,
        "max": max,
        "abs": abs,
        "sum": sum,
        "int": int,
        "float": float,
        "str": str,
        "bool": bool,
        "enumerate": safe_enumerate,
    }

    safe_globals = {
        "__builtins__": safe_builtins,
        "__loop_guard__": lambda: touch_budget("loop"),
        "__soft_watch__": lambda: soft_watch(force=True),
        "print": safe_print,
        "sleep_ms": safe_sleep_ms,
        "gpio_write": lambda pin, value: guarded_call(code_gpio_write, "gpio_write", pin, value),
        "gpio_read": lambda pin: guarded_call(code_gpio_read, "gpio_read", pin),
        "gpio_release": lambda pin: guarded_call(code_gpio_release, "gpio_release", pin),
        "led_set": lambda r, g, b, mode="static": guarded_call(code_led_set, "led_set", r, g, b, mode),
        "servo_angle": lambda pin, angle: guarded_call(code_servo_angle, "servo_angle", pin, angle),
        "servo_speed": lambda pin, speed: guarded_call(code_servo_speed, "servo_speed", pin, speed),
    }

    blocked_words = [
        "open(",
        "exec(",
        "eval(",
        "machine.reset(",
        "machine.soft_reset(",
        "machine.bootloader(",
        "machine.deepsleep(",
        "machine.lightsleep(",
        "sys.exit(",
    ]
    for w in blocked_words:
        if w in code_text:
            msg = "blocked keyword: " + w.strip()
            mark_run_finished("blocked", "", msg, note="policy")
            append_run_log("blocked run: " + msg)
            return

    status = "ok"
    err = ""
    limit_hit = ""
    try:
        code_for_exec = preprocess_user_code(code_text)
        compiled = compile(code_for_exec, "<user_code>", "exec")
        exec(compiled, safe_globals, {})
    except RunLimitError as e:
        status = "limited" if str(e) in ("stopped", "heartbeat lost", "call budget exceeded") else "timeout"
        limit_hit = str(e)
        err = str(e)
    except Exception as e:
        status = "error"
        err = "%s: %s" % (e.__class__.__name__, e)

    mem_after = gc.mem_free() if hasattr(gc, "mem_free") else 0
    if line_buffer and not output_truncated:
        output_lines.append(line_buffer)
    out = compose_output_text()

    note = "mem_free %d -> %d, calls=%d" % (mem_before, mem_after, calls["count"])
    if limit_hit:
        note += ", limit=" + limit_hit
    mark_run_finished(status, out, err, note=note)
    runtime_set_many({"outputTruncated": output_truncated, "limitHit": limit_hit})

    meta = read_json(st.CODE_META_FILE, {})
    if not isinstance(meta, dict):
        meta = {}
    meta["lastRunAt"] = int(time.time())
    meta["lastRunStatus"] = status
    atomic_write_json(st.CODE_META_FILE, meta)
    append_run_log("run[%s] source=%s status=%s" % (job_id, source, status))


def start_code_run(code_text, source):
    if runtime_get("running", False):
        return None, "code is already running"
    if not runtime_get("threadSupported", False):
        return None, "thread is unavailable on this firmware"

    if not isinstance(code_text, str):
        return None, "invalid code text"
    if len(code_text) == 0:
        return None, "code is empty"
    if st.CODE_MAX_TEXT > 0 and len(code_text) > st.CODE_MAX_TEXT:
        return None, "code is too long"

    job_id = str(int(time.time() * 1000))
    runtime_set_many({
        "running": True,
        "jobId": job_id,
        "status": "running",
        "source": source,
        "output": "",
        "error": "",
        "startedMs": ticks_ms(),
        "endedMs": 0,
        "durationMs": 0,
        "lastNote": "",
        "outputTruncated": False,
        "limitHit": "",
        "stopRequested": False,
    })

    try:
        st._thread.start_new_thread(run_user_code_job, (job_id, code_text, source))
    except Exception as e:
        runtime_set_many({
            "running": False,
            "status": "error",
            "error": "thread start failed",
            "lastNote": str(e),
            "endedMs": ticks_ms(),
        })
        return None, "failed to start run thread"

    return job_id, ""


def boot_autorun_active_code():
    if not bool(getattr(st, "CODE_BOOT_AUTORUN_ENABLED", False)):
        append_run_log("boot autorun skipped: switch is off")
        runtime_set_many({"lastNote": "boot autorun skipped: switch is off"})
        return {"started": False, "reason": "disabled"}

    code_text = read_text(st.CODE_ACTIVE_FILE, "")
    stripped = code_text.strip()
    if not stripped:
        append_run_log("boot autorun skipped: active code is empty")
        runtime_set_many({"lastNote": "boot autorun skipped: active code is empty"})
        return {"started": False, "reason": "empty"}

    # Skip the default placeholder text to avoid launching a no-op thread on first boot.
    if stripped == "# 当前固化代码为空":
        append_run_log("boot autorun skipped: active code is placeholder")
        runtime_set_many({"lastNote": "boot autorun skipped: active code is placeholder"})
        return {"started": False, "reason": "placeholder"}

    job_id, err = start_code_run(code_text, "boot_active")
    if not job_id:
        append_run_log("boot autorun skipped: " + err)
        runtime_set_many({"lastNote": "boot autorun skipped: " + err})
        return {"started": False, "reason": err}

    append_run_log("boot autorun started job=" + job_id)
    return {"started": True, "jobId": job_id}


def save_active_from_draft(note=""):
    draft = read_text(st.CODE_DRAFT_FILE, "")
    if not draft:
        raise RuntimeError("draft is empty")

    version_base = str(int(time.time() * 1000))
    version = version_base
    history_file = st.CODE_HISTORY_DIR + "/" + version + ".py"
    idx = 1
    while True:
        try:
            os.stat(history_file)
            version = "%s_%d" % (version_base, idx)
            history_file = st.CODE_HISTORY_DIR + "/" + version + ".py"
            idx += 1
        except OSError:
            break

    atomic_write_text(st.CODE_ACTIVE_FILE, draft)
    atomic_write_text(history_file, draft)

    index = read_json(st.CODE_HISTORY_INDEX_FILE, [])
    if not isinstance(index, list):
        index = []
    item = {
        "version": version,
        "savedAt": int(time.time()),
        "file": history_file,
        "note": note,
    }
    index.insert(0, item)
    while len(index) > st.CODE_HISTORY_LIMIT:
        tail = index.pop()
        try:
            os.remove(tail.get("file", ""))
        except Exception:
            pass
    atomic_write_json(st.CODE_HISTORY_INDEX_FILE, index)

    meta = read_json(st.CODE_META_FILE, {})
    if not isinstance(meta, dict):
        meta = {}
    meta["activeVersion"] = version
    meta["activeSavedAt"] = int(time.time())
    meta["activeFile"] = st.CODE_ACTIVE_FILE
    atomic_write_json(st.CODE_META_FILE, meta)

    runtime_set_many({"lastVersion": version})
    append_run_log("persist active version=" + version)
    return version


def delete_history_version(version):
    version = str(version or "").strip()
    if not version:
        raise RuntimeError("version is required")

    index = read_json(st.CODE_HISTORY_INDEX_FILE, [])
    if not isinstance(index, list):
        index = []

    meta = read_json(st.CODE_META_FILE, {})
    if not isinstance(meta, dict):
        meta = {}
    active_version = str(meta.get("activeVersion", ""))
    if active_version and version == active_version:
        raise RuntimeError("cannot delete active version")

    target = None
    next_index = []
    for item in index:
        if not isinstance(item, dict):
            continue
        v = str(item.get("version", ""))
        if v == version and target is None:
            target = item
            continue
        next_index.append(item)

    if target is None:
        raise RuntimeError("version not found")

    history_file = str(target.get("file", ""))
    if history_file and is_safe_history_file(history_file):
        try:
            os.remove(history_file)
        except Exception:
            pass

    atomic_write_json(st.CODE_HISTORY_INDEX_FILE, next_index)
    append_run_log("delete history version=" + version)
    return {"ok": True, "deletedVersion": version}


def handle_code_api(client, method, api_path, query_string, body):
    if api_path == "/api/code/status" and method == "GET":
        snap = runtime_snapshot()
        snap["meta"] = read_json(st.CODE_META_FILE, {})
        snap["config"] = get_runtime_config()
        send_json(client, 200, "OK", snap)
        return True

    if api_path == "/api/code/config":
        if method == "GET":
            send_json(client, 200, "OK", get_runtime_config())
            return True
        if method == "POST":
            data = parse_json_body(body)
            if not isinstance(data, dict):
                send_json(client, 400, "Bad Request", {"error": "invalid json"})
                return True
            cfg = sanitize_runtime_config(data)
            atomic_write_json(st.CODE_RUNTIME_CONFIG_FILE, cfg)
            apply_runtime_config(cfg)
            append_run_log("save runtime config")
            send_json(client, 200, "OK", {"ok": True, "config": cfg})
            return True

    if api_path == "/api/code/stop" and method == "POST":
        if not runtime_get("running", False):
            send_json(client, 200, "OK", {"ok": True, "running": False})
            return True
        runtime_set_many({"stopRequested": True})
        append_run_log("stop requested")
        send_json(client, 200, "OK", {"ok": True, "running": True, "stopRequested": True})
        return True

    if api_path == "/api/code/clear" and method == "POST":
        data = parse_json_body(body)
        if not isinstance(data, dict):
            data = {}
        target = str(data.get("target", "")).strip().lower()
        if target not in ("", "all", "output", "log"):
            send_json(client, 400, "Bad Request", {"error": "invalid target"})
            return True

        clear_output = target in ("", "all", "output")
        clear_log = target in ("", "all", "log")

        if clear_output:
            runtime_set_many({
                "output": "",
                "error": "",
                "outputTruncated": False,
            })
        if clear_log:
            atomic_write_text(st.CODE_RUN_LOG_FILE, "")

        send_json(client, 200, "OK", {
            "ok": True,
            "cleared": {
                "output": clear_output,
                "log": clear_log,
            }
        })
        return True

    if api_path == "/api/code/draft":
        if method == "GET":
            code = read_text(st.CODE_DRAFT_FILE, "")
            send_json(client, 200, "OK", {"code": code})
            return True
        if method == "POST":
            data = parse_json_body(body)
            if not isinstance(data, dict):
                send_json(client, 400, "Bad Request", {"error": "invalid json"})
                return True
            code = data.get("code", "")
            if not isinstance(code, str):
                send_json(client, 400, "Bad Request", {"error": "code must be string"})
                return True
            if st.CODE_MAX_TEXT > 0 and len(code) > st.CODE_MAX_TEXT:
                send_json(client, 400, "Bad Request", {"error": "code too long"})
                return True
            atomic_write_text(st.CODE_DRAFT_FILE, code)
            append_run_log("save draft len=%d" % len(code))
            send_json(client, 200, "OK", {"ok": True, "length": len(code)})
            return True

    if api_path == "/api/code/active" and method == "GET":
        code = read_text(st.CODE_ACTIVE_FILE, "")
        send_json(client, 200, "OK", {"code": code, "meta": read_json(st.CODE_META_FILE, {})})
        return True

    if api_path == "/api/code/history" and method == "GET":
        version = query_param(query_string, "version")
        index = read_json(st.CODE_HISTORY_INDEX_FILE, [])
        if not isinstance(index, list):
            index = []

        if version:
            target = None
            for item in index:
                if str(item.get("version", "")) == version:
                    target = item
                    break
            if not target:
                send_json(client, 404, "Not Found", {"error": "version not found"})
                return True

            history_file = str(target.get("file", ""))
            if not is_safe_history_file(history_file):
                send_json(client, 400, "Bad Request", {"error": "invalid history file"})
                return True

            code = read_text(history_file, "")
            send_json(client, 200, "OK", {"version": version, "code": code, "meta": target})
            return True

        safe_items = []
        for item in index:
            if not isinstance(item, dict):
                continue
            if is_safe_history_file(item.get("file", "")):
                safe_items.append(item)
        send_json(client, 200, "OK", {"items": safe_items})
        return True

    if api_path == "/api/code/history/delete" and method == "POST":
        data = parse_json_body(body)
        if not isinstance(data, dict):
            send_json(client, 400, "Bad Request", {"error": "invalid json"})
            return True
        version = str(data.get("version", ""))
        try:
            ret = delete_history_version(version)
            send_json(client, 200, "OK", ret)
        except Exception as e:
            msg = str(e)
            if msg == "cannot delete active version":
                send_json(client, 409, "Conflict", {"error": msg})
            elif msg == "version not found":
                send_json(client, 404, "Not Found", {"error": msg})
            else:
                send_json(client, 400, "Bad Request", {"error": msg})
        return True

    if api_path == "/api/code/log" and method == "GET":
        send_json(client, 200, "OK", {"log": read_text(st.CODE_RUN_LOG_FILE, "")})
        return True

    if api_path == "/api/code/persist" and method == "POST":
        if runtime_get("running", False):
            send_json(client, 409, "Conflict", {"error": "cannot persist while code is running"})
            return True

        data = parse_json_body(body)
        note = ""
        if isinstance(data, dict):
            note = str(data.get("note", ""))
        try:
            version = save_active_from_draft(note=note)
            send_json(client, 200, "OK", {"ok": True, "version": version})
        except Exception as e:
            send_json(client, 500, "Internal Error", {"error": str(e)})
        return True

    if api_path == "/api/code/run" and method == "POST":
        data = parse_json_body(body)
        if not isinstance(data, dict):
            send_json(client, 400, "Bad Request", {"error": "invalid json"})
            return True

        source = str(data.get("source", "draft"))
        code_text = ""
        if source == "draft":
            code_text = read_text(st.CODE_DRAFT_FILE, "")
        elif source == "active":
            code_text = read_text(st.CODE_ACTIVE_FILE, "")
        else:
            code_text = data.get("code", "")

        job_id, err = start_code_run(code_text, source)
        if not job_id:
            send_json(client, 400, "Bad Request", {"error": err})
            return True
        send_json(client, 200, "OK", {"ok": True, "jobId": job_id})
        return True

    return False

