import os
import time

import app_state as st


def ensure_dir(path):
    try:
        os.stat(path)
    except OSError:
        os.mkdir(path)


def read_json(path, default_value):
    try:
        with open(path, "r") as f:
            return st.json.loads(f.read())
    except Exception:
        return default_value


def atomic_write_json(path, value):
    tmp_path = path + ".tmp"
    text = st.json.dumps(value)
    with open(tmp_path, "w") as f:
        f.write(text)
    try:
        os.remove(path)
    except OSError:
        pass
    os.rename(tmp_path, path)


def read_text(path, default_value=""):
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return default_value


def atomic_write_text(path, text):
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        f.write(text)
    try:
        os.remove(path)
    except OSError:
        pass
    os.rename(tmp_path, path)


def split_path_query(path):
    if "?" in path:
        p, q = path.split("?", 1)
        return p, q
    return path, ""


def query_param(query_string, key):
    if not query_string:
        return ""
    parts = query_string.split("&")
    for part in parts:
        if "=" in part:
            k, v = part.split("=", 1)
            if k == key:
                return v
    return ""


def is_safe_history_file(path):
    if not isinstance(path, str):
        return False
    if ".." in path:
        return False
    if not path.startswith(st.CODE_HISTORY_DIR + "/"):
        return False
    return path.endswith(".py")


def runtime_get(key, default_value=None):
    if st.CODE_LOCK:
        st.CODE_LOCK.acquire()
    try:
        return st.CODE_RUNTIME.get(key, default_value)
    finally:
        if st.CODE_LOCK:
            st.CODE_LOCK.release()


def runtime_set_many(values):
    if st.CODE_LOCK:
        st.CODE_LOCK.acquire()
    try:
        for k in values:
            st.CODE_RUNTIME[k] = values[k]
    finally:
        if st.CODE_LOCK:
            st.CODE_LOCK.release()


def runtime_snapshot():
    if st.CODE_LOCK:
        st.CODE_LOCK.acquire()
    try:
        snap = {}
        for k in st.CODE_RUNTIME:
            snap[k] = st.CODE_RUNTIME[k]
        return snap
    finally:
        if st.CODE_LOCK:
            st.CODE_LOCK.release()


def ticks_ms():
    if hasattr(time, "ticks_ms"):
        return time.ticks_ms()
    return int(time.time() * 1000)


def append_run_log(text):
    now = int(time.time())
    old = read_text(st.CODE_RUN_LOG_FILE, "")
    joined = old + "\n[%d] %s" % (now, text)
    if len(joined) > 16000:
        joined = joined[-16000:]
    atomic_write_text(st.CODE_RUN_LOG_FILE, joined)


def get_extension(path):
    dot_index = path.rfind(".")
    if dot_index == -1:
        return ""
    return path[dot_index:].lower()


def get_mime(path):
    return st.MIME_TYPES.get(get_extension(path), "application/octet-stream")


def send_response(client, status_code, reason, content_type, body_bytes):
    headers = [
        "HTTP/1.1 %d %s" % (status_code, reason),
        "Content-Type: " + content_type,
        "Content-Length: " + str(len(body_bytes)),
        "Connection: close",
        "Cache-Control: no-store",
        "", "",
    ]
    client.send("\r\n".join(headers).encode("utf-8"))
    if body_bytes:
        client.send(body_bytes)


def send_json(client, status_code, reason, payload):
    body = st.json.dumps(payload).encode("utf-8")
    send_response(client, status_code, reason, "application/json; charset=utf-8", body)


def send_text(client, status_code, reason, text):
    send_response(client, status_code, reason, "text/plain; charset=utf-8", text.encode("utf-8"))


def send_file(client, file_path):
    try:
        size = os.stat(file_path)[6]
        headers = [
            "HTTP/1.1 200 OK",
            "Content-Type: " + get_mime(file_path),
            "Content-Length: " + str(size),
            "Connection: close",
            "Cache-Control: no-store",
            "", "",
        ]
        client.send("\r\n".join(headers).encode("utf-8"))

        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(1024)
                if not chunk:
                    break
                client.send(chunk)
    except OSError:
        send_text(client, 404, "Not Found", "404 Not Found")


def sanitize_path(path):
    if path == "/":
        return "index.html"
    question_mark = path.find("?")
    if question_mark >= 0:
        path = path[:question_mark]
    if ".." in path:
        return None
    if path.startswith("/"):
        path = path[1:]
    return path


def read_request(client):
    data = b""

    while b"\r\n\r\n" not in data:
        chunk = client.recv(512)
        if not chunk:
            break
        data += chunk
        if st.MAX_HEADER_BYTES > 0 and len(data) > st.MAX_HEADER_BYTES:
            return "_413", "/", {}, b""

    header_end = data.find(b"\r\n\r\n")
    if header_end == -1:
        return None, None, {}, b""

    header_blob = data[:header_end].decode("utf-8", "ignore")
    body = data[header_end + 4:]

    lines = header_blob.split("\r\n")
    if not lines:
        return None, None, {}, b""

    parts = lines[0].split(" ")
    if len(parts) < 2:
        return None, None, {}, b""

    method = parts[0]
    path = parts[1]

    headers = {}
    for line in lines[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()

    try:
        content_length = int(headers.get("content-length", "0") or "0")
    except Exception:
        return "_400", "/", {}, b""

    if content_length < 0:
        return "_400", "/", {}, b""
    if st.MAX_BODY_BYTES > 0 and content_length > st.MAX_BODY_BYTES:
        return "_413", "/", {}, b""

    while len(body) < content_length:
        chunk = client.recv(512)
        if not chunk:
            break
        body += chunk
        if st.MAX_BODY_BYTES > 0 and len(body) > st.MAX_BODY_BYTES:
            return "_413", "/", {}, b""

    return method, path, headers, body


def parse_json_body(body):
    if not body:
        return None
    try:
        return st.json.loads(body.decode("utf-8"))
    except Exception:
        return None

