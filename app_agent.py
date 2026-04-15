import time

import app_state as st
from app_common import (
    atomic_write_json,
    atomic_write_text,
    ensure_dir,
    parse_json_body,
    read_json,
    read_text,
    runtime_get,
    runtime_set_many,
    send_json,
)
from app_code import start_code_run


try:
    import urequests as _requests
except Exception:
    try:
        import requests as _requests
    except Exception:
        _requests = None


def agent_prepare_dirs():
    ensure_dir(st.AGENT_DIR)
    if read_json(st.AGENT_MEMORY_FILE, None) is None:
        atomic_write_json(st.AGENT_MEMORY_FILE, {})
    if read_json(st.AGENT_LOG_FILE, None) is None:
        atomic_write_json(st.AGENT_LOG_FILE, [])
    if read_json(st.AGENT_SETTINGS_FILE, None) is None:
        atomic_write_json(st.AGENT_SETTINGS_FILE, st.DEFAULT_AGENT_SETTINGS)


def _agent_settings():
    raw = read_json(st.AGENT_SETTINGS_FILE, st.DEFAULT_AGENT_SETTINGS)
    if not isinstance(raw, dict):
        raw = {}
    merged = {}
    merged.update(st.DEFAULT_AGENT_SETTINGS)
    merged.update(raw)
    return merged


def _save_agent_settings(settings):
    merged = {}
    merged.update(st.DEFAULT_AGENT_SETTINGS)
    if isinstance(settings, dict):
        merged.update(settings)
        if isinstance(st.DEFAULT_AGENT_SETTINGS.get("modePrompts"), dict):
            defaults = st.DEFAULT_AGENT_SETTINGS.get("modePrompts", {})
            got = settings.get("modePrompts", {}) if isinstance(settings.get("modePrompts"), dict) else {}
            mode_prompts = {}
            mode_prompts.update(defaults)
            mode_prompts.update(got)
            merged["modePrompts"] = mode_prompts
    atomic_write_json(st.AGENT_SETTINGS_FILE, merged)
    return merged


def _append_agent_log(role, content):
    rows = read_json(st.AGENT_LOG_FILE, [])
    if not isinstance(rows, list):
        rows = []
    rows.append({
        "ts": int(time.time()),
        "role": str(role),
        "content": str(content),
    })
    max_len = max(2, st.AGENT_MAX_HISTORY_ROUNDS * 2)
    if len(rows) > max_len:
        rows = rows[-max_len:]
    atomic_write_json(st.AGENT_LOG_FILE, rows)


def _trim_agent_log(rows):
    if not isinstance(rows, list):
        return []
    max_len = max(2, st.AGENT_MAX_HISTORY_ROUNDS * 2)
    if len(rows) > max_len:
        rows = rows[-max_len:]
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role", "")).strip()
        content = str(row.get("content", ""))
        if role in ("user", "assistant") and content:
            out.append({"role": role, "content": content})
    return out


def _safe_text(value, max_len=0):
    text = str(value or "")
    if max_len and len(text) > max_len:
        text = text[-max_len:]
    return text


def _ascii_json_text(text):
    out = []
    for ch in str(text or ""):
        code = ord(ch)
        if code < 128:
            out.append(ch)
        elif code <= 0xFFFF:
            out.append("\\u%04x" % code)
        else:
            code -= 0x10000
            out.append("\\u%04x\\u%04x" % (0xD800 + (code >> 10), 0xDC00 + (code & 0x3FF)))
    return "".join(out)


def _resolve_mode_prompt(settings, mode):
    m = str(mode or "coding").strip().lower()
    mode_prompts = settings.get("modePrompts", {})
    if isinstance(mode_prompts, dict):
        p = mode_prompts.get(m)
        if isinstance(p, str) and p.strip():
            return p
    base = str(settings.get("systemPrompt", "") or "")
    if base.strip():
        return base
    return st.DEFAULT_AGENT_SETTINGS["systemPrompt"]


def _build_agent_messages(user_prompt, mode="coding"):
    memory = read_json(st.AGENT_MEMORY_FILE, {})
    if not isinstance(memory, dict):
        memory = {}

    settings = _agent_settings()
    system_prompt = _resolve_mode_prompt(settings, mode)

    # Keep request body compact to reduce truncation risk on MicroPython sockets.
    active_code = _safe_text(read_text(st.CODE_ACTIVE_FILE, ""), 1600)
    draft_code = _safe_text(read_text(st.CODE_DRAFT_FILE, ""), 1600)

    context = {
        "memory": memory,
        "active_code": active_code,
        "draft_code": draft_code,
    }

    messages = [{
        "role": "system",
        "content": system_prompt + "\nContext JSON:\n" + st.json.dumps(context),
    }]

    history = _trim_agent_log(read_json(st.AGENT_LOG_FILE, []))
    if len(history) > 8:
        history = history[-8:]
    compact_history = []
    for item in history:
        compact_history.append({
            "role": item.get("role", "user"),
            "content": _safe_text(item.get("content", ""), 600),
        })
    messages.extend(compact_history)
    messages.append({"role": "user", "content": _safe_text(user_prompt, 1000)})
    return messages


def _http_chat_completion(payload):
    if _requests is None:
        return False, "HTTP client not available on this firmware", None

    cfg = read_json(st.CONFIG_FILE, st.DEFAULT_CONFIG)
    if not isinstance(cfg, dict):
        cfg = st.DEFAULT_CONFIG

    base_url = str(cfg.get("baseUrl", "") or "").rstrip("/")
    api_key = str(cfg.get("apiKey", "") or "")
    model = str(cfg.get("model", "gpt-4o") or "gpt-4o")
    temperature = cfg.get("temperature", 0.2)

    if not base_url:
        return False, "baseUrl is empty", None
    if not api_key:
        return False, "apiKey is empty", None

    body = {
        "model": model,
        "messages": payload,
        "temperature": float(temperature),
        "stream": False,
    }

    url = base_url + "/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + api_key,
    }

    try:
        # Use raw JSON text for MicroPython compatibility with urequests.
        payload_text = _ascii_json_text(st.json.dumps(body))
        # Always send UTF-8 bytes so Content-Length matches the actual payload size.
        # This avoids Chinese/system prompt text being truncated when the HTTP
        # client counts characters instead of encoded bytes.
        payload_bytes = payload_text.encode("utf-8")
        resp = _requests.post(url, headers=headers, data=payload_bytes)
        status = getattr(resp, "status_code", 200)
        text = ""
        try:
            text = resp.text
        except Exception:
            pass
        try:
            resp.close()
        except Exception:
            pass

        if status < 200 or status >= 300:
            return False, "upstream HTTP %d: %s" % (status, text[:300]), None

        data = st.json.loads(text)
        return True, "", data
    except Exception as e:
        return False, str(e), None


def _extract_json_payload(raw_text):
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        nl = text.find("\n")
        if nl >= 0:
            text = text[nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    # best effort: cut to outermost braces
    first = text.find("{")
    last = text.rfind("}")
    if first >= 0 and last > first:
        text = text[first:last + 1]
    return st.json.loads(text)


def _extract_reasoning_text(data):
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices", [])
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    msg = first.get("message", {}) if isinstance(first, dict) else {}
    if isinstance(msg, dict):
        text = msg.get("reasoning_content") or msg.get("thinking") or ""
        if text:
            return str(text)
    text = first.get("reasoning_content") if isinstance(first, dict) else ""
    if text:
        return str(text)
    text = first.get("thinking") if isinstance(first, dict) else ""
    if text:
        return str(text)
    return ""


def _apply_memory(memory_actions):
    current = read_json(st.AGENT_MEMORY_FILE, {})
    if not isinstance(current, dict):
        current = {}

    if not isinstance(memory_actions, dict):
        memory_actions = {}
    to_set = memory_actions.get("set", {})
    to_delete = memory_actions.get("delete", [])

    if isinstance(to_set, dict):
        for key in to_set:
            current[str(key)] = to_set[key]
    if isinstance(to_delete, list):
        for key in to_delete:
            current.pop(str(key), None)

    atomic_write_json(st.AGENT_MEMORY_FILE, current)
    return current


def _agent_chat(prompt, auto_run=True, force_run=False, persist_active=False, mode="coding"):
    settings = _agent_settings()
    if not bool(settings.get("enabled", True)):
        return {
            "ok": False,
            "error": "agent disabled",
        }

    _append_agent_log("user", prompt)

    messages = _build_agent_messages(prompt, mode=mode)
    ok, err, data = _http_chat_completion(messages)
    if (not ok) and str(err).startswith("upstream HTTP 400"):
        # Retry with minimal prompt when upstream reports request parse failure.
        system_prompt = _resolve_mode_prompt(settings, mode)
        minimal = [
            {"role": "system", "content": _safe_text(system_prompt, 1200)},
            {"role": "user", "content": _safe_text(prompt, 800)},
        ]
        ok, err, data = _http_chat_completion(minimal)
    if not ok:
        return {
            "ok": False,
            "error": err,
        }

    choices = data.get("choices", []) if isinstance(data, dict) else []
    if not choices:
        return {
            "ok": False,
            "error": "no choices returned",
        }

    ai_text = str(choices[0].get("message", {}).get("content", "") or "")
    thinking_text = _extract_reasoning_text(data)
    _append_agent_log("assistant", ai_text)

    try:
        ai_obj = _extract_json_payload(ai_text)
    except Exception as e:
        return {
            "ok": False,
            "error": "invalid JSON from model: %s" % e,
            "raw": ai_text,
        }

    code_text = str(ai_obj.get("code", "") or "").strip()
    notes = str(ai_obj.get("notes", "") or "")
    memory = _apply_memory(ai_obj.get("memory", {}))

    auto_save_draft = bool(settings.get("autoSaveDraft", True))
    if code_text and auto_save_draft:
        atomic_write_text(st.CODE_DRAFT_FILE, code_text + "\n")

    run_info = {"started": False, "error": "", "jobId": ""}
    if auto_run and code_text:
        if force_run and runtime_get("running", False):
            runtime_set_many({"stopRequested": True})
            # Cooperative stop wait.
            deadline = time.time() + 4
            while runtime_get("running", False) and time.time() < deadline:
                time.sleep(0.1)

        job_id, run_err = start_code_run(code_text, "agent_chat")
        if job_id:
            run_info = {"started": True, "error": "", "jobId": job_id}
        else:
            run_info = {"started": False, "error": run_err, "jobId": ""}

    # Optional: persist generated code as active version.
    if persist_active and code_text and (not runtime_get("running", False)):
        try:
            atomic_write_text(st.CODE_ACTIVE_FILE, code_text + "\n")
        except Exception:
            pass

    return {
        "ok": True,
        "mode": mode,
        "code": code_text,
        "notes": notes,
        "thinking": thinking_text,
        "memory": memory,
        "run": run_info,
        "raw": ai_text,
    }


def handle_agent_api(client, method, api_path, _query_string, body):
    if api_path == "/api/agent/settings":
        if method == "GET":
            send_json(client, 200, "OK", _agent_settings())
            return True
        if method == "POST":
            data = parse_json_body(body)
            if not isinstance(data, dict):
                send_json(client, 400, "Bad Request", {"error": "invalid json"})
                return True
            cfg = _save_agent_settings(data)
            send_json(client, 200, "OK", {"ok": True, "settings": cfg})
            return True

    if api_path == "/api/agent/memory":
        if method == "GET":
            mem = read_json(st.AGENT_MEMORY_FILE, {})
            if not isinstance(mem, dict):
                mem = {}
            send_json(client, 200, "OK", mem)
            return True
        if method == "POST":
            data = parse_json_body(body)
            if not isinstance(data, dict):
                send_json(client, 400, "Bad Request", {"error": "invalid json"})
                return True
            mem = _apply_memory(data)
            send_json(client, 200, "OK", {"ok": True, "memory": mem})
            return True

    if api_path == "/api/agent/context" and method == "GET":
        send_json(client, 200, "OK", {
            "memory": read_json(st.AGENT_MEMORY_FILE, {}),
            "activeCode": read_text(st.CODE_ACTIVE_FILE, ""),
            "draftCode": read_text(st.CODE_DRAFT_FILE, ""),
            "settings": _agent_settings(),
        })
        return True

    if api_path == "/api/agent/chat" and method == "POST":
        data = parse_json_body(body)
        if not isinstance(data, dict):
            send_json(client, 400, "Bad Request", {"error": "invalid json"})
            return True

        prompt = str(data.get("prompt", "") or "").strip()
        if not prompt:
            send_json(client, 400, "Bad Request", {"error": "prompt required"})
            return True

        settings = _agent_settings()
        mode = str(data.get("mode", "coding") or "coding").strip().lower()
        if mode not in ("normal", "coding", "react"):
            mode = "coding"
        auto_run = bool(data.get("autoRun", settings.get("autoRun", True)))
        if mode != "coding" and "autoRun" not in data:
            # Non-coding modes default to no hardware autorun.
            auto_run = False
        force_run = bool(data.get("forceRun", True))
        persist_active = bool(data.get("persistActive", False))

        ret = _agent_chat(prompt, auto_run=auto_run, force_run=force_run, persist_active=persist_active, mode=mode)
        if ret.get("ok"):
            send_json(client, 200, "OK", ret)
        else:
            send_json(client, 500, "Internal Error", ret)
        return True

    return False


