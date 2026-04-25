/* ===== app.js - AI Chat Studio ===== */

// ─── 默认服务商配置 ───────────────────────────────────────
const PROVIDERS = {
  openai:    { baseUrl: 'https://api.openai.com/v1',                         models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo','o1','o1-mini','o3-mini'], needKey: true },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1',                      models: ['claude-opus-4-5','claude-sonnet-4-5','claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022','claude-3-opus-20240229'], needKey: true },
  deepseek:  { baseUrl: 'https://api.deepseek.com/v1',                       models: ['deepseek-chat','deepseek-reasoner'], needKey: true },
  qwen:      { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max','qwen-plus','qwen-turbo','qwen3-235b-a22b','qwq-32b'], needKey: true },
  zhipu:     { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',              models: ['glm-4-air','glm-4-plus','glm-4-flash','glm-z1-flash'], needKey: true },
  ollama:    { baseUrl: 'http://localhost:11434/v1',                          models: [], needKey: false },
  custom:    { baseUrl: '',                                                    models: [], needKey: true },
};

// ─── 状态 ────────────────────────────────────────────────
let config = {
  provider: 'openai',
  baseUrl: PROVIDERS.openai.baseUrl,
  apiKey: '',
  model: 'gpt-4o',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4096,
  stream: true,
  chatMode: 'normal',
};

let currentTab = 'chat';       // 当前激活的侧边栏 tab
let conversations = [];
let currentConvId = null;
let isGenerating = false;
let abortController = null;
let attachedFiles = []; // [{ id, name, size, dataUrl, type }]
let currentTheme = 'dark';
const API_BASE = '/api';
const DEVICE_STATUS_INTERVAL_MS = 15000;
const SIDEBAR_WIDTH_STORAGE_KEY = 'sidebarWidth';

let persistQueue = Promise.resolve();
let deviceStatus = { connected: false, ip: null };
let codeStatusTimer = null;
let sidebarExpandedWidth = 380;
let agentSettingsCache = null;
let agentMemoryBaseline = {};

function getModePromptFromSettings(mode, settings) {
  const m = String(mode || 'normal').trim().toLowerCase();
  const cfg = (settings && typeof settings === 'object') ? settings : {};
  const modePrompts = (cfg.modePrompts && typeof cfg.modePrompts === 'object') ? cfg.modePrompts : {};
  const fromMode = modePrompts[m];
  if (typeof fromMode === 'string' && fromMode.trim()) return fromMode;
  const legacy = cfg.systemPrompt;
  if (typeof legacy === 'string' && legacy.trim()) return legacy;
  return '';
}

function resolveChatModePrompt(mode) {
  const m = String(mode || 'normal').trim().toLowerCase();
  if (m === 'normal') return String(config.systemPrompt || '');
  return getModePromptFromSettings(m, agentSettingsCache);
}

async function syncNormalPromptToAgentSettings(normalPrompt) {
  const prompt = String(normalPrompt || '');
  let base = agentSettingsCache;
  if (!base || typeof base !== 'object') {
    base = await apiGet('/agent/settings');
  }
  const payload = { ...(base || {}) };
  const modePrompts = (payload.modePrompts && typeof payload.modePrompts === 'object') ? { ...payload.modePrompts } : {};
  modePrompts.normal = prompt;
  payload.modePrompts = modePrompts;
  // Keep legacy field aligned for backward-compatible fallback.
  payload.systemPrompt = prompt;

  const ret = await apiPost('/agent/settings', payload);
  agentSettingsCache = (ret && ret.settings && typeof ret.settings === 'object') ? ret.settings : payload;
}

// ─── DOM 引用 ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  menuBtn: $('menuBtn'),
  chatModeSelect: $('chatModeSelect'),
  navBtns: document.querySelectorAll('.nav-btn'),
  panelSettings: $('panel-settings'),
  panelAgent: $('panel-agent'),
  panelHistory: $('panel-history'),
  panelDevice: $('panel-device'),
  panelCode: $('panel-code'),
  providerSelect: $('providerSelect'),
  baseUrl: $('baseUrl'),
  apiKeyGroup: $('apiKeyGroup'),
  apiKey: $('apiKey'),
  toggleKey: $('toggleKey'),
  modelName: $('modelName'),
  fetchModels: $('fetchModels'),
  modelList: $('modelList'),
  ollamaModelSelect: $('ollamaModelSelect'),
  systemPrompt: $('systemPrompt'),
  temperature: $('temperature'),
  tempVal: $('tempVal'),
  maxTokens: $('maxTokens'),
  streamMode: $('streamMode'),
  saveConfig: $('saveConfig'),
  configStatus: $('configStatus'),
  agentCodingPrompt: $('agentCodingPrompt'),
  saveAgentPromptBtn: $('saveAgentPromptBtn'),
  agentPromptStatus: $('agentPromptStatus'),
  agentMemoryEditor: $('agentMemoryEditor'),
  saveAgentMemoryBtn: $('saveAgentMemoryBtn'),
  agentMemoryStatus: $('agentMemoryStatus'),
  currentModelBadge: $('currentModelBadge'),
  themeToggle: $('themeToggle'),
  clearChat: $('clearChat'),
  exportChat: $('exportChat'),
  statIn: $('statIn'),
  statOut: $('statOut'),
  statTotal: $('statTotal'),
  statContext: $('statContext'),
  statDevice: $('statDevice'),
  refreshDeviceStatus: $('refreshDeviceStatus'),
  // 设备管理
  deviceTabs: document.querySelectorAll('.device-tab-btn'),
  deviceTabContents: document.querySelectorAll('.device-tab-content'),
  memoryProgress: $('memoryProgress'),
  memoryValue: $('memoryValue'),
  boardLedColor: $('boardLedColor'),
  boardLedPreset: $('boardLedPreset'),
  boardLedMode: $('boardLedMode'),
  boardLedOnBtn: $('boardLedOnBtn'),
  boardLedOffBtn: $('boardLedOffBtn'),
  boardLedStatus: $('boardLedStatus'),
  gpioList: $('gpioList'),
  gpioWritePin: $('gpioWritePin'),
  gpioWriteValue: $('gpioWriteValue'),
  gpioWriteBtn: $('gpioWriteBtn'),
  gpioReadPin: $('gpioReadPin'),
  gpioReadBtn: $('gpioReadBtn'),
  gpioReadResult: $('gpioReadResult'),
  servoPin: $('servoPin'),
  servoFreq: $('servoFreq'),
  servoMinUs: $('servoMinUs'),
  servoMaxUs: $('servoMaxUs'),
  servoMode: $('servoMode'),
  servoContinuousCfg: $('servoContinuousCfg'),
  servoNeutralUs: $('servoNeutralUs'),
  servoSpanUs: $('servoSpanUs'),
  configServoBtn: $('configServoBtn'),
  servoList: $('servoList'),
  serialUartId: $('serialUartId'),
  serialBaudrate: $('serialBaudrate'),
  serialBits: $('serialBits'),
  serialParity: $('serialParity'),
  serialStop: $('serialStop'),
  serialRxPin: $('serialRxPin'),
  serialTxPin: $('serialTxPin'),
  serialPinHint: $('serialPinHint'),
  serialHexView: $('serialHexView'),
  serialRefreshCfgBtn: $('serialRefreshCfgBtn'),
  serialSaveCfgBtn: $('serialSaveCfgBtn'),
  serialLog: $('serialLog'),
  serialClearLogBtn: $('serialClearLogBtn'),
  serialTxInput: $('serialTxInput'),
  serialTxFormat: $('serialTxFormat'),
  serialTxSendBtn: $('serialTxSendBtn'),
  serialPresetSelect: $('serialPresetSelect'),
  serialPresetName: $('serialPresetName'),
  serialPresetValue: $('serialPresetValue'),
  serialPresetFormat: $('serialPresetFormat'),
  serialPresetSaveBtn: $('serialPresetSaveBtn'),
  serialPresetDeleteBtn: $('serialPresetDeleteBtn'),
  serialPresetSendBtn: $('serialPresetSendBtn'),
  codeRunSource: $('codeRunSource'),
  codeEditor: $('codeEditor'),
  codeLoadDraftBtn: $('codeLoadDraftBtn'),
  codeLoadActiveBtn: $('codeLoadActiveBtn'),
  codeSaveDraftBtn: $('codeSaveDraftBtn'),
  codeSaveDraftBtn2: $('codeSaveDraftBtn2'),
  codeRunBtn: $('codeRunBtn'),
  codeStopBtn: $('codeStopBtn'),
  codePersistBtn: $('codePersistBtn'),
  codeRefreshStatusBtn: $('codeRefreshStatusBtn'),
  codeLoadCfgBtn: $('codeLoadCfgBtn'),
  codeSaveCfgBtn: $('codeSaveCfgBtn'),
  codeResetCfgBtn: $('codeResetCfgBtn'),
  codeConfigToggleBtn: $('codeConfigToggleBtn'),
  codeBootAutorunEnabled: $('codeBootAutorunEnabled'),
  codeConfigPanel: $('codeConfigPanel'),
  codeConfigModal: $('codeConfigModal'),
  codeConfigModalOverlay: $('codeConfigModalOverlay'),
  codeConfigModalClose: $('codeConfigModalClose'),
  codeCfgTextLimit: $('codeCfgTextLimit'),
  codeCfgCallBudget: $('codeCfgCallBudget'),
  codeCfgIterBudget: $('codeCfgIterBudget'),
  codeCfgOutputChars: $('codeCfgOutputChars'),
  codeCfgOutputLines: $('codeCfgOutputLines'),
  codeCfgRunLogChars: $('codeCfgRunLogChars'),
  codeCfgHttpHeader: $('codeCfgHttpHeader'),
  codeCfgHttpBody: $('codeCfgHttpBody'),
  codeCfgHeartbeatInterval: $('codeCfgHeartbeatInterval'),
  codeCfgHeartbeatStall: $('codeCfgHeartbeatStall'),
  codeCfgImportBlocklist: $('codeCfgImportBlocklist'),
  codeCfgLimitsEnabled: $('codeCfgLimitsEnabled'),
  codeCfgLimitsGroup: $('codeCfgLimitsGroup'),
  codeHistoryRefreshBtn: $('codeHistoryRefreshBtn'),
  codeHistoryList: $('codeHistoryList'),
  codeHistoryMeta: $('codeHistoryMeta'),
  codeHistoryPreview: $('codeHistoryPreview'),
  codeHistoryLoadDraftBtn: $('codeHistoryLoadDraftBtn'),
  codeHistoryPersistBtn: $('codeHistoryPersistBtn'),
  codeRuntimeStatus: $('codeRuntimeStatus'),
  codeRuntimeJob: $('codeRuntimeJob'),
  codeRuntimeDuration: $('codeRuntimeDuration'),
  codeRuntimeVersion: $('codeRuntimeVersion'),
  codeRuntimeNote: $('codeRuntimeNote'),
  codeRuntimeOutput: $('codeRuntimeOutput'),
  codeRuntimeLog: $('codeRuntimeLog'),
  codeClearOutputBtn: $('codeClearOutputBtn'),
  codeClearRuntimeLogBtn: $('codeClearRuntimeLogBtn'),
  chatContainer: $('chatContainer'),
  welcomeScreen: $('welcomeScreen'),
  messageList: $('messageList'),
  userInput: $('userInput'),
  charCount: $('charCount'),
  sendBtn: $('sendBtn'),
  attachBtn: $('attachBtn'),
  attachmentPreview: $('attachmentPreview'),
  newChat: $('newChat'),
  historyList: $('historyList'),
  toast: $('toast'),
  imageModal: $('imageModal'),
  modalImg: $('modalImg'),
  modalOverlay: $('modalOverlay'),
  modalClose: $('modalClose'),
  sidebarResizer: $('sidebarResizer'),
};

// ─── 初始化 ───────────────────────────────────────────────
async function init() {
  await loadConfig();
  loadTheme();
  initSidebarWidth();
  await loadConversations();
  bindEvents();
  fillForm();
  updateModelBadge();
  await fetchDeviceStatus();
  setInterval(() => fetchDeviceStatus(true), DEVICE_STATUS_INTERVAL_MS);
  if (conversations.length === 0) newConversation();
  else loadConversation(conversations[conversations.length - 1].id);
  switchTab('chat');  // 确保初始状态正确
}

function queuePersist(task) {
  persistQueue = persistQueue
    .then(task)
    .catch(e => console.warn('Persist failed:', e));
  return persistQueue;
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchDeviceStatus(silent = false) {
  try {
    const data = await apiGet('/ip');
    deviceStatus = {
      connected: !!data?.connected,
      ip: data?.ip || null,
    };
    updateDeviceStatus();
    if (!silent) {
      const ipText = deviceStatus.ip && deviceStatus.ip !== '0.0.0.0' ? ` (${deviceStatus.ip})` : '';
      showToast(deviceStatus.connected ? `设备在线${ipText}` : '设备离线');
    }
  } catch (e) {
    deviceStatus = { connected: false, ip: null };
    updateDeviceStatus();
    if (!silent) showToast('设备状态刷新失败');
    console.warn('Cannot get ESP32 status:', e);
  }
}

// ─── Tab 切换（核心修复） ─────────────────────────────────
function switchTab(tab) {
  currentTab = tab;

  // 更新导航按钮 active 状态
  el.navBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // 显示/隐藏面板 — 用 display 直接控制，不依赖 hidden 类
  el.panelSettings.style.display = (tab === 'settings') ? 'flex' : 'none';
  if (el.panelAgent) {
    el.panelAgent.style.display = (tab === 'agent') ? 'flex' : 'none';
  }
  el.panelHistory.style.display  = (tab === 'history')  ? 'flex' : 'none';
  el.panelDevice.style.display   = (tab === 'device')   ? 'flex' : 'none';
  if (el.panelCode) {
    el.panelCode.style.display = (tab === 'code') ? 'flex' : 'none';
  }

  // 切换到 Ollama 时自动拉取模型
  if (tab === 'settings' && el.providerSelect.value === 'ollama') {
    fetchOllamaModels();
  }

  if (tab === 'agent') {
    loadAgentPanel();
  }

  // 切换到设备管理时刷新状态
  if (tab === 'device') {
    loadDeviceStatus();
    if (typeof loadSerialAssistant === 'function') {
      loadSerialAssistant(true);
    }
  } else {
    if (typeof stopSerialPolling === 'function') {
      stopSerialPolling();
    }
  }
}

// ─── 事件绑定 ─────────────────────────────────────────────
function bindEvents() {
  // 侧边栏
  el.sidebarToggle.addEventListener('click', toggleSidebar);
  el.menuBtn.addEventListener('click', () => el.sidebar.classList.toggle('mobile-open'));

  // 导航标签
  el.navBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // API 配置
  el.providerSelect.addEventListener('change', onProviderChange);
  if (el.chatModeSelect) {
    el.chatModeSelect.addEventListener('change', () => {
      config.chatMode = el.chatModeSelect.value || 'normal';
      localStorage.setItem('ai_chat_config', JSON.stringify(config));
    });
  }
  el.temperature.addEventListener('input', () => {
    el.tempVal.textContent = el.temperature.value;
  });
  el.toggleKey.addEventListener('click', () => {
    el.apiKey.type = el.apiKey.type === 'password' ? 'text' : 'password';
    el.toggleKey.textContent = el.apiKey.type === 'password' ? '👁' : '🙈';
  });
   el.saveConfig.addEventListener('click', saveConfig);
   el.fetchModels.addEventListener('click', onFetchModelsClick);
   if (el.saveAgentPromptBtn) el.saveAgentPromptBtn.addEventListener('click', saveAgentPrompt);
   if (el.saveAgentMemoryBtn) el.saveAgentMemoryBtn.addEventListener('click', saveAgentMemory);
   if (el.refreshDeviceStatus) {
     el.refreshDeviceStatus.addEventListener('click', () => fetchDeviceStatus(false));
   }

   // 设备管理标签切换
   el.deviceTabs.forEach(btn => {
     btn.addEventListener('click', () => {
       const tab = btn.dataset.deviceTab;
       el.deviceTabs.forEach(b => b.classList.toggle('active', b === btn));
       el.deviceTabContents.forEach(content => {
         content.style.display = content.id === `device-tab-${tab}` ? 'block' : 'none';
       });
      if (tab === 'serial') {
        if (typeof loadSerialAssistant === 'function') loadSerialAssistant(false);
      } else {
        if (typeof stopSerialPolling === 'function') stopSerialPolling();
      }
     });
   });

   // 舵机配置
   if (el.configServoBtn) {
     el.configServoBtn.addEventListener('click', configureServo);
   }
   if (el.gpioWriteBtn) {
     el.gpioWriteBtn.addEventListener('click', writeGpioValue);
   }
   if (el.gpioReadBtn) {
     el.gpioReadBtn.addEventListener('click', readGpioValue);
   }
   if (el.boardLedOnBtn) {
     el.boardLedOnBtn.addEventListener('click', () => setBoardLed(true));
   }
   if (el.boardLedOffBtn) {
     el.boardLedOffBtn.addEventListener('click', () => setBoardLed(false));
   }
   if (el.boardLedPreset) {
     el.boardLedPreset.addEventListener('change', () => {
       const [r, g, b] = (el.boardLedPreset.value || '0,255,0').split(',').map(Number);
       el.boardLedColor.value = rgbToHex(r, g, b);
     });
   }
   if (el.servoMode) {
     el.servoMode.addEventListener('change', updateServoModeForm);
     updateServoModeForm();
   }
   if (el.gpioList) {
     el.gpioList.addEventListener('click', onGpioCardAction);
   }
    if (el.serialRefreshCfgBtn) el.serialRefreshCfgBtn.addEventListener('click', () => loadSerialAssistant(false));
    if (el.serialSaveCfgBtn) el.serialSaveCfgBtn.addEventListener('click', saveSerialConfig);
    if (el.serialTxSendBtn) el.serialTxSendBtn.addEventListener('click', sendSerialPayload);
    if (el.serialClearLogBtn) el.serialClearLogBtn.addEventListener('click', clearSerialLog);
    if (el.serialPresetSaveBtn) el.serialPresetSaveBtn.addEventListener('click', saveSerialPreset);
    if (el.serialPresetDeleteBtn) el.serialPresetDeleteBtn.addEventListener('click', deleteSerialPreset);
    if (el.serialPresetSendBtn) el.serialPresetSendBtn.addEventListener('click', sendSelectedSerialPreset);
    if (el.serialPresetSelect) {
      el.serialPresetSelect.addEventListener('change', onSerialPresetChange);
    }
    if (el.serialUartId) {
      el.serialUartId.addEventListener('change', onSerialUartChanged);
    }
    if (el.serialRxPin) {
      el.serialRxPin.addEventListener('change', onSerialUartChanged);
    }
    if (el.serialTxPin) {
      el.serialTxPin.addEventListener('change', onSerialUartChanged);
    }
    if (el.serialHexView) {
      el.serialHexView.addEventListener('change', () => {
        if (typeof refreshSerialLogView === 'function') refreshSerialLogView();
      });
    }
   if (el.codeLoadDraftBtn) el.codeLoadDraftBtn.addEventListener('click', loadCodeDraft);
   if (el.codeLoadActiveBtn) el.codeLoadActiveBtn.addEventListener('click', loadCodeActive);
   if (el.codeSaveDraftBtn) el.codeSaveDraftBtn.addEventListener('click', saveCodeDraft);
   if (el.codeSaveDraftBtn2) el.codeSaveDraftBtn2.addEventListener('click', saveCodeDraft);
   if (el.codeRunBtn) el.codeRunBtn.addEventListener('click', runCode);
    if (el.codeStopBtn) el.codeStopBtn.addEventListener('click', stopCodeRun);
   if (el.codePersistBtn) el.codePersistBtn.addEventListener('click', persistCode);
   if (el.codeRefreshStatusBtn) el.codeRefreshStatusBtn.addEventListener('click', () => refreshCodeStatus(false));
    if (el.codeHistoryRefreshBtn) el.codeHistoryRefreshBtn.addEventListener('click', () => loadCodeHistoryList(false));
    if (el.codeHistoryLoadDraftBtn) el.codeHistoryLoadDraftBtn.addEventListener('click', restoreSelectedHistoryToDraft);
    if (el.codeHistoryPersistBtn) el.codeHistoryPersistBtn.addEventListener('click', persistSelectedHistoryVersion);
    if (el.codeHistoryList) {
      el.codeHistoryList.addEventListener('click', e => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-action][data-version]') : null;
        if (!btn) return;
        const action = btn.getAttribute('data-action') || 'view';
        const version = btn.getAttribute('data-version') || '';
        if (action === 'delete') {
          deleteCodeHistoryVersion(version);
          return;
        }
        viewCodeHistoryVersion(version);
      });
    }
    if (el.codeLoadCfgBtn) el.codeLoadCfgBtn.addEventListener('click', loadCodeConfig);
    if (el.codeSaveCfgBtn) el.codeSaveCfgBtn.addEventListener('click', saveCodeConfig);
    if (el.codeResetCfgBtn) el.codeResetCfgBtn.addEventListener('click', resetCodeConfigDefaults);
    if (el.codeClearOutputBtn) el.codeClearOutputBtn.addEventListener('click', clearCodeOutputWindow);
    if (el.codeClearRuntimeLogBtn) el.codeClearRuntimeLogBtn.addEventListener('click', clearCodeRuntimeLogWindow);
    if (el.codeConfigToggleBtn) el.codeConfigToggleBtn.addEventListener('click', toggleCodeConfigPanel);
    if (el.codeConfigModalOverlay) el.codeConfigModalOverlay.addEventListener('click', () => closeCodeConfigModal());
    if (el.codeConfigModalClose) el.codeConfigModalClose.addEventListener('click', () => closeCodeConfigModal());

   // Ollama 模型下拉选中
  el.ollamaModelSelect.addEventListener('change', () => {
    if (el.ollamaModelSelect.value) {
      el.modelName.value = el.ollamaModelSelect.value;
    }
  });

  // 主题切换
  el.themeToggle.addEventListener('click', toggleTheme);

  // 输入
  el.userInput.addEventListener('input', onInputChange);
  el.userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // 发送/停止
  el.sendBtn.addEventListener('click', () => {
    if (isGenerating) stopGeneration();
    else sendMessage();
  });

  // 附件（图片）
  el.attachBtn.addEventListener('click', openImagePicker);

  // 工具栏
  el.clearChat.addEventListener('click', clearCurrentChat);
  el.exportChat.addEventListener('click', exportChat);
  el.newChat.addEventListener('click', newConversation);

  // 图片模态框
  el.modalOverlay.addEventListener('click', closeModal);
  el.modalClose.addEventListener('click', closeModal);

  window.addEventListener('resize', checkMobile);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCodeConfigModal();
  });
  if (el.sidebarResizer) {
    el.sidebarResizer.addEventListener('mousedown', startSidebarResize);
  }
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('.info-dot') : null;
    if (!btn) return;
    const help = btn.getAttribute('data-help') || btn.getAttribute('title') || '';
    if (help) showToast(help, 3800);
  });
}

// ─── 侧边栏 ───────────────────────────────────────────────
function toggleSidebar() {
  if (!el.sidebar) return;
  const willCollapse = !el.sidebar.classList.contains('collapsed');
  if (willCollapse) {
    sidebarExpandedWidth = el.sidebar.offsetWidth > 80 ? el.sidebar.offsetWidth : sidebarExpandedWidth;
    el.sidebar.classList.add('collapsed');
    el.sidebar.style.width = '60px';
    el.sidebar.style.minWidth = '60px';
    if (el.sidebarResizer) el.sidebarResizer.style.display = 'none';
  } else {
    el.sidebar.classList.remove('collapsed');
    setSidebarWidth(sidebarExpandedWidth);
    if (el.sidebarResizer) el.sidebarResizer.style.display = '';
  }
}

function checkMobile() {
  if (window.innerWidth <= 768) {
    el.sidebar.classList.remove('collapsed');
  }
}

// ─── 主题切换 ─────────────────────────────────────────────
function loadTheme() {
  const saved = localStorage.getItem('ai_chat_theme') || 'dark';
  applyTheme(saved);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  el.themeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';

  // 切换 highlight.js 主题
  const hljsLink = document.getElementById('hljs-theme');
  if (hljsLink) {
    hljsLink.href = theme === 'dark'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
  }

  localStorage.setItem('ai_chat_theme', theme);
}

function toggleTheme() {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

// ─── 服务商切换 ───────────────────────────────────────────
function onProviderChange() {
  const p = el.providerSelect.value;
  const providerData = PROVIDERS[p];

  if (providerData.baseUrl) el.baseUrl.value = providerData.baseUrl;
  else el.baseUrl.value = '';

  if (p === 'custom') el.baseUrl.placeholder = 'https://your-api.com/v1';
  if (p === 'ollama') el.baseUrl.placeholder = 'http://localhost:11434/v1';

  // API Key 对 Ollama 可选
  el.apiKeyGroup.style.opacity = providerData.needKey ? '1' : '0.5';

  // 重置模型下拉
  el.ollamaModelSelect.style.display = 'none';
  el.ollamaModelSelect.innerHTML = '<option value="">-- 选择模型 --</option>';

  if (providerData.models.length > 0) {
    el.modelName.value = providerData.models[0];
    fillDatalist(providerData.models);
  } else {
    el.modelName.value = '';
    el.modelList.innerHTML = '';
  }

  // Ollama：自动拉取模型
  if (p === 'ollama') {
    fetchOllamaModels();
  }
}

function fillDatalist(models) {
  el.modelList.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    el.modelList.appendChild(opt);
  });
}

// ─── 拉取 Ollama 本地模型 ─────────────────────────────────
async function fetchOllamaModels() {
  const baseUrlRaw = el.baseUrl.value.trim().replace(/\/$/, '');
  // Ollama 的模型列表 API 在 /api/tags，与 OpenAI 的 /v1/models 不同
  // 我们先尝试 /v1/models（若用了 OpenAI 兼容层），再降级到原生 /api/tags
  const ollamaBase = baseUrlRaw.replace(/\/v1$/, '');

  // 显示 loading
  let statusEl = document.getElementById('ollamaStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'ollamaStatus';
    statusEl.className = 'ollama-status';
    el.ollamaModelSelect.parentNode.appendChild(statusEl);
  }
  statusEl.textContent = '正在连接 Ollama…';
  statusEl.className = 'ollama-status loading';

  el.fetchModels.textContent = '…';
  el.fetchModels.disabled = true;

  let models = [];

  try {
    // 优先尝试原生 Ollama API
    const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    }
  } catch(e) {}

  // 若原生 API 失败，尝试 OpenAI 兼容层
  if (models.length === 0) {
    try {
      const headers = {};
      const key = el.apiKey.value.trim();
      if (key) headers['Authorization'] = `Bearer ${key}`;
      const res = await fetch(`${baseUrlRaw}/models`, { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        models = (data.data || []).map(m => m.id || m).filter(Boolean);
      }
    } catch(e) {}
  }

  el.fetchModels.textContent = '↻';
  el.fetchModels.disabled = false;

  if (models.length === 0) {
    statusEl.textContent = '⚠ 未能连接到 Ollama，请确认服务已启动';
    statusEl.className = 'ollama-status err';
    return;
  }

  // 填充下拉和 datalist
  fillDatalist(models);
  el.ollamaModelSelect.innerHTML = '<option value="">-- 选择模型 --</option>';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    el.ollamaModelSelect.appendChild(opt);
  });
  el.ollamaModelSelect.style.display = 'block';

  // 默认选第一个
  if (models.length > 0 && !el.modelName.value) {
    el.modelName.value = models[0];
    el.ollamaModelSelect.value = models[0];
  }

  statusEl.textContent = `✓ 已加载 ${models.length} 个本地模型`;
  statusEl.className = 'ollama-status ok';
  showToast(`Ollama 已连接，找到 ${models.length} 个模型`);
}

// ─── 通用获取模型列表按钮 ─────────────────────────────────
async function onFetchModelsClick() {
  const p = el.providerSelect.value;
  if (p === 'ollama') {
    await fetchOllamaModels();
  } else {
    await fetchModelList();
  }
}

async function fetchModelList() {
  const baseUrl = el.baseUrl.value.trim().replace(/\/$/, '');
  const apiKey = el.apiKey.value.trim();
  if (!baseUrl) { showToast('请先填写 Base URL'); return; }

  el.fetchModels.textContent = '…';
  el.fetchModels.disabled = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || data.models || []).map(m => m.id || m).filter(Boolean);
    fillDatalist(models);
    showToast(`获取到 ${models.length} 个模型`);
  } catch(e) {
    showToast('获取模型列表失败: ' + e.message);
  } finally {
    el.fetchModels.textContent = '↻';
    el.fetchModels.disabled = false;
  }
}

// ─── 配置管理 ─────────────────────────────────────────────
function fillForm() {
  config.chatMode = (config.chatMode || 'normal');
  if (!['normal', 'coding', 'react'].includes(config.chatMode)) {
    config.chatMode = 'normal';
  }
  if (el.chatModeSelect) el.chatModeSelect.value = config.chatMode;
  el.providerSelect.value = config.provider;
  el.baseUrl.value = config.baseUrl;
  el.apiKey.value = config.apiKey;
  el.modelName.value = config.model;
  el.systemPrompt.value = config.systemPrompt;
  el.temperature.value = config.temperature;
  el.tempVal.textContent = config.temperature;
  el.maxTokens.value = config.maxTokens;
  el.streamMode.checked = config.stream;
  fillDatalist(PROVIDERS[config.provider]?.models || []);

  // Ollama 特殊处理
  if (config.provider === 'ollama') {
    el.apiKeyGroup.style.opacity = '0.5';
  }
}

async function saveConfig() {
  const p = el.providerSelect.value;
  const baseUrl = el.baseUrl.value.trim().replace(/\/$/, '');
  const apiKey = el.apiKey.value.trim();
  const model = el.modelName.value.trim();

  // Ollama 不需要 API Key
  const needKey = PROVIDERS[p]?.needKey !== false;
  if (needKey && !apiKey) {
    showConfigStatus('请填写 API Key', 'err');
    return;
  }
  if (!baseUrl) {
    showConfigStatus('请填写 Base URL', 'err');
    return;
  }
  if (!model) {
    showConfigStatus('请填写模型名称', 'err');
    return;
  }

  config = {
    provider: p,
    baseUrl,
    apiKey: apiKey || 'ollama',  // Ollama 给个默认值避免请求失败
    model,
    systemPrompt: el.systemPrompt.value,
    temperature: parseFloat(el.temperature.value),
    maxTokens: parseInt(el.maxTokens.value) || 4096,
    stream: el.streamMode.checked,
    chatMode: el.chatModeSelect ? (el.chatModeSelect.value || 'normal') : (config.chatMode || 'normal'),
  };

  localStorage.setItem('ai_chat_config', JSON.stringify(config));

  try {
    await apiPost('/config', config);
    try {
      await syncNormalPromptToAgentSettings(config.systemPrompt);
    } catch (syncErr) {
      console.warn('Sync normal mode prompt to agent settings failed:', syncErr);
    }
    showConfigStatus('✓ 配置已保存到 ESP32', 'ok');
  } catch (e) {
    showConfigStatus('已保存到浏览器，ESP32 写入失败', 'err');
  }

  updateModelBadge();
  updateContextStat();
  showToast('配置已保存');
}

async function loadConfig() {
  let loadedFromEsp = false;
  try {
    const remote = await apiGet('/config');
    if (remote && typeof remote === 'object') {
      config = { ...config, ...remote };
      loadedFromEsp = true;
    }
  } catch (e) {
    console.warn('Load config from ESP32 failed:', e);
  }

  if (loadedFromEsp) return;

  try {
    const saved = localStorage.getItem('ai_chat_config');
    if (saved) config = { ...config, ...JSON.parse(saved) };
  } catch(e) {}
}

function showConfigStatus(msg, type) {
  el.configStatus.textContent = msg;
  el.configStatus.className = 'config-status ' + type;
}

function showInlineStatus(node, msg, type) {
  if (!node) return;
  node.textContent = msg;
  node.className = 'config-status ' + (type || '');
}

function safeJsonClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj || {}));
  } catch (e) {
    return {};
  }
}

async function loadAgentPanel() {
  await loadAgentSettings();
  await loadAgentMemory();
}

async function loadAgentSettings() {
  try {
    const settings = await apiGet('/agent/settings');
    if (!settings || typeof settings !== 'object') throw new Error('invalid settings');
    agentSettingsCache = settings;
    const modePrompts = (settings.modePrompts && typeof settings.modePrompts === 'object') ? settings.modePrompts : {};
    const codingPrompt = String(modePrompts.coding || getModePromptFromSettings('coding', settings) || '');
    const normalPrompt = String(config.systemPrompt || settings.systemPrompt || modePrompts.normal || '');
    if (el.agentCodingPrompt) el.agentCodingPrompt.value = codingPrompt;
    if (el.systemPrompt && normalPrompt !== String(el.systemPrompt.value || '')) {
      el.systemPrompt.value = normalPrompt;
      config.systemPrompt = normalPrompt;
      localStorage.setItem('ai_chat_config', JSON.stringify(config));
    }
    showInlineStatus(el.agentPromptStatus, '已加载', 'ok');
  } catch (e) {
    showInlineStatus(el.agentPromptStatus, '加载失败: ' + e.message, 'err');
  }
}

async function saveAgentPrompt() {
  try {
    const prompt = String(el.agentCodingPrompt?.value || '');
    if (!prompt.trim()) {
      showInlineStatus(el.agentPromptStatus, '提示词不能为空', 'err');
      return;
    }

    let base = agentSettingsCache;
    if (!base || typeof base !== 'object') {
      base = await apiGet('/agent/settings');
    }
    const payload = { ...(base || {}) };
    const modePrompts = (payload.modePrompts && typeof payload.modePrompts === 'object') ? { ...payload.modePrompts } : {};
    modePrompts.coding = prompt;
    payload.modePrompts = modePrompts;

    const ret = await apiPost('/agent/settings', payload);
    agentSettingsCache = (ret && ret.settings && typeof ret.settings === 'object') ? ret.settings : payload;
    showInlineStatus(el.agentPromptStatus, '✓ 提示词已保存', 'ok');
    showToast('编程模式提示词已保存');
  } catch (e) {
    showInlineStatus(el.agentPromptStatus, '保存失败: ' + e.message, 'err');
  }
}

async function loadAgentMemory() {
  try {
    const memory = await apiGet('/agent/memory');
    const mem = (memory && typeof memory === 'object' && !Array.isArray(memory)) ? memory : {};
    agentMemoryBaseline = safeJsonClone(mem);
    if (el.agentMemoryEditor) el.agentMemoryEditor.value = JSON.stringify(mem, null, 2);
    showInlineStatus(el.agentMemoryStatus, '已加载', 'ok');
  } catch (e) {
    showInlineStatus(el.agentMemoryStatus, '加载失败: ' + e.message, 'err');
  }
}

async function saveAgentMemory() {
  try {
    const raw = String(el.agentMemoryEditor?.value || '').trim();
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      showInlineStatus(el.agentMemoryStatus, '记忆必须是 JSON 对象', 'err');
      return;
    }

    const removed = [];
    Object.keys(agentMemoryBaseline || {}).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(parsed, k)) {
        removed.push(k);
      }
    });

    await apiPost('/agent/memory', {
      set: parsed,
      delete: removed,
    });

    agentMemoryBaseline = safeJsonClone(parsed);
    if (el.agentMemoryEditor) el.agentMemoryEditor.value = JSON.stringify(parsed, null, 2);
    showInlineStatus(el.agentMemoryStatus, '✓ 记忆已保存', 'ok');
    showToast('记忆已保存');
  } catch (e) {
    showInlineStatus(el.agentMemoryStatus, '保存失败: ' + e.message, 'err');
  }
}

function updateModelBadge() {
  el.currentModelBadge.textContent = config.model || '未配置';
}
