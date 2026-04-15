// ─── 工具函数 ─────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  try {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  } catch(e) {
    return escapeHtml(text);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
}

function setSendBtnState(state) {
  if (state === 'stop') {
    el.sendBtn.classList.add('stop');
    el.sendBtn.title = '停止生成';
    el.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  } else {
    el.sendBtn.classList.remove('stop');
    el.sendBtn.title = '发送';
    el.sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
  }
}
