# ESP32-S3 MicroPython 网页控制平台

一个运行在 ESP32-S3（MicroPython）上的本地网页控制项目。设备启动后提供 Web 服务，浏览器访问设备 IP 即可进行硬件控制、代码调试与配置管理。

## 功能概览

- 本地网页服务（ESP32 直接提供静态页面与 API）
- 设备控制（GPIO / 板载 LED / 舵机）
- 代码调试（草稿保存、运行、停止、固化、历史）
- 运行保护（预算限制、输出截断、循环守卫、心跳检测）
- 配置持久化（关键配置写入 Flash，重启后保留）

## 环境要求

- ESP32-S3 开发板
- MicroPython 固件（ESP32-S3 对应版本）
- Python 3.9+
- Windows PowerShell（本文示例）
- 工具：`esptool`、`mpremote`

安装工具：

```powershell
python -m pip install --upgrade pip
pip install esptool mpremote
```

---

## 刷机与部署

### 1. 下载 MicroPython 固件

从官方页面下载 ESP32-S3 固件（`.bin`）：

- <https://micropython.org/download/ESP32_GENERIC_S3/>

### 2. 擦除并刷写固件（示例串口：COM12）

```powershell
python -m esptool --chip esp32s3 --port COM12 erase_flash
python -m esptool --chip esp32s3 --port COM12 --baud 460800 write_flash -z 0x0 .\ESP32_GENERIC_S3-xxxx.bin
```

刷写后可做简单验证：

```powershell
mpremote connect COM12 exec "import sys; print(sys.implementation)"
```

### 3. 配置 WiFi

编辑 `wifi_secrets.py`：

```python
WIFI_SSID = "你的WiFi名称"
WIFI_PASSWORD = "你的WiFi密码"
```

### 4. 上传项目文件到设备

在项目根目录执行：

```powershell
mpremote connect COM12 fs cp main.py :main.py
mpremote connect COM12 fs cp app_state.py :app_state.py
mpremote connect COM12 fs cp app_common.py :app_common.py
mpremote connect COM12 fs cp app_device.py :app_device.py
mpremote connect COM12 fs cp app_code.py :app_code.py
mpremote connect COM12 fs cp app_server.py :app_server.py
mpremote connect COM12 fs cp app_agent.py :app_agent.py
mpremote connect COM12 fs cp wifi_secrets.py :wifi_secrets.py
mpremote connect COM12 fs cp index.html :index.html

mpremote connect COM12 fs cp frontend_src/modules/html/app_shell.html :frontend_src/modules/html/app_shell.html
mpremote connect COM12 fs cp frontend_src/modules/css/base.css :frontend_src/modules/css/base.css
mpremote connect COM12 fs cp frontend_src/modules/css/layout.css :frontend_src/modules/css/layout.css
mpremote connect COM12 fs cp frontend_src/modules/css/device.css :frontend_src/modules/css/device.css
mpremote connect COM12 fs cp frontend_src/modules/css/chat.css :frontend_src/modules/css/chat.css
mpremote connect COM12 fs cp frontend_src/modules/css/overlays.css :frontend_src/modules/css/overlays.css
mpremote connect COM12 fs cp frontend_src/modules/css/highlight.css :frontend_src/modules/css/highlight.css
mpremote connect COM12 fs cp frontend_src/modules/css/responsive.css :frontend_src/modules/css/responsive.css

mpremote connect COM12 fs cp frontend_src/modules/js/html_loader.js :frontend_src/modules/js/html_loader.js
mpremote connect COM12 fs cp frontend_src/modules/js/core.js :frontend_src/modules/js/core.js
mpremote connect COM12 fs cp frontend_src/modules/js/chat.js :frontend_src/modules/js/chat.js
mpremote connect COM12 fs cp frontend_src/modules/js/device.js :frontend_src/modules/js/device.js
mpremote connect COM12 fs cp frontend_src/modules/js/code.js :frontend_src/modules/js/code.js
mpremote connect COM12 fs cp frontend_src/modules/js/ui.js :frontend_src/modules/js/ui.js

mpremote connect COM12 reset
```

### 5. 打开网页

设备连上 WiFi 后，串口会打印 IP。浏览器访问：

```text
http://<设备IP>
```

---

## 程序运行与调试

网页中的 `调试 · 运行 · 固化` 面板是主要工作区。

### 基本流程

1. 编辑草稿代码
2. 保存草稿
3. 运行代码
4. 查看 `输出 / 错误`
5. 稳定后固化为 active 代码

### 运行状态

- 运行中：`运行` 按钮高亮，`停止` 按钮不高亮
- 非运行中：`停止` 按钮高亮，`运行` 按钮不高亮
- 运行中再次点击 `运行`：会先停止当前任务，再启动新任务

### 运行限制

在运行配置（`⚙`）中可设置：

- 代码文本上限
- 调用预算 / 可迭代预算
- 输出上限（字符、行）
- 运行日志上限
- HTTP Header / Body 上限
- 心跳间隔 / 心跳失联判定
- import 黑名单

说明：

- `运行限制开关` 关闭时，不启用限制，但不会清空已保存数值
- 开关状态会持久化到 Flash
- 恢复默认只回填输入框，点击保存后才写入 Flash

### 循环守护与中断

运行器会注入：

- `__loop_guard__()`：预算与停止检查
- `__soft_watch__()`：软心跳刷新

常见中断原因：

- 手动停止
- 预算超限
- 心跳失联

### 输出与日志

- `输出 / 错误`：当前运行态内存输出，运行中自动刷新
- `运行日志`：持久化到 `data/code/run.log`
- 两个窗口均支持清空，不影响草稿、固化代码和历史版本

---

## 项目结构与文件说明

### 后端（设备端）

- `main.py`：启动入口
- `app_state.py`：全局状态、默认配置、路径常量
- `app_common.py`：通用工具（文件、JSON、HTTP 解析/响应）
- `app_device.py`：设备控制能力（GPIO / LED / Servo）
- `app_code.py`：代码调试模块（草稿/运行/停止/固化/历史/日志）
- `app_server.py`：WiFi 连接、路由分发、HTTP 主循环
- `app_agent.py`：AI 代理能力（模式、提示词、上下文、会话）
- `wifi_secrets.py`：WiFi 凭据

### 前端（网页模块）

- `index.html`：页面入口
- `frontend_src/modules/html/app_shell.html`：应用壳
- `frontend_src/modules/js/core.js`：初始化、状态、配置、基础 API
- `frontend_src/modules/js/chat.js`：聊天与消息渲染
- `frontend_src/modules/js/device.js`：设备控制界面逻辑
- `frontend_src/modules/js/code.js`：代码运行与配置逻辑
- `frontend_src/modules/js/ui.js`：通用 UI 工具
- `frontend_src/modules/css/*.css`：样式模块

### 其他

- `smoke_test.py`：基础回归脚本（PC 端）
- `tools/frontend_assets.py`：前端资源处理工具
- `Agent_for_pico-master/`：独立代理项目参考实现

---

## 常见问题

### 串口找不到 / 上传失败

- 确认数据线支持数据传输
- 检查串口号是否变化
- 必要时按 BOOT 进入下载模式再重试

### 网页打不开

- 确认串口日志已打印 IP
- 确认电脑与设备在同一局域网
- 重新检查并上传 `wifi_secrets.py`

### 运行无输出

- 查看 `输出 / 错误` 是否有异常信息
- 检查是否触发预算或输出截断
- 在关键路径增加 `print()` 排查

---

## 开发与回归

```powershell
python -u smoke_test.py
```

前端改动后，优先重新上传 `frontend_src/modules/*` 并重启设备。
