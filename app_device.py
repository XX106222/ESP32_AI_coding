import app_state as st
from app_common import atomic_write_json, read_json, ticks_ms


def is_valid_gpio(pin):
    return pin in st.GPIO_PINS


GPIO_USAGE_LABELS = {
    "board_led": "板载LED",
    "gpio_out": "GPIO输出",
    "servo": "舵机",
    "serial_rx": "串口RX",
    "serial_tx": "串口TX",
    "adc_in": "ADC",
    "pwm_out": "PWM",
}


def register_gpio_usage(pin, usage, owner="", label=""):
    pin = int(pin)
    usage = str(usage or "")
    rec = {
        "usage": usage,
        "owner": str(owner or ""),
        "label": str(label or ""),
        "updatedMs": int(ticks_ms()),
    }
    st.GPIO_REGISTRY[pin] = rec
    st.ACTIVE_GPIO[pin] = usage
    return rec


def release_gpio_usage(pin, expected_usage=None):
    pin = int(pin)
    usage = st.ACTIVE_GPIO.get(pin)
    if expected_usage and usage != expected_usage:
        return False
    st.ACTIVE_GPIO.pop(pin, None)
    st.GPIO_REGISTRY.pop(pin, None)
    return True


def gpio_usage_text(pin):
    rec = st.GPIO_REGISTRY.get(pin, {}) if isinstance(st.GPIO_REGISTRY, dict) else {}
    usage = str(rec.get("usage") or st.ACTIVE_GPIO.get(pin) or "").strip()
    if not usage:
        return ""
    label = str(rec.get("label") or "").strip()
    if label:
        return label
    return GPIO_USAGE_LABELS.get(usage, usage)


def gpio_reserved_text(pin):
    return str(getattr(st, "RESERVED_GPIO_LABELS", {}).get(pin, "系统保留")).strip() or "系统保留"


def can_use_gpio(pin, required_usage=None):
    if not is_valid_gpio(pin):
        return False, "invalid gpio"
    if pin in st.RESERVED_GPIO:
        return False, "pin reserved"
    usage = st.ACTIVE_GPIO.get(pin)
    if usage and usage != required_usage:
        return False, "pin already in use"
    return True, "ok"


def set_servo_pulse_us(pwm, pulse_width_us, freq_hz):
    period_us = 1000000 / freq_hz
    duty = int((pulse_width_us / period_us) * 65535)
    duty = max(0, min(65535, duty))
    # 不同固件对 duty_ns 支持差异较大，优先 duty_u16
    try:
        pwm.duty_u16(duty)
    except Exception:
        if hasattr(pwm, "duty_ns"):
            pwm.duty_ns(int(pulse_width_us * 1000))
        else:
            raise


def set_servo_angle_duty_u16(pwm, angle):
    angle = max(0.0, min(180.0, float(angle)))
    duty = int(1638 + (angle / 180.0) * (8192 - 1638))
    pwm.duty_u16(max(0, min(65535, duty)))


def init_board_led():
    if st.Pin is None or st.neopixel is None:
        return
    try:
        st.BOARD_LED = st.neopixel.NeoPixel(st.Pin(st.BOARD_LED_PIN, st.Pin.OUT), 1)
        st.BOARD_LED[0] = (0, 0, 0)  # type: ignore[assignment]
        st.BOARD_LED.write()
        st.BOARD_LED_STATE["on"] = False
        st.BOARD_LED_STATE["r"] = 0
        st.BOARD_LED_STATE["g"] = 0
        st.BOARD_LED_STATE["b"] = 0
        register_gpio_usage(st.BOARD_LED_PIN, "board_led", "system", "板载LED")
    except Exception:
        st.BOARD_LED = None


def set_board_led(r, g, b, on=True):
    if st.BOARD_LED is None:
        raise RuntimeError("board led not available")
    r = max(0, min(255, int(r)))
    g = max(0, min(255, int(g)))
    b = max(0, min(255, int(b)))
    if on:
        st.BOARD_LED[0] = (r, g, b)  # type: ignore[assignment]
        st.BOARD_LED_STATE["on"] = True
    else:
        st.BOARD_LED[0] = (0, 0, 0)  # type: ignore[assignment]
        st.BOARD_LED_STATE["on"] = False
    st.BOARD_LED.write()
    st.BOARD_LED_STATE["r"] = r
    st.BOARD_LED_STATE["g"] = g
    st.BOARD_LED_STATE["b"] = b


def write_board_led_raw(r, g, b):
    # 动画渲染只改亮度，不改 on 状态
    if st.BOARD_LED is None:
        return
    rr = max(0, min(255, int(r)))
    gg = max(0, min(255, int(g)))
    bb = max(0, min(255, int(b)))
    st.BOARD_LED[0] = (rr, gg, bb)  # type: ignore[assignment]
    st.BOARD_LED.write()


def update_led_animation():
    if st.BOARD_LED is None:
        return
    mode = st.LED_ANIM.get("mode", "static")
    if mode == "static" or not st.BOARD_LED_STATE.get("on", False):
        return

    now = ticks_ms()
    interval = int(st.LED_ANIM.get("interval_ms", 120))
    last = int(st.LED_ANIM.get("last_ms", 0))
    elapsed = now - last
    if elapsed < interval:
        return
    st.LED_ANIM["last_ms"] = now

    base_r = int(st.BOARD_LED_STATE.get("r", 0))
    base_g = int(st.BOARD_LED_STATE.get("g", 0))
    base_b = int(st.BOARD_LED_STATE.get("b", 0))

    if mode == "blink_fast" or mode == "blink_slow":
        st.LED_ANIM["on"] = not st.LED_ANIM.get("on", True)
        if st.LED_ANIM["on"]:
            write_board_led_raw(base_r, base_g, base_b)
        else:
            write_board_led_raw(0, 0, 0)
        return

    if mode == "breath":
        phase = int(st.LED_ANIM.get("phase", 0))
        direction = int(st.LED_ANIM.get("dir", 1))
        phase += direction * 10
        if phase >= 255:
            phase = 255
            direction = -1
        elif phase <= 10:
            phase = 10
            direction = 1
        st.LED_ANIM["phase"] = phase
        st.LED_ANIM["dir"] = direction
        r = int(base_r * phase / 255)
        g = int(base_g * phase / 255)
        b = int(base_b * phase / 255)
        write_board_led_raw(r, g, b)
        return

    if mode == "multi_flash":
        palette = st.LED_ANIM.get("palette") or []
        if not palette:
            return
        idx = int(st.LED_ANIM.get("phase", 0)) % len(palette)
        rgb = palette[idx]
        st.LED_ANIM["phase"] = idx + 1
        write_board_led_raw(rgb[0], rgb[1], rgb[2])


def device_state_snapshot():
    state = {
        "board_led": st.BOARD_LED_STATE,
        "active_gpio": st.ACTIVE_GPIO,
        "servos": {},
        "analog": {},
    }
    for pin in st.SERVOS:
        servo = st.SERVOS[pin]
        state["servos"][str(pin)] = {
            "mode": servo.get("mode", "angle"),
            "angle": servo.get("angle", 0),
            "speed": servo.get("speed", 0),
        }
    if hasattr(st, "ANALOG_CONFIG"):
        state["analog"] = {
            "adc": getattr(st, "ANALOG_CONFIG", {}).get("adc", {}),
            "pwm": getattr(st, "ANALOG_CONFIG", {}).get("pwm", {}),
        }
    return state


def code_gpio_write(pin, value):
    pin = int(pin)
    val = 1 if int(value) else 0
    ok, msg = can_use_gpio(pin, "gpio_out")
    if not ok:
        raise RuntimeError(msg)
    if st.Pin is None:
        raise RuntimeError("GPIO unavailable")
    if pin not in st.GPIO_OUTPUTS:
        st.GPIO_OUTPUTS[pin] = st.Pin(pin, st.Pin.OUT)
    st.GPIO_OUTPUTS[pin].value(val)
    register_gpio_usage(pin, "gpio_out", "manual", "GPIO输出")
    return val


def code_gpio_read(pin):
    pin = int(pin)
    if not is_valid_gpio(pin):
        raise RuntimeError("invalid gpio")
    if pin in st.RESERVED_GPIO:
        raise RuntimeError("pin reserved")
    usage = st.ACTIVE_GPIO.get(pin)
    if usage and usage != "gpio_out":
        raise RuntimeError("pin used by %s" % usage)
    if st.Pin is None:
        raise RuntimeError("GPIO unavailable")
    if pin in st.GPIO_OUTPUTS:
        return int(st.GPIO_OUTPUTS[pin].value())
    return int(st.Pin(pin, st.Pin.IN).value())


def code_gpio_release(pin):
    pin = int(pin)
    if not is_valid_gpio(pin):
        raise RuntimeError("invalid gpio")
    if pin in st.RESERVED_GPIO:
        raise RuntimeError("pin reserved")
    usage = st.ACTIVE_GPIO.get(pin)
    if usage and usage != "gpio_out":
        raise RuntimeError("pin used by %s" % usage)
    st.GPIO_OUTPUTS.pop(pin, None)
    release_gpio_usage(pin, "gpio_out")
    if st.Pin:
        try:
            st.Pin(pin, st.Pin.IN)
        except Exception:
            pass
    return True


def code_led_set(r, g, b, mode="static"):
    mode = str(mode)
    if mode not in ("static", "breath", "blink_fast", "blink_slow", "multi_flash"):
        mode = "static"
    st.LED_ANIM["mode"] = mode
    st.LED_ANIM["last_ms"] = 0
    st.LED_ANIM["phase"] = 0
    st.LED_ANIM["dir"] = 1
    st.LED_ANIM["on"] = True
    set_board_led(int(r), int(g), int(b), on=True)
    return True


def code_servo_angle(pin, angle):
    pin = int(pin)
    if pin not in st.SERVOS:
        raise RuntimeError("servo not configured")
    servo = st.SERVOS[pin]
    if servo.get("mode", "angle") != "angle":
        raise RuntimeError("servo mode is not angle")
    angle = max(0, min(180, float(angle)))
    set_servo_angle_duty_u16(servo["pwm"], angle)
    servo["angle"] = angle
    return angle


def code_servo_speed(pin, speed):
    pin = int(pin)
    if pin not in st.SERVOS:
        raise RuntimeError("servo not configured")
    servo = st.SERVOS[pin]
    if servo.get("mode", "angle") != "continuous":
        raise RuntimeError("servo mode is not continuous")
    speed = max(-100, min(100, int(speed)))
    neutral_us = int(servo.get("neutral_us", 1500))
    span_us = int(servo.get("span_us", 300))
    pulse_width = neutral_us + (span_us * speed / 100.0)
    pulse_width = max(servo["min_us"], min(servo["max_us"], pulse_width))
    set_servo_pulse_us(servo["pwm"], pulse_width, servo["freq"])
    servo["speed"] = speed
    return speed


def ensure_code_meta_defaults():
    meta = read_json(st.CODE_META_FILE, None)
    if meta is None:
        atomic_write_json(st.CODE_META_FILE, {
            "activeVersion": "",
            "activeSavedAt": 0,
            "activeFile": "",
            "lastRunAt": 0,
            "lastRunStatus": "idle",
        })

