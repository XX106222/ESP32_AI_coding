"""Local smoke checks (host-side) for deployment artifacts."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent

required_files = [
    "main.py",
    "app_state.py",
    "app_common.py",
    "app_device.py",
    "app_code.py",
    "app_server.py",
    "wifi_secrets.py",
    "index.html",
]

for name in required_files:
    p = ROOT / name
    if not p.exists():
        raise SystemExit(f"Missing required file: {name}")

module_files = [
    "frontend_src/modules/html/app_shell.html",
    "frontend_src/modules/js/html_loader.js",
    "frontend_src/modules/js/core.js",
    "frontend_src/modules/js/chat.js",
    "frontend_src/modules/js/device.js",
    "frontend_src/modules/js/code.js",
    "frontend_src/modules/js/ui.js",
    "frontend_src/modules/css/base.css",
    "frontend_src/modules/css/layout.css",
    "frontend_src/modules/css/device.css",
    "frontend_src/modules/css/chat.css",
    "frontend_src/modules/css/overlays.css",
    "frontend_src/modules/css/highlight.css",
    "frontend_src/modules/css/responsive.css",
]
for name in module_files:
    p = ROOT / name
    if not p.exists():
        raise SystemExit(f"Missing semantic frontend module: {name}")

frontend_js_text = "\n".join([
    (ROOT / "frontend_src/modules/js/html_loader.js").read_text(encoding="utf-8"),
    (ROOT / "frontend_src/modules/js/core.js").read_text(encoding="utf-8"),
    (ROOT / "frontend_src/modules/js/chat.js").read_text(encoding="utf-8"),
    (ROOT / "frontend_src/modules/js/device.js").read_text(encoding="utf-8"),
    (ROOT / "frontend_src/modules/js/code.js").read_text(encoding="utf-8"),
    (ROOT / "frontend_src/modules/js/ui.js").read_text(encoding="utf-8"),
])
index_html = (ROOT / "index.html").read_text(encoding="utf-8")
required_markers = [
    "const API_BASE = '/api';",
    "apiPost('/config'",
    "apiPost('/conversations'",
    "apiGet('/ip'",
    "apiPost('/code/run'",
    "apiPost('/code/persist'",
    "apiGet('/code/status'",
    "apiGet('/code/config'",
    "apiPost('/code/config'",
    "apiPost('/code/stop'",
    "toggleCodeConfigPanel",
    "codeConfigToggleBtn",
    "codeCfgImportBlocklist",
]
for marker in required_markers:
    if marker not in frontend_js_text:
        raise SystemExit(f"Missing API usage marker in frontend modules: {marker}")

main_py = (ROOT / "main.py").read_text(encoding="utf-8")
if "from app_server import main" not in main_py:
    raise SystemExit("main.py 未正确委托到 app_server.main")

backend_text = "\n".join([
    (ROOT / "app_state.py").read_text(encoding="utf-8"),
    (ROOT / "app_common.py").read_text(encoding="utf-8"),
    (ROOT / "app_code.py").read_text(encoding="utf-8"),
    (ROOT / "app_server.py").read_text(encoding="utf-8"),
])
backend_markers = [
    'if api_path == "/api/code/status" and method == "GET":',
    'if api_path == "/api/code/config":',
    'if api_path == "/api/code/stop" and method == "POST":',
    'if api_path == "/api/code/draft":',
    'if api_path == "/api/code/run" and method == "POST":',
    'if api_path == "/api/code/persist" and method == "POST":',
    'if api_path == "/api/code/history/delete" and method == "POST":',
    'CODE_RUN_TIMEOUT_MS',
    'CODE_OUTPUT_MAX_CHARS',
    'MAX_HEADER_BYTES',
    'MAX_BODY_BYTES',
    'def is_safe_history_file(path):',
    'CODE_IMPORT_BLOCKLIST',
    'CODE_LOOP_HEARTBEAT_INTERVAL_MS',
    'CODE_LOOP_STALL_MS',
    'outputTruncated',
    'limitHit',
    'stopRequested',
    'failed to start run thread',
    'Payload Too Large',
    'def preprocess_user_code(code_text):',
    '"__import__": safe_import',
    '"__loop_guard__": lambda: touch_budget("loop")',
    '"__soft_watch__": lambda: soft_watch(force=True)',
    'def sanitize_runtime_config(data):',
    'def load_runtime_config():',
]
for marker in backend_markers:
    if marker not in backend_text:
        raise SystemExit(f"Missing backend marker in modular backend: {marker}")

frontend_markers = [
    "frontend_src/modules/css/base.css",
    "frontend_src/modules/css/layout.css",
    "frontend_src/modules/css/device.css",
    "frontend_src/modules/css/chat.css",
    "frontend_src/modules/css/overlays.css",
    "frontend_src/modules/css/highlight.css",
    "frontend_src/modules/css/responsive.css",
    "frontend_src/modules/js/html_loader.js",
]
for marker in frontend_markers:
    if marker not in index_html:
        raise SystemExit(f"Missing frontend module reference in index.html: {marker}")

loader_markers = [
    "frontend_src/modules/html/app_shell.html",
    "frontend_src/modules/js/core.js",
    "frontend_src/modules/js/chat.js",
    "frontend_src/modules/js/device.js",
    "frontend_src/modules/js/code.js",
    "frontend_src/modules/js/ui.js",
]
loader_js = (ROOT / "frontend_src/modules/js/html_loader.js").read_text(encoding="utf-8")
for marker in loader_markers:
    if marker not in loader_js:
        raise SystemExit(f"Missing module reference in html_loader.js: {marker}")

print("Smoke test passed: deployment files and API hooks are present.")

