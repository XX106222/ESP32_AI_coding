import socket
import time
import gc

import app_state as st
from wifi_secrets import WIFI_SSID, WIFI_PASSWORD
from app_common import (
    atomic_write_json,
    parse_json_body,
    read_json,
    read_request,
    sanitize_path,
    send_file,
    send_json,
    send_text,
    split_path_query,
    ensure_dir,
)
from app_code import boot_autorun_active_code, code_prepare_dirs, handle_code_api
from app_agent import agent_prepare_dirs, handle_agent_api
from app_device import (
    can_use_gpio,
    init_board_led,
    is_valid_gpio,
    set_board_led,
    set_servo_angle_duty_u16,
    set_servo_pulse_us,
    update_led_animation,
)


# 兼容 MicroPython，避免在 import 阶段做复杂引用
_ = None


def _safe_int(value, default_value):
    try:
        return int(value)
    except Exception:
        return int(default_value)


def connect_wifi(ssid, password, timeout_sec=20):
    if st.network is None:
        raise RuntimeError("network 模块不可用，请在 ESP32 MicroPython 上运行")

    wlan = st.network.WLAN(st.network.STA_IF)
    wlan.active(True)

    if not wlan.isconnected():
        print("[WiFi] 正在连接:", ssid)
        wlan.connect(ssid, password)
        deadline = time.time() + timeout_sec
        while not wlan.isconnected() and time.time() < deadline:
            time.sleep(0.5)
            print("[WiFi] ...")

    if not wlan.isconnected():
        raise RuntimeError("WiFi 连接失败，请检查 wifi_secrets.py")

    ip = wlan.ifconfig()[0]
    print("[WiFi] 已连接, IP:", ip)
    return wlan, ip


def route_request(client, method, path, body, wlan):
    api_path, query_string = split_path_query(path)

    if api_path.startswith("/api/"):
        if handle_code_api(client, method, api_path, query_string, body):
            return
        if handle_agent_api(client, method, api_path, query_string, body):
            return

        if api_path == "/api/config":
            if method == "GET":
                cfg = read_json(st.CONFIG_FILE, st.DEFAULT_CONFIG)
                if not isinstance(cfg, dict):
                    cfg = st.DEFAULT_CONFIG
                send_json(client, 200, "OK", cfg)
                return
            if method == "POST":
                data = parse_json_body(body)
                if not isinstance(data, dict):
                    send_text(client, 400, "Bad Request", "Invalid JSON")
                    return
                atomic_write_json(st.CONFIG_FILE, data)
                send_json(client, 200, "OK", {"ok": True})
                return

        if api_path == "/api/conversations":
            if method == "GET":
                conversations = read_json(st.CONVERSATIONS_FILE, [])
                if not isinstance(conversations, list):
                    conversations = []
                send_json(client, 200, "OK", conversations)
                return
            if method == "POST":
                data = parse_json_body(body)
                if not isinstance(data, list):
                    send_text(client, 400, "Bad Request", "Invalid JSON")
                    return
                atomic_write_json(st.CONVERSATIONS_FILE, data)
                send_json(client, 200, "OK", {"ok": True})
                return

        if api_path == "/api/ip" and method == "GET":
            ip = wlan.ifconfig()[0] if wlan.isconnected() else "0.0.0.0"
            send_json(client, 200, "OK", {"ip": ip, "connected": wlan.isconnected()})
            return

        if api_path == "/api/device/system-info" and method == "GET":
            try:
                mem_alloc = gc.mem_alloc()
                mem_free = gc.mem_free()
                mem_total = mem_alloc + mem_free
                mem_percent = int((mem_alloc / mem_total * 100)) if mem_total > 0 else 0
                send_json(client, 200, "OK", {
                    "memory_alloc_bytes": mem_alloc,
                    "memory_free_bytes": mem_free,
                    "memory_total_bytes": mem_total,
                    "memory_usage_percent": mem_percent,
                })
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/board-led" and method == "GET":
            send_json(client, 200, "OK", {
                "supported": st.BOARD_LED is not None,
                "pin": st.BOARD_LED_PIN,
                "state": st.BOARD_LED_STATE,
                "mode": st.LED_ANIM.get("mode", "static"),
            })
            return

        if api_path == "/api/device/board-led" and method == "POST":
            try:
                if st.BOARD_LED is None:
                    send_json(client, 503, "Not Available", {"error": "board led not available"})
                    return
                data = parse_json_body(body) or {}
                on = bool(data.get("on", True))
                r = _safe_int(data.get("r", st.BOARD_LED_STATE["r"]), st.BOARD_LED_STATE["r"])
                g = _safe_int(data.get("g", st.BOARD_LED_STATE["g"]), st.BOARD_LED_STATE["g"])
                b = _safe_int(data.get("b", st.BOARD_LED_STATE["b"]), st.BOARD_LED_STATE["b"])
                mode = str(data.get("mode", "static"))
                interval_ms = _safe_int(data.get("interval_ms", 120), 120)
                palette = data.get("palette")

                st.LED_ANIM["mode"] = mode if mode in ("static", "breath", "blink_fast", "blink_slow", "multi_flash") else "static"
                st.LED_ANIM["interval_ms"] = max(40, min(2000, interval_ms))
                st.LED_ANIM["last_ms"] = 0
                st.LED_ANIM["phase"] = 0
                st.LED_ANIM["dir"] = 1
                st.LED_ANIM["on"] = True

                if isinstance(palette, list) and len(palette) > 0:
                    safe_palette = []
                    for c in palette:
                        if isinstance(c, (list, tuple)) and len(c) == 3:
                            safe_palette.append((max(0, min(255, int(c[0]))), max(0, min(255, int(c[1]))), max(0, min(255, int(c[2])))))
                    if safe_palette:
                        st.LED_ANIM["palette"] = safe_palette

                set_board_led(r, g, b, on=on)
                send_json(client, 200, "OK", {"pin": st.BOARD_LED_PIN, "state": st.BOARD_LED_STATE})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/gpio-status" and method == "GET":
            try:
                gpio_info = {}
                for pin in range(49):
                    is_reserved = pin in st.RESERVED_GPIO
                    is_active = pin in st.ACTIVE_GPIO
                    status = "reserved" if is_reserved else ("active" if is_active else "available")
                    usage = st.ACTIVE_GPIO.get(pin, "")
                    level = None
                    try:
                        if pin in st.GPIO_OUTPUTS:
                            level = st.GPIO_OUTPUTS[pin].value()
                        elif not is_reserved:
                            level = st.Pin(pin, st.Pin.IN).value() if st.Pin else None
                    except Exception:
                        level = None
                    gpio_info[str(pin)] = {
                        "pin": pin,
                        "status": status,
                        "usage": usage,
                        "level": level,
                    }
                send_json(client, 200, "OK", gpio_info)
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/gpio-write" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data or "value" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin and value required"})
                    return
                pin = int(data.get("pin"))
                val = 1 if int(data.get("value")) else 0
                ok, msg = can_use_gpio(pin, "gpio_out")
                if not ok:
                    send_json(client, 409, "Conflict", {"error": msg})
                    return
                if st.Pin is None:
                    send_json(client, 503, "Not Available", {"error": "GPIO not available"})
                    return
                if pin not in st.GPIO_OUTPUTS:
                    st.GPIO_OUTPUTS[pin] = st.Pin(pin, st.Pin.OUT)
                st.GPIO_OUTPUTS[pin].value(val)
                st.ACTIVE_GPIO[pin] = "gpio_out"
                send_json(client, 200, "OK", {"pin": pin, "value": val})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/gpio-read" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin required"})
                    return
                pin = int(data.get("pin"))
                if not is_valid_gpio(pin):
                    send_json(client, 400, "Bad Request", {"error": "invalid gpio"})
                    return
                if pin in st.RESERVED_GPIO:
                    send_json(client, 409, "Conflict", {"error": "pin reserved"})
                    return
                if st.ACTIVE_GPIO.get(pin) == "servo":
                    send_json(client, 409, "Conflict", {"error": "pin is used by servo"})
                    return
                if st.Pin is None:
                    send_json(client, 503, "Not Available", {"error": "GPIO not available"})
                    return
                if pin in st.GPIO_OUTPUTS:
                    val = st.GPIO_OUTPUTS[pin].value()
                else:
                    val = st.Pin(pin, st.Pin.IN).value()
                send_json(client, 200, "OK", {"pin": pin, "value": int(val)})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/gpio-release" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin required"})
                    return
                pin = int(data.get("pin"))
                if not is_valid_gpio(pin):
                    send_json(client, 400, "Bad Request", {"error": "invalid gpio"})
                    return
                if pin in st.RESERVED_GPIO:
                    send_json(client, 409, "Conflict", {"error": "pin reserved"})
                    return
                if st.ACTIVE_GPIO.get(pin) == "servo":
                    send_json(client, 409, "Conflict", {"error": "pin is used by servo"})
                    return
                out_pin = st.GPIO_OUTPUTS.pop(pin, None)
                if out_pin is not None:
                    try:
                        st.Pin(pin, st.Pin.IN)
                    except Exception:
                        pass
                st.ACTIVE_GPIO.pop(pin, None)
                send_json(client, 200, "OK", {"pin": pin, "released": True})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/servo-list" and method == "GET":
            try:
                servo_list = []
                for pin, servo_data in st.SERVOS.items():
                    servo_list.append({
                        "pin": pin,
                        "freq": servo_data.get("freq", 50),
                        "min_us": servo_data.get("min_us", 1000),
                        "max_us": servo_data.get("max_us", 2000),
                        "angle": servo_data.get("angle", 90),
                        "mode": servo_data.get("mode", "angle"),
                        "neutral_us": servo_data.get("neutral_us", 1500),
                        "span_us": servo_data.get("span_us", 300),
                        "speed": servo_data.get("speed", 0),
                    })
                send_json(client, 200, "OK", servo_list)
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/servo-config" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin required"})
                    return

                pin = int(data.get("pin"))
                freq = int(data.get("freq", 50))
                min_us = int(data.get("min_us", 1000))
                max_us = int(data.get("max_us", 2000))
                mode = str(data.get("mode", "angle"))
                neutral_us = int(data.get("neutral_us", 1500))
                span_us = int(data.get("span_us", 300))

                ok, msg = can_use_gpio(pin)
                if not ok:
                    send_json(client, 409, "Conflict", {"error": msg})
                    return
                if min_us >= max_us:
                    send_json(client, 400, "Bad Request", {"error": "invalid pulse width range"})
                    return
                if freq != 50:
                    send_json(client, 400, "Bad Request", {"error": "SG90 requires 50Hz"})
                    return
                if min_us < 400 or max_us > 2600:
                    send_json(client, 400, "Bad Request", {"error": "SG90 pulse width should be within 400-2600us"})
                    return
                if mode not in ("angle", "continuous"):
                    send_json(client, 400, "Bad Request", {"error": "invalid servo mode"})
                    return
                if neutral_us < min_us or neutral_us > max_us:
                    send_json(client, 400, "Bad Request", {"error": "neutral_us out of range"})
                    return
                if span_us < 20 or span_us > 700:
                    send_json(client, 400, "Bad Request", {"error": "invalid span_us"})
                    return

                if st.Pin and st.PWM:
                    try:
                        pwm = st.PWM(st.Pin(pin))
                        pwm.freq(freq)
                        if mode == "continuous":
                            set_servo_pulse_us(pwm, neutral_us, freq)
                        else:
                            set_servo_angle_duty_u16(pwm, 90)

                        st.SERVOS[pin] = {
                            "pwm": pwm,
                            "freq": freq,
                            "min_us": min_us,
                            "max_us": max_us,
                            "angle": 90,
                            "mode": mode,
                            "neutral_us": neutral_us,
                            "span_us": span_us,
                            "speed": 0,
                        }
                        st.ACTIVE_GPIO[pin] = "servo"
                        send_json(client, 200, "OK", {"pin": pin, "configured": True})
                    except Exception as e:
                        send_json(client, 500, "PWM Error", {"error": str(e)})
                else:
                    send_json(client, 503, "Not Available", {"error": "PWM not available"})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/servo-angle" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data or "angle" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin and angle required"})
                    return
                pin = int(data.get("pin"))
                angle = float(data.get("angle"))
                if pin not in st.SERVOS:
                    send_json(client, 404, "Not Found", {"error": "servo not configured"})
                    return
                servo = st.SERVOS[pin]
                if servo.get("mode", "angle") != "angle":
                    send_json(client, 409, "Conflict", {"error": "servo is in continuous mode"})
                    return
                angle = max(0, min(180, angle))
                set_servo_angle_duty_u16(servo["pwm"], angle)
                servo["angle"] = angle
                send_json(client, 200, "OK", {"pin": pin, "angle": angle})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/servo-speed" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data or "speed" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin and speed required"})
                    return
                pin = int(data.get("pin"))
                speed = int(data.get("speed"))
                if pin not in st.SERVOS:
                    send_json(client, 404, "Not Found", {"error": "servo not configured"})
                    return
                servo = st.SERVOS[pin]
                if servo.get("mode", "angle") != "continuous":
                    send_json(client, 409, "Conflict", {"error": "servo is not continuous mode"})
                    return
                speed = max(-100, min(100, speed))
                neutral_us = int(servo.get("neutral_us", 1500))
                span_us = int(servo.get("span_us", 300))
                pulse_width = neutral_us + (span_us * speed / 100.0)
                pulse_width = max(servo["min_us"], min(servo["max_us"], pulse_width))
                set_servo_pulse_us(servo["pwm"], pulse_width, servo["freq"])
                servo["speed"] = speed
                send_json(client, 200, "OK", {"pin": pin, "speed": speed})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        if api_path == "/api/device/servo-delete" and method == "POST":
            try:
                data = parse_json_body(body)
                if not data or "pin" not in data:
                    send_json(client, 400, "Bad Request", {"error": "pin required"})
                    return
                pin = int(data.get("pin"))
                if pin not in st.SERVOS:
                    send_json(client, 404, "Not Found", {"error": "servo not configured"})
                    return

                servo = st.SERVOS.pop(pin)
                try:
                    servo["pwm"].deinit()
                except Exception:
                    pass
                try:
                    if st.Pin:
                        st.Pin(pin, st.Pin.IN)
                except Exception:
                    pass
                st.ACTIVE_GPIO.pop(pin, None)
                send_json(client, 200, "OK", {"pin": pin, "deleted": True})
            except Exception as e:
                send_json(client, 500, "Internal Error", {"error": str(e)})
            return

        send_text(client, 404, "Not Found", "Unknown API")
        return

    if method != "GET":
        send_text(client, 405, "Method Not Allowed", "Only GET supported for static files")
        return

    local_path = sanitize_path(path)
    if not local_path:
        send_text(client, 400, "Bad Request", "Invalid path")
        return
    send_file(client, local_path)


def run_server(wlan):
    addr = socket.getaddrinfo(st.HOST, st.PORT)[0][-1]
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(addr)
    server.listen(4)
    server.settimeout(0.05)

    print("[HTTP] 监听端口", st.PORT)

    while True:
        update_led_animation()
        try:
            client, _remote_addr = server.accept()
        except OSError:
            continue
        client.settimeout(5)

        try:
            method, path, _, body = read_request(client)
            if method == "_413":
                send_text(client, 413, "Payload Too Large", "Payload too large")
            elif method == "_400":
                send_text(client, 400, "Bad Request", "Malformed request")
            elif not method or not path:
                send_text(client, 400, "Bad Request", "Malformed request")
            else:
                route_request(client, method, path, body, wlan)
        except Exception as e:
            try:
                send_text(client, 500, "Internal Server Error", "Server error: %s" % e)
            except Exception:
                pass
        finally:
            client.close()


def main():
    ensure_dir(st.DATA_DIR)
    code_prepare_dirs()
    agent_prepare_dirs()

    if read_json(st.CONFIG_FILE, None) is None:
        atomic_write_json(st.CONFIG_FILE, st.DEFAULT_CONFIG)
    if read_json(st.CONVERSATIONS_FILE, None) is None:
        atomic_write_json(st.CONVERSATIONS_FILE, [])

    init_board_led()

    wlan, ip = connect_wifi(WIFI_SSID, WIFI_PASSWORD)
    print("[READY] 浏览器打开: http://%s" % ip)

    try:
        ret = boot_autorun_active_code()
        if ret.get("started"):
            print("[CODE] 开机自启动已启动, job:", ret.get("jobId", ""))
        else:
            print("[CODE] 开机自启动跳过:", ret.get("reason", ""))
    except Exception as e:
        # Never break the web service startup because of autorun failures.
        print("[CODE] 开机自启动异常:", e)

    run_server(wlan)

