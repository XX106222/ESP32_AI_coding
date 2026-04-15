# ESP32-S3 MicroPython 网页控制部署说明

本项目将网页应用直接运行在 ESP32-S3（MicroPython）上，提供：

- 本地网页静态资源服务
- 配置与会话持久化
- 设备 GPIO/舵机/板载 LED 控制
- 调试代码的保存、运行、固化与历史版本管理

> 当前部署以模块化前端为主（后端 + `index.html` + `frontend_src/modules/*`）。

## 目录结构（后端已拆分）

后端已从单个超大 `main.py` 拆分为多个模块：

- `main.py`：启动入口（仅负责调用）
- `app_state.py`：全局状态、常量、路径与默认配置
- `app_common.py`：通用工具（文件读写、HTTP 请求解析、响应封装、运行时状态工具）
- `app_device.py`：设备能力（GPIO/LED/Servo）
- `app_code.py`：调试代码模块（草稿/运行/固化/历史/日志）
- `app_server.py`：路由、WiFi 连接、HTTP 主循环

## 1）填写 WiFi 信息

编辑 `wifi_secrets.py`：

```python
WIFI_SSID = "你的WiFi名称"
WIFI_PASSWORD = "你的WiFi密码"
```

## 2）上传到 ESP32

建议使用 `mpremote`：

- 后端运行文件：
  `main.py`、`app_state.py`、`app_common.py`、`app_device.py`、`app_code.py`、`app_server.py`、`wifi_secrets.py`
- 前端运行文件：
  `index.html`、`frontend_src/modules/html/app_shell.html`、`frontend_src/modules/css/*.css`、`frontend_src/modules/js/*.js`

```powershell
pip install -r requirements.txt
mpremote connect auto fs cp main.py :main.py
mpremote connect auto fs cp app_state.py :app_state.py
mpremote connect auto fs cp app_common.py :app_common.py
mpremote connect auto fs cp app_device.py :app_device.py
mpremote connect auto fs cp app_code.py :app_code.py
mpremote connect auto fs cp app_server.py :app_server.py
mpremote connect auto fs cp wifi_secrets.py :wifi_secrets.py
mpremote connect auto fs cp index.html :index.html
mpremote connect auto fs cp frontend_src/modules/css/base.css :frontend_src/modules/css/base.css
mpremote connect auto fs cp frontend_src/modules/css/layout.css :frontend_src/modules/css/layout.css
mpremote connect auto fs cp frontend_src/modules/css/device.css :frontend_src/modules/css/device.css
mpremote connect auto fs cp frontend_src/modules/css/chat.css :frontend_src/modules/css/chat.css
mpremote connect auto fs cp frontend_src/modules/css/overlays.css :frontend_src/modules/css/overlays.css
mpremote connect auto fs cp frontend_src/modules/css/highlight.css :frontend_src/modules/css/highlight.css
mpremote connect auto fs cp frontend_src/modules/css/responsive.css :frontend_src/modules/css/responsive.css
mpremote connect auto fs cp frontend_src/modules/html/app_shell.html :frontend_src/modules/html/app_shell.html
mpremote connect auto fs cp frontend_src/modules/js/html_loader.js :frontend_src/modules/js/html_loader.js
mpremote connect auto fs cp frontend_src/modules/js/core.js :frontend_src/modules/js/core.js
mpremote connect auto fs cp frontend_src/modules/js/chat.js :frontend_src/modules/js/chat.js
mpremote connect auto fs cp frontend_src/modules/js/device.js :frontend_src/modules/js/device.js
mpremote connect auto fs cp frontend_src/modules/js/code.js :frontend_src/modules/js/code.js
mpremote connect auto fs cp frontend_src/modules/js/ui.js :frontend_src/modules/js/ui.js
mpremote connect auto reset
```

## 前端源码模块化（推荐）

前端现在直接运行语义模块：`frontend_src/modules/html`、`frontend_src/modules/js`、`frontend_src/modules/css`。

这样你在日常修改时只需要看少量语义模块，不必每次都翻整份大文件；页面和板子都直接加载这些模块文件。

### 当前模块划分

- `frontend_src/modules/js/core.js`：服务商配置、状态、DOM、初始化、事件、基础 API、Ollama、配置管理
- `frontend_src/modules/js/chat.js`：对话、输入、附件、发送、生成、渲染、统计
- `frontend_src/modules/js/device.js`：设备管理
- `frontend_src/modules/js/code.js`：代码调试/运行相关的工具函数与运行配置辅助逻辑
- `frontend_src/modules/js/ui.js`：复制、清空、导出、图片模态框、Toast、启动入口
- `frontend_src/modules/css/base.css`：主题变量、重置、滚动条
- `frontend_src/modules/css/layout.css`：侧边栏、面板、表单、按钮、顶部栏、统计栏
- `frontend_src/modules/css/device.css`：设备管理样式
- `frontend_src/modules/css/chat.css`：聊天区、消息、Markdown、输入区、附件
- `frontend_src/modules/css/overlays.css`：Toast、弹窗、错误提示
- `frontend_src/modules/css/highlight.css`：代码高亮覆盖
- `frontend_src/modules/css/responsive.css`：响应式适配

### 开发/回归命令

```powershell
python -u smoke_test.py
```

> 页面直接加载 `frontend_src/modules/*`，上传测试时优先上传这些模块文件。

## 3）访问设备

重启后串口会打印：

- `[WiFi] 已连接, IP: ...`
- `[READY] 浏览器打开: http://<ip>`

在浏览器打开该地址即可。

## 代码运行安全限制

当前调试运行模块默认限制：

- 代码文本上限：`12000` 字符
- 调用预算：`6000`
- 可迭代预算：`2000`
- 输出上限：`4000` 字符 / `120` 行
- HTTP 请求上限：header `8192` 字节，body `16384` 字节
- `import` 策略：默认放开，使用黑名单阻断高风险模块（如 `os/socket/network/_thread` 等）
- 允许 `while` 循环：系统会自动注入循环守卫 + 软心跳检查（类似看门狗），避免长时间卡死主服务
- 输出/错误为轮询流式刷新：运行中会持续更新，不必等任务结束
- 运行配置入口在“调试 · 运行 · 固化”标题右侧 `⚙`：可修改并保存到 Flash（文本上限、心跳阈值、调用/迭代预算、输出上限、HTTP 上限、`import` 黑名单）
- 支持“停止”按钮：对运行中的任务发出协作式中断请求

### 运行配置项说明（`⚙`）

- `代码文本上限`（字符，默认 `12000`）：限制草稿/运行代码长度，超出会拒绝运行，`0` 表示不限制。
- `调用预算`（次，默认 `6000`）：限制函数/API 调用总次数，`0` 表示关闭该限制。
- `可迭代预算`（项，默认 `2000`）：限制 `range/enumerate` 规模，`0` 表示关闭该限制。
- `输出上限(字符)`（默认 `4000`）：stdout 最大字符保留量，超出会截断，`0` 表示不限制。
- `输出上限(行)`（默认 `120`）：stdout 最大行保留量，超出会截断，`0` 表示不限制。
- `HTTP Header 上限`（字节，默认 `8192`）：单请求 header 读取上限，`0` 表示不限制。
- `HTTP Body 上限`（字节，默认 `16384`）：单请求 body 读取上限，`0` 表示不限制。
- `心跳间隔`（ms，默认 `300`）：软心跳最小刷新间隔，`0` 表示每次检查都刷新。
- `心跳失联判定`（ms，默认 `5000`）：运行时唯一使用的“失联判定阈值”。当循环长时间不更新心跳，超过该值会触发中断，`0` 表示不限制。
- `import 黑名单`（逗号分隔，默认 `os,uos,sys,socket,usocket,network,_thread,threading,subprocess,select,ssl,asyncio,uasyncio`）：命中黑名单模块将禁止 import。

> 当前界面已移除“执行超时”输入项，避免和“心跳失联判定”重复概念。

### `while` 循环策略（重点）

运行器对 `while` 会做两件事：

1. 自动注入 `__loop_guard__()`：用于预算检查（调用次数、停止请求等）。
2. 自动注入 `__soft_watch__()`：用于刷新软心跳时间戳。

执行中断条件（常见）：

- `stopRequested = True`（你点击“停止”）
- `call budget exceeded`（调用预算超限）
- `heartbeat lost`（心跳失联，长时间未刷新）

因此它不是“禁止死循环”，而是“允许循环运行，但在不可控时可被守卫中断”。

### 调参建议

- **更稳（防卡死优先）**：
  - 心跳间隔：`200~300 ms`
  - 心跳失联判定：`3000~5000 ms`
- **更可玩（长循环优先）**：
  - 心跳间隔：`300~500 ms`
  - 心跳失联判定：`8000~20000 ms`

每项右侧 `!` 按钮可点击查看说明；底部 `恢复默认配置` 会一键恢复并保存到 Flash。

所有数值型限制都支持设置 `0`，表示“不限制”。

命中限制后，可在 `/api/code/status` 看到：

- `status = limited` 或 `error`
- `limitHit`
- `outputTruncated`

运行中执行固化会返回 `409`，避免状态冲突。

## 快速回归建议

1. 在网页“调试运行”写入并保存草稿。
2. 运行草稿，确认状态和输出回显。
3. 固化草稿并读取 active，确认一致。
4. 查询 `/api/code/history` 和 `/api/code/log`，确认记录正常。
5. 在运行配置里改参数并保存，断电重启后确认仍然生效。
