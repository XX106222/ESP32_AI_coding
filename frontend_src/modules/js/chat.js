// ─── 对话管理 ─────────────────────────────────────────────
function getCurrentConv() {
  return conversations.find(c => c.id === currentConvId);
}

function newConversation() {
  const conv = {
    id: Date.now().toString(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
  };
  conversations.push(conv);
  saveConversations();
  loadConversation(conv.id);
  renderHistoryList();
  // 切换到对话 tab
  switchTab('chat');
}

function loadConversation(id) {
  currentConvId = id;
  const conv = getCurrentConv();
  if (!conv) return;
  el.messageList.innerHTML = '';
  conv.messages.forEach(m => {
    const msgEl = appendMessageDOM(m);
    // 恢复历史消息的 token 统计
    if (m.role === 'assistant' && m.stats) {
      updateMessageStats(msgEl, m.stats);
    }
  });
  el.welcomeScreen.style.display = conv.messages.length === 0 ? 'flex' : 'none';
  refreshConversationStats(conv);
  updateContextStat(conv);
  scrollToBottom();
  renderHistoryList();
}

function saveConversations() {
  try {
    const lite = conversations.map(c => ({
      ...c,
      messages: c.messages.map(m => ({
        ...m,
        images: undefined,
        content: typeof m.content === 'string' ? m.content.slice(0, 8000) : m.content,
      }))
    }));
    localStorage.setItem('ai_chat_conversations', JSON.stringify(lite));
    queuePersist(() => apiPost('/conversations', lite));
  } catch(e) {}
}

async function loadConversations() {
  try {
    const remote = await apiGet('/conversations');
    if (Array.isArray(remote)) {
      conversations = remote;
      return;
    }
  } catch (e) {
    console.warn('Load conversations from ESP32 failed:', e);
  }

  try {
    const saved = localStorage.getItem('ai_chat_conversations');
    if (saved) conversations = JSON.parse(saved);
  } catch(e) { conversations = []; }
}

function renderHistoryList() {
  el.historyList.innerHTML = '';
  const sorted = [...conversations].reverse();
  sorted.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'history-item' + (conv.id === currentConvId ? ' active' : '');
    item.innerHTML = `
      <span class="history-item-title">💬 ${escapeHtml(conv.title)}</span>
      <span class="history-item-del" data-id="${conv.id}" title="删除">🗑</span>
    `;
    item.addEventListener('click', e => {
      if (e.target.classList.contains('history-item-del')) {
        deleteConversation(conv.id);
      } else {
        loadConversation(conv.id);
        switchTab('chat');
      }
    });
    el.historyList.appendChild(item);
  });
}

function deleteConversation(id) {
  conversations = conversations.filter(c => c.id !== id);
  saveConversations();
  if (currentConvId === id) {
    if (conversations.length > 0) loadConversation(conversations[conversations.length - 1].id);
    else newConversation();
  } else {
    renderHistoryList();
  }
}

// ─── 输入处理 ─────────────────────────────────────────────
function onInputChange() {
  const val = el.userInput.value;
  el.charCount.textContent = val.length + ' 字';
  el.userInput.style.height = 'auto';
  el.userInput.style.height = Math.min(el.userInput.scrollHeight, 200) + 'px';
}

function insertPrompt(text) {
  el.userInput.value = text;
  el.userInput.focus();
  onInputChange();
}

// ─── 文件附件 ─────────────────────────────────────────────
function openImagePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.py,.java,.cpp,.c,.go,.rs,.sql,.sh,.bat,.ps1';
  input.multiple = true;
  input.onchange = e => {
    Array.from(e.target.files).forEach(file => {
      const id = Date.now() + Math.random();
      const isImage = file.type.startsWith('image/');

      if (isImage) {
        const reader = new FileReader();
        reader.onload = ev => {
          attachedFiles.push({ id, name: file.name, size: file.size, dataUrl: ev.target.result, type: 'image' });
          renderAttachmentPreview();
        };
        reader.readAsDataURL(file);
      } else {
        // 非图片文件：读取为 dataURL（用于发送），同时显示文件卡片
        const reader = new FileReader();
        reader.onload = ev => {
          attachedFiles.push({ id, name: file.name, size: file.size, dataUrl: ev.target.result, type: 'file' });
          renderAttachmentPreview();
        };
        reader.readAsDataURL(file);
      }
    });
  };
  input.click();
}

// ─── 渲染附件预览（紧凑样式，贴在输入框上方）───────────────
function renderAttachmentPreview() {
  const container = el.attachmentPreview;
  container.innerHTML = '';

  if (attachedFiles.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  attachedFiles.forEach(file => {
    const item = document.createElement('div');
    item.className = 'attachment-item ' + (file.type === 'image' ? 'image-attachment' : 'file-attachment');

    if (file.type === 'image') {
      item.innerHTML = `
        <img src="${file.dataUrl}" alt="${escapeHtml(file.name)}" />
        <button class="attachment-remove" onclick="removeAttachment('${file.id}')">✕</button>
      `;
    } else {
      const ext = file.name.split('.').pop().toUpperCase().slice(0, 4);
      const sizeLabel = formatFileSize(file.size);
      item.innerHTML = `
        <div class="file-icon">${ext}</div>
        <div class="file-info">
          <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="file-size">${sizeLabel}</span>
        </div>
        <button class="attachment-remove" onclick="removeAttachment('${file.id}')">✕</button>
      `;
    }

    container.appendChild(item);
  });
}

function removeAttachment(id) {
  attachedFiles = attachedFiles.filter(f => f.id != id);
  renderAttachmentPreview();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── 全局函数（供 HTML onclick 调用）───────────────────────
window.removeAttachment = removeAttachment;

// ─── 发送消息 ─────────────────────────────────────────────
async function sendMessage() {
  if (isGenerating) return;

  const text = el.userInput.value.trim();
  if (!text && attachedFiles.length === 0) return;

  const needKey = PROVIDERS[config.provider]?.needKey !== false;
  if (needKey && !config.apiKey) {
    showToast('请先在「API 配置」中填写 API Key');
    switchTab('settings');
    return;
  }

  const conv = getCurrentConv();
  if (!conv) return;

  el.welcomeScreen.style.display = 'none';

  const userMsg = {
    role: 'user',
    content: text,
    attachments: attachedFiles.map(f => ({ ...f })),
    timestamp: Date.now(),
  };
  conv.messages.push(userMsg);

  if (conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = text.slice(0, 30) || (attachedFiles.length > 0 ? '文件对话' : '新对话');
  }

  appendMessageDOM(userMsg);
  updateContextStat(conv);
  scrollToBottom();

  el.userInput.value = '';
  el.userInput.style.height = 'auto';
  el.charCount.textContent = '0 字';
  attachedFiles = [];
  renderAttachmentPreview();

  await generateResponse(conv, text);
}

// ─── 停止生成 ─────────────────────────────────────────────
function stopGeneration() {
  if (abortController) abortController.abort();
}

// ─── 生成 AI 回复 ─────────────────────────────────────────
function getChatMode() {
  const mode = String(config?.chatMode || 'normal').trim().toLowerCase();
  if (mode === 'coding' || mode === 'react') return mode;
  return 'normal';
}

function resolveRuntimeMode(userText) {
  const t = String(userText || '').trim();
  if (t.startsWith('/code')) return 'coding';
  return getChatMode();
}

function normalizeAgentPrompt(userText) {
  const t = String(userText || '').trim();
  if (t.startsWith('/code')) {
    return t.replace(/^\/code\s*/i, '').trim();
  }
  return t;
}

async function requestAgentChat(prompt, mode = 'coding') {
  const safeMode = ['normal', 'coding', 'react'].includes(String(mode || '')) ? String(mode) : 'coding';
  const autoRun = safeMode === 'coding';
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      mode: safeMode,
      autoRun,
      forceRun: true,
      persistActive: false,
    }),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // ignore json parse failure
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

async function agentCodeResponse(userText, assistantMsg, msgEl, startTime, conv, mode = 'coding') {
  const prompt = normalizeAgentPrompt(userText);
  if (!prompt) {
    throw new Error('请输入 /code 后面的编程需求');
  }

  const ret = await requestAgentChat(prompt, mode);
  const run = ret.run || {};
  const lines = [];
  lines.push(`AI ${ret.mode || getChatMode()} 模式任务已执行`);
  if (ret.notes) lines.push(`说明: ${ret.notes}`);
  if (run.started) lines.push(`运行已启动, jobId=${run.jobId || ''}`);
  else if (run.error) lines.push(`运行未启动: ${run.error}`);

  if (ret.code) {
    lines.push('生成代码如下:');
    lines.push('```python\n' + ret.code + '\n```');
    if (el.codeEditor) el.codeEditor.value = ret.code;
  } else {
    lines.push('本次未生成代码');
  }

  assistantMsg.content = lines.join('\n\n');
  assistantMsg.thinking = String(ret.thinking || '');

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const inTokens = Math.ceil(String(userText || '').length * 0.6);
  const outTokens = Math.ceil(assistantMsg.content.length * 0.5);
  const msgStats = {
    inputTokens: inTokens,
    outputTokens: outTokens,
    totalTokens: inTokens + outTokens,
    speed: Number(duration) > 0 ? (outTokens / Number(duration)).toFixed(1) : '0.0',
    duration,
  };
  assistantMsg.stats = msgStats;
  finishMessage(msgEl, assistantMsg, null, null, msgStats);

  if (typeof refreshCodeStatus === 'function') {
    refreshCodeStatus(true);
  }
  if (typeof startCodeStatusPolling === 'function') {
    startCodeStatusPolling();
  }
  if (typeof loadCodeHistoryList === 'function') {
    loadCodeHistoryList(true);
  }

  return msgStats;
}

async function generateResponse(conv, userText = '') {
  isGenerating = true;
  abortController = new AbortController();
  setSendBtnState('stop');
  const startTime = Date.now();

  const assistantMsg = {
    role: 'assistant',
    content: '',
    thinking: '',
    timestamp: Date.now(),
    tokens: null,
  };
  conv.messages.push(assistantMsg);

  const msgEl = createAssistantMessageEl(assistantMsg);
  el.messageList.appendChild(msgEl);
  scrollToBottom();

  const apiMessages = buildApiMessages(conv);
  let finalStats = null;

  try {
    const mode = resolveRuntimeMode(userText);
    if (mode === 'coding' || mode === 'react') {
      finalStats = await agentCodeResponse(userText, assistantMsg, msgEl, startTime, conv, mode);
    } else if (config.stream) {
      finalStats = await streamResponse(apiMessages, assistantMsg, msgEl, startTime, conv);
    } else {
      finalStats = await normalResponse(apiMessages, assistantMsg, msgEl, startTime, conv);
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      finishMessage(msgEl, assistantMsg, '[已停止]');
    } else {
      finishMessage(msgEl, assistantMsg, null, e.message);
    }
  } finally {
    isGenerating = false;
    abortController = null;
    setSendBtnState('send');
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 如果 streamResponse/normalResponse 没有返回统计（异常情况），用估算兜底
    if (!finalStats) {
      const currentConv = getCurrentConv();
      let inputChars = 0;
      if (currentConv) {
        currentConv.messages.forEach(m => {
          if (m.role === 'user' && m.content) inputChars += m.content.length;
        });
      }
      if (config.systemPrompt) inputChars += config.systemPrompt.length;
      const estimatedInput = Math.ceil(inputChars * 0.6);
      const estimatedOutput = Math.ceil((assistantMsg.content || '').length * 0.5);
      finalStats = {
        inputTokens: estimatedInput,
        outputTokens: estimatedOutput,
        totalTokens: estimatedInput + estimatedOutput,
        speed: duration > 0 && estimatedOutput > 0 ? (estimatedOutput / parseFloat(duration)).toFixed(1) : '0.0',
        duration: duration
      };
    }

    // 确保时长是最新的
    finalStats.duration = duration;

    // 更新消息内的统计（始终更新，确保最终数据正确）
    updateMessageStats(msgEl, finalStats);

    // 保存统计到消息
    assistantMsg.stats = finalStats;

    // 顶部统计显示当前会话累计 token 与上下文长度
    refreshConversationStats(conv);
    updateContextStat(conv);

    saveConversations();
    renderHistoryList();
  }
}

// ─── 构建 API 请求消息 ────────────────────────────────────
function buildApiMessages(conv) {
  const messages = [];

  if (config.systemPrompt) {
    messages.push({ role: 'system', content: config.systemPrompt });
  }

  const history = conv.messages.slice(0, -1);
  history.forEach(m => {
    if (m.role === 'user') {
      const attachments = m.attachments || [];

      // 如果有附件（图片或文件）
      if (attachments.length > 0) {
        const parts = [];
        if (m.content) parts.push({ type: 'text', text: m.content });
        attachments.forEach(att => {
          if (att.type === 'image') {
            // 图片：以 image_url 格式发送
            parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
          } else {
            // 非图片文件：转为文本内容发送（部分 API 支持 tool_use / file 格式）
            // 通用方案：将文件信息作为文本附在消息中
            parts.push({
              type: 'text',
              text: `[附件: ${att.name} (${formatFileSize(att.size)})]`
            });
          }
        });
        messages.push({ role: 'user', content: parts });
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant' && m.content) {
      messages.push({ role: 'assistant', content: m.content });
    }
  });

  return messages;
}

// ─── 流式响应 ─────────────────────────────────────────────
async function streamResponse(messages, assistantMsg, msgEl, startTime, conv) {
  const payload = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: true,
  };

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    let errMsg = `HTTP ${res.status}`;
    try { errMsg = JSON.parse(errBody).error?.message || errMsg; } catch(e) {}
    throw new Error(errMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  let fullThinking = '';
  let latestUsage = null;

  const loadingEl = msgEl.querySelector('.loading-dots');
  const contentEl = msgEl.querySelector('.message-content');

  if (loadingEl) loadingEl.remove();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        const delta = choice?.delta || {};
        const message = choice?.message || {};
        const usage = json.usage;

        // 调试：打印收到的数据结构
        console.log('Stream chunk:', { delta, message, usage });

        // 思考内容 - 支持多种字段名
        const thinkingDelta = delta.reasoning_content || delta.thinking || 
                              message.reasoning_content || message.thinking || '';
        if (thinkingDelta) {
          fullThinking += thinkingDelta;
          const tb = msgEl.querySelector('.thinking-block');
          const tc = msgEl.querySelector('.thinking-content');
          const th = msgEl.querySelector('.thinking-header');
          const tt = msgEl.querySelector('.thinking-title');
          if (tb) {
            tb.style.display = 'block';
            if (tc) {
              tc.classList.add('open');
              tc.textContent = fullThinking;
              tc.scrollTop = tc.scrollHeight;
            }
            if (th) th.classList.add('open');
            if (tt) tt.textContent = `思考中…（${fullThinking.length} 字）`;
          }
        }

        // 正文
        const contentDelta = delta.content || message.content || '';
        if (contentDelta) {
          fullContent += contentDelta;
          contentEl.innerHTML = renderMarkdown(fullContent) + '<span class="cursor"></span>';
          hljs.highlightAll();
          scrollToBottom();
        }

        if (usage) {
          const parsed = parseUsage(usage);
          if (parsed.totalTokens > 0 || parsed.inputTokens > 0 || parsed.outputTokens > 0) {
            latestUsage = parsed;
            updateMessageStats(msgEl, parsed);
          }
        }
      } catch(e) {
        console.error('Parse error:', e);
      }
    }
  }

  // 流式结束：显示思考过程
  if (fullThinking && fullThinking.length > 0) {
    const tb = msgEl.querySelector('.thinking-block');
    const tc = msgEl.querySelector('.thinking-content');
    const td = msgEl.querySelector('.thinking-dot');
    const tt = msgEl.querySelector('.thinking-title');
    if (tb) tb.style.display = 'block';
    if (tc) {
      tc.classList.add('open');
      tc.textContent = fullThinking;
    }
    if (td) td.classList.add('done');
    if (tt) tt.textContent = `思考过程（${fullThinking.length} 字）`;
  } else {
    // 没有思考内容，隐藏思考块
    const tb = msgEl.querySelector('.thinking-block');
    if (tb) tb.style.display = 'none';
  }

  assistantMsg.content = fullContent;
  assistantMsg.thinking = fullThinking;
  contentEl.innerHTML = renderMarkdown(fullContent);
  addCodeCopyBtns(contentEl);
  hljs.highlightAll();
  scrollToBottom();

  // 流式结束时的统计
  const elapsed = (Date.now() - startTime) / 1000;

  // 估算输入 token：用户消息字数（粗略估算，中文约1字≈1token，英文约4字符≈1token）
  const currentConv = getCurrentConv();
  let inputChars = 0;
  if (currentConv) {
    currentConv.messages.forEach(m => {
      if (m.role === 'user' && m.content) inputChars += m.content.length;
    });
  }
  // 系统提示词也算入输入
  if (config.systemPrompt) inputChars += config.systemPrompt.length;
  const estimatedInputTokens = Math.ceil(inputChars * 0.6);

  // 输出 token 估算：基于内容字符长度（中文约1字≈1token，英文约4字符≈1token）
  const estimatedOutputTokens = Math.ceil(fullContent.length * 0.5);

  // 优先使用 API 返回的 usage，否则用估算
  const finalInputTokens = latestUsage ? latestUsage.inputTokens : estimatedInputTokens;
  const finalOutputTokens = latestUsage ? latestUsage.outputTokens : estimatedOutputTokens;
  const finalTotalTokens = latestUsage ? latestUsage.totalTokens : (finalInputTokens + finalOutputTokens);

  const s = {
    inputTokens: finalInputTokens,
    outputTokens: finalOutputTokens,
    totalTokens: finalTotalTokens,
    speed: elapsed > 0 && finalOutputTokens > 0 ? (finalOutputTokens / elapsed).toFixed(1) : '0.0',
    duration: elapsed.toFixed(1)
  };
  updateMessageStats(msgEl, s);

  // 返回统计信息给 generateResponse
  return s;
}

// ─── 普通响应（非流式）────────────────────────────────────
async function normalResponse(messages, assistantMsg, msgEl, startTime, conv) {
  const payload = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  };

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    let errMsg = `HTTP ${res.status}`;
    try { errMsg = JSON.parse(errBody).error?.message || errMsg; } catch(e) {}
    throw new Error(errMsg);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content || '';
  const thinking = choice?.message?.reasoning_content || choice?.message?.thinking || '';
  const usage = data.usage || {};

  assistantMsg.content = content;
  assistantMsg.thinking = thinking;

  // 计算统计
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const hasUsage = usage.prompt_tokens || usage.completion_tokens || usage.total_tokens;
  
  // 估算输入 token
  let inputChars = 0;
  if (conv) {
    conv.messages.forEach(m => {
      if (m.role === 'user' && m.content) inputChars += m.content.length;
    });
  }
  if (config.systemPrompt) inputChars += config.systemPrompt.length;
  const estimatedInput = Math.ceil(inputChars * 0.6);
  const estimatedOutput = Math.ceil(content.length * 0.5);
  
  const parsedUsage = parseUsage(usage);
  const outputTokens = hasUsage ? parsedUsage.outputTokens : estimatedOutput;
  const inputTokens = hasUsage ? parsedUsage.inputTokens : estimatedInput;
  const totalTokens = hasUsage ? parsedUsage.totalTokens : (inputTokens + outputTokens);

  const msgStats = {
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    totalTokens: totalTokens,
    speed: duration > 0 && outputTokens > 0 ? (outputTokens / parseFloat(duration)).toFixed(1) : '0.0',
    duration: duration
  };

  assistantMsg.stats = msgStats;
  finishMessage(msgEl, assistantMsg, null, null, msgStats);

  // 返回统计信息给 generateResponse
  return msgStats;
}

// ─── 构建 headers ─────────────────────────────────────────
function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };

  if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  return headers;
}

// ─── DOM：渲染消息 ────────────────────────────────────────
function appendMessageDOM(msg) {
  const msgEl = createMessageEl(msg);
  el.messageList.appendChild(msgEl);
  return msgEl;
}

function createMessageEl(msg) {
  if (msg.role === 'user') return createUserMessageEl(msg);
  else return createAssistantMessageEl(msg);
}

function createUserMessageEl(msg) {
  const div = document.createElement('div');
  div.className = 'message user';

  const attachments = msg.attachments || [];
  let attachmentHTML = '';

  if (attachments.length > 0) {
    const items = attachments.map(att => {
      if (att.type === 'image') {
        return `<img class="message-image" src="${att.dataUrl}" onclick="openImageModal('${att.dataUrl}')" alt="${escapeHtml(att.name)}" />`;
      } else {
        const ext = att.name.split('.').pop().toUpperCase().slice(0, 4);
        return `
          <div class="message-file-card" onclick="openImageModal('${att.dataUrl}')">
            <div class="file-icon-sm">${ext}</div>
            <div class="file-info-sm">
              <span class="file-name-sm">${escapeHtml(att.name)}</span>
              <span class="file-size-sm">${formatFileSize(att.size)}</span>
            </div>
          </div>`;
      }
    }).join('');
    attachmentHTML = `<div style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;">${items}</div>`;
  }

  div.innerHTML = `
    <div class="avatar">👤</div>
    <div class="message-body">
      <div class="message-meta">
        <span class="message-role">你</span>
        <span>${formatTime(msg.timestamp)}</span>
      </div>
      ${attachmentHTML}
      <div class="message-content">${escapeHtml(msg.content)}</div>
      <div class="message-toolbar">
        <button class="toolbar-btn" onclick="copyText(this, ${JSON.stringify(msg.content)})">复制</button>
      </div>
    </div>
  `;
  return div;
}

function createAssistantMessageEl(msg) {
  const div = document.createElement('div');
  div.className = 'message assistant';

  const hasThinking = msg.thinking && msg.thinking.length > 0;
  const hasContent = msg.content && msg.content.length > 0;

  // 思考过程块 - 新建消息时默认显示（用于流式接收思考内容）
  const thinkingHTML = `
    <div class="thinking-block" style="display:block">
      <div class="thinking-header" onclick="toggleThinking(this)">
        <div class="thinking-dot"></div>
        <span class="thinking-title">思考中…</span>
        <span class="thinking-toggle">▼</span>
      </div>
      <div class="thinking-content"></div>
    </div>
  `;

  const contentHTML = hasContent
    ? renderMarkdown(msg.content)
    : '<div class="loading-dots"><span></span><span></span><span></span></div>';

  // Token 统计（初始为空，流式/完成时更新）
  const statsHTML = `
    <div class="message-stats" style="display:none">
      <span class="stat-item-mini">输入 <b class="msg-stat-in">—</b></span>
      <span class="stat-sep-mini">·</span>
      <span class="stat-item-mini">输出 <b class="msg-stat-out">—</b></span>
      <span class="stat-sep-mini">·</span>
      <span class="stat-item-mini">总计 <b class="msg-stat-total">—</b></span>
      <span class="stat-sep-mini">·</span>
      <span class="stat-item-mini">速度 <b class="msg-stat-speed">—</b></span>
      <span class="stat-sep-mini">·</span>
      <span class="stat-item-mini">耗时 <b class="msg-stat-time">—</b></span>
    </div>
  `;

  div.innerHTML = `
    <div class="avatar">✦</div>
    <div class="message-body">
      <div class="message-meta">
        <span class="message-role">${escapeHtml(config.model || 'AI')}</span>
        <span>${formatTime(msg.timestamp)}</span>
      </div>
      ${thinkingHTML}
      <div class="message-content">${contentHTML}</div>
      ${statsHTML}
      <div class="message-toolbar">
        <button class="toolbar-btn" onclick="copyMsgContent(this)">复制</button>
        <button class="toolbar-btn" onclick="copyRaw(this)">复制原文</button>
      </div>
    </div>
  `;

  if (hasContent) {
    const contentEl = div.querySelector('.message-content');
    addCodeCopyBtns(contentEl);
    setTimeout(() => hljs.highlightAll(), 0);
  }

  return div;
}

function finishMessage(msgEl, assistantMsg, note, errMsg, msgStats) {
  const contentEl = msgEl.querySelector('.message-content');
  if (errMsg) {
    contentEl.innerHTML = `<div class="error-message">❌ ${escapeHtml(errMsg)}</div>`;
  } else if (note) {
    contentEl.innerHTML = `<span style="color:var(--text3)">${escapeHtml(note)}</span>`;
  } else {
    contentEl.innerHTML = renderMarkdown(assistantMsg.content || '');
    addCodeCopyBtns(contentEl);
    setTimeout(() => hljs.highlightAll(), 0);
  }

  // 思考过程 - 有内容则显示，无内容则隐藏
  const thinkingBlock   = msgEl.querySelector('.thinking-block');
  const thinkingContent = msgEl.querySelector('.thinking-content');
  const thinkingDot     = msgEl.querySelector('.thinking-dot');
  const thinkingTitle   = msgEl.querySelector('.thinking-title');

  if (assistantMsg.thinking && assistantMsg.thinking.length > 0) {
    if (thinkingBlock)   thinkingBlock.style.display = 'block';
    if (thinkingContent) thinkingContent.textContent = assistantMsg.thinking;
    if (thinkingDot)     thinkingDot.classList.add('done');
    if (thinkingTitle)   thinkingTitle.textContent = `思考过程（${assistantMsg.thinking.length} 字）`;
  } else {
    // 没有思考内容，隐藏思考块
    if (thinkingBlock) thinkingBlock.style.display = 'none';
  }

  // Token 统计显示在消息下方
  const statsEl = msgEl.querySelector('.message-stats');
  if (statsEl && msgStats) {
    updateMessageStats(msgEl, msgStats);
  }
}

// 更新消息内的 token 统计（流式过程中）
function updateMessageStats(msgEl, { inputTokens, outputTokens, totalTokens, speed, duration }) {
  const statsEl = msgEl.querySelector('.message-stats');
  if (!statsEl) return;
  statsEl.style.display = 'flex';

  const inEl = statsEl.querySelector('.msg-stat-in');
  const outEl = statsEl.querySelector('.msg-stat-out');
  const totalEl = statsEl.querySelector('.msg-stat-total');
  const speedEl = statsEl.querySelector('.msg-stat-speed');
  const timeEl = statsEl.querySelector('.msg-stat-time');

  if (inEl) inEl.textContent = formatTokens(inputTokens);
  if (outEl) outEl.textContent = formatTokens(outputTokens);
  if (totalEl) totalEl.textContent = formatTokens(totalTokens);
  if (speedEl) speedEl.textContent = formatSpeed(speed);
  if (timeEl) timeEl.textContent = formatDuration(duration);
}

function formatTokens(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString()} tokens`;
}

function formatSpeed(value) {
  if (value === undefined || value === null || value === '') return '—';
  return `${value} tok/s`;
}

function formatDuration(value) {
  if (value === undefined || value === null || value === '') return '—';
  return `${value}s`;
}

// ─── 代码块复制按钮 ───────────────────────────────────────
function addCodeCopyBtns(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-block-header')) return;
    const code = pre.querySelector('code');
    const lang = (code?.className || '').replace('language-', '') || 'code';
    const normalized = String(lang).toLowerCase();
    const runnable = normalized === 'python' || normalized === 'py' || normalized === 'micropython';
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const runBtn = runnable
      ? '<button class="copy-code-btn run-code-btn" onclick="runCodeSnippetFromBlock(this)">运行</button>'
      : '';
    header.innerHTML = `
      <span>${lang}</span>
      <div class="code-block-actions">
        ${runBtn}
        <button class="copy-code-btn" onclick="copyCode(this)">复制代码</button>
      </div>
    `;
    pre.insertBefore(header, pre.firstChild);
  });
}

async function runCodeSnippetFromBlock(btn) {
  try {
    const code = btn.closest('pre')?.querySelector('code')?.innerText || '';
    const text = String(code || '').trim();
    if (!text) {
      showToast('代码块为空，无法运行');
      return;
    }
    if (typeof runCodeSnippet !== 'function') {
      showToast('运行功能未就绪');
      return;
    }
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '运行中...';
    await runCodeSnippet(text, 'chat_block');
    btn.textContent = '已运行';
    setTimeout(() => {
      btn.textContent = oldText;
      btn.disabled = false;
    }, 1000);
  } catch (e) {
    showToast('运行代码块失败: ' + e.message);
    btn.disabled = false;
    btn.textContent = '运行';
  }
}

// ─── 思考过程折叠 ─────────────────────────────────────────
function toggleThinking(header) {
  const content = header.nextElementSibling;
  const isOpen = content.classList.contains('open');
  if (isOpen) {
    content.classList.remove('open');
    header.classList.remove('open');
  } else {
    content.classList.add('open');
    header.classList.add('open');
  }
}

// ─── 统计管理 ─────────────────────────────────────────────
function resetStats() {
  el.statIn.textContent    = '—';
  el.statOut.textContent   = '—';
  el.statTotal.textContent = '—';
  el.statContext.textContent = '—';
}

function updateStats({ inputTokens, outputTokens, totalTokens }) {
  if (inputTokens !== undefined)  el.statIn.textContent    = inputTokens.toLocaleString();
  if (outputTokens !== undefined) el.statOut.textContent   = outputTokens.toLocaleString();
  if (totalTokens !== undefined)  el.statTotal.textContent = totalTokens.toLocaleString();
  else if (inputTokens !== undefined && outputTokens !== undefined)
    el.statTotal.textContent = (inputTokens + outputTokens).toLocaleString();
}

function parseUsage(usage = {}) {
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || (inputTokens + outputTokens));
  return { inputTokens, outputTokens, totalTokens };
}

function refreshConversationStats(conv = getCurrentConv()) {
  if (!conv) {
    resetStats();
    return;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  conv.messages.forEach(m => {
    if (m.role !== 'assistant' || !m.stats) return;
    inputTokens += Number(m.stats.inputTokens || 0);
    outputTokens += Number(m.stats.outputTokens || 0);
    totalTokens += Number(m.stats.totalTokens || 0);
  });

  if (totalTokens === 0) totalTokens = inputTokens + outputTokens;
  updateStats({ inputTokens, outputTokens, totalTokens });
}

function estimateContextTokens(conv = getCurrentConv()) {
  if (!conv) return 0;
  let chars = config.systemPrompt ? config.systemPrompt.length : 0;

  conv.messages.forEach(m => {
    if (typeof m.content === 'string') chars += m.content.length;
  });

  return Math.ceil(chars * 0.6);
}

function updateContextStat(conv = getCurrentConv()) {
  const used = estimateContextTokens(conv);
  const max = Number(config.maxTokens || 0);
  el.statContext.textContent = max > 0
    ? `${used.toLocaleString()} / ${max.toLocaleString()}`
    : used.toLocaleString();
}

function updateDeviceStatus() {
  if (!el.statDevice) return;
  if (deviceStatus.connected) {
    const ipText = deviceStatus.ip && deviceStatus.ip !== '0.0.0.0' ? ` (${deviceStatus.ip})` : '';
    el.statDevice.textContent = `在线${ipText}`;
    el.statDevice.classList.add('ok');
    el.statDevice.classList.remove('err');
    return;
  }

  el.statDevice.textContent = '离线';
  el.statDevice.classList.add('err');
  el.statDevice.classList.remove('ok');
}
