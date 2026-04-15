
try:
    import ujson as json
except ImportError:
    import json

try:
    import network
except ImportError:
    network = None

try:
    from machine import Pin, PWM
except ImportError:
    Pin, PWM = None, None

try:
    import neopixel
except ImportError:
    neopixel = None

try:
    import _thread
except ImportError:
    _thread = None

HOST = "0.0.0.0"
PORT = 80
DATA_DIR = "data"
CONFIG_FILE = DATA_DIR + "/config.json"
CONVERSATIONS_FILE = DATA_DIR + "/conversations.json"
DEVICE_CONFIG_FILE = DATA_DIR + "/device_config.json"
CODE_DIR = DATA_DIR + "/code"
CODE_DRAFT_FILE = CODE_DIR + "/draft.py"
CODE_ACTIVE_FILE = CODE_DIR + "/active.py"
CODE_META_FILE = CODE_DIR + "/meta.json"
CODE_RUNTIME_CONFIG_FILE = CODE_DIR + "/runtime_config.json"
CODE_HISTORY_DIR = CODE_DIR + "/history"
CODE_HISTORY_INDEX_FILE = CODE_DIR + "/history_index.json"
CODE_RUN_LOG_FILE = CODE_DIR + "/run.log"
AGENT_DIR = DATA_DIR + "/agent"
AGENT_MEMORY_FILE = AGENT_DIR + "/memory.json"
AGENT_LOG_FILE = AGENT_DIR + "/log.json"
AGENT_SETTINGS_FILE = AGENT_DIR + "/settings.json"
AGENT_MAX_HISTORY_ROUNDS = 12

# GPIO 安全配置：保留系统关键引脚
RESERVED_GPIO = {
    0, 1, 3,
}

SERVOS = {}
ACTIVE_GPIO = {}
GPIO_OUTPUTS = {}
GPIO_PINS = tuple(range(49))
BOARD_LED_PIN = 48
BOARD_LED = None
BOARD_LED_STATE = {"on": False, "r": 0, "g": 0, "b": 0}
LED_ANIM = {
    "mode": "static",
    "interval_ms": 120,
    "last_ms": 0,
    "phase": 0,
    "dir": 1,
    "on": True,
    "palette": [(255, 0, 0), (255, 165, 0), (255, 255, 0), (0, 255, 0), (0, 255, 255), (0, 0, 255), (128, 0, 255)],
}

CODE_MAX_TEXT = 12000
CODE_HISTORY_LIMIT = 20
# 调试运行默认更宽松，提升可玩性
CODE_RUN_TIMEOUT_MS = 12000
CODE_OUTPUT_MAX_CHARS = 4000
CODE_OUTPUT_MAX_LINES = 120
CODE_MAX_CALLS = 6000
CODE_MAX_RANGE_ITEMS = 2000
CODE_IMPORT_BLOCKLIST = (
    "os",
    "uos",
    "sys",
    "socket",
    "usocket",
    "network",
    "_thread",
    "threading",
    "subprocess",
    "select",
    "ssl",
    "asyncio",
    "uasyncio",
)
# 软心跳守卫参数：用于 while 循环中的协作式防卡死
CODE_LOOP_HEARTBEAT_INTERVAL_MS = 300
CODE_LOOP_STALL_MS = 5000
MAX_HEADER_BYTES = 8192
MAX_BODY_BYTES = 16384
CODE_LIMITS_ENABLED = True
CODE_BOOT_AUTORUN_ENABLED = False

CODE_RUNTIME = {
    "running": False,
    "jobId": "",
    "status": "idle",
    "source": "",
    "output": "",
    "error": "",
    "startedMs": 0,
    "endedMs": 0,
    "durationMs": 0,
    "lastVersion": "",
    "lastNote": "",
    "outputTruncated": False,
    "limitHit": "",
    "stopRequested": False,
    "limits": {
        "maxMs": CODE_RUN_TIMEOUT_MS,
        "maxOutputChars": CODE_OUTPUT_MAX_CHARS,
        "maxOutputLines": CODE_OUTPUT_MAX_LINES,
        "maxCalls": CODE_MAX_CALLS,
        "maxRangeItems": CODE_MAX_RANGE_ITEMS,
        "heartbeatIntervalMs": CODE_LOOP_HEARTBEAT_INTERVAL_MS,
        "heartbeatStallMs": CODE_LOOP_STALL_MS,
    },
    "threadSupported": _thread is not None,
}

# 调试运行配置（可持久化到 flash）
DEFAULT_CODE_RUNTIME_CONFIG = {
    "limitsEnabled": CODE_LIMITS_ENABLED,
    "bootAutorunEnabled": CODE_BOOT_AUTORUN_ENABLED,
    "codeTextLimit": CODE_MAX_TEXT,
    "callBudget": CODE_MAX_CALLS,
    "iterBudget": CODE_MAX_RANGE_ITEMS,
    "outputMaxChars": CODE_OUTPUT_MAX_CHARS,
    "outputMaxLines": CODE_OUTPUT_MAX_LINES,
    "httpHeaderMaxBytes": MAX_HEADER_BYTES,
    "httpBodyMaxBytes": MAX_BODY_BYTES,
    "importBlocklist": list(CODE_IMPORT_BLOCKLIST),
    "heartbeatIntervalMs": CODE_LOOP_HEARTBEAT_INTERVAL_MS,
    "heartbeatStallMs": CODE_LOOP_STALL_MS,
}

DEFAULT_AGENT_SETTINGS = {
    "enabled": True,
    "autoRun": True,
    "autoSaveDraft": True,
    "modePrompts": {
        "normal": (
            "你是通用中文助手，可问答、解释与给出示例代码。"
            "不强制只输出代码或 JSON。"
        ),
        "coding": (
            "你是 ESP32 MicroPython 编程代理。必须只输出严格 JSON，禁止 markdown 代码块。"
            "输出格式固定为"
            "{\"code\":\"...\",\"memory\":{\"set\":{},\"delete\":[]},\"notes\":\"...\"}。"
            "生成代码只能使用 MicroPython 可用 API，避免危险系统调用。"
            "代码末尾必须使用英文 print() 输出执行结果。"
            "如果用户要求修改现有代码，优先在现有代码基础上增量修改，而非完全重写。"
        ),
        "react": (
            "你是 React 编程助手，优先输出组件化、可维护代码。"
            "当前模式为预留开发模式，不要生成硬件控制指令。"
            "可输出 JSON：{\"code\":\"...\",\"notes\":\"...\"}。"
        ),
    },
    "systemPrompt": (
        "你是 ESP32 MicroPython 编程代理。必须只输出严格 JSON，禁止 markdown 代码块。"
        "输出格式固定为"
        "{\"code\":\"...\",\"memory\":{\"set\":{},\"delete\":[]},\"notes\":\"...\"}。"
        "生成代码只能使用 MicroPython 可用 API，避免危险系统调用。"
        "代码末尾必须使用英文 print() 输出执行结果。"
        "如果用户要求修改现有代码，优先在现有代码基础上增量修改，而非完全重写。"
    ),
}

CODE_LOCK = None
if _thread is not None:
    try:
        CODE_LOCK = _thread.allocate_lock()
    except Exception:
        CODE_LOCK = None

DEFAULT_CONFIG = {
    "provider": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "",
    "model": "gpt-4o",
    "systemPrompt": "",
    "temperature": 0.7,
    "maxTokens": 4096,
    "stream": True,
    "chatMode": "normal",
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
}

