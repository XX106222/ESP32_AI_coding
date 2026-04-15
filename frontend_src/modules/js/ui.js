// ─── 复制功能 ─────────────────────────────────────────────
async function copyText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => btn.textContent = orig, 1500);
  } catch(e) { showToast('复制失败'); }
}

function copyMsgContent(btn) {
  const content = btn.closest('.message-body').querySelector('.message-content');
  copyText(btn, content.innerText);
}

function copyRaw(btn) {
  const conv = getCurrentConv();
  if (!conv) return;
  const idx = Array.from(el.messageList.children).indexOf(btn.closest('.message'));
  const msg = conv.messages[idx];
  const fallback = btn.closest('.message-body').querySelector('.message-content').innerText;
  copyText(btn, msg?.content || fallback);
}

function copyCode(btn) {
  const code = btn.closest('pre')?.querySelector('code');
  copyText(btn, code?.innerText || '');
}

// ─── 清空 / 导出 ──────────────────────────────────────────
function clearCurrentChat() {
  const conv = getCurrentConv();
  if (!conv) return;
  if (!confirm('确认清空当前对话？')) return;
  conv.messages = [];
  conv.title = '新对话';
  el.messageList.innerHTML = '';
  el.welcomeScreen.style.display = 'flex';
  resetStats();
  updateContextStat(conv);
  saveConversations();
  renderHistoryList();
}

function exportChat() {
  const conv = getCurrentConv();
  if (!conv || conv.messages.length === 0) { showToast('没有可导出的对话'); return; }

  let md = `# ${conv.title}\n\n`;
  conv.messages.forEach(m => {
    const role = m.role === 'user' ? '**你**' : `**${config.model || 'AI'}**`;
    md += `### ${role}\n${m.content}\n\n`;
    if (m.thinking) md += `> 思考过程：${m.thinking.slice(0, 200)}…\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.title || 'chat'}_${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('对话已导出');
}

// ─── 图片模态框 ───────────────────────────────────────────
function openImageModal(src) {
  el.modalImg.src = src;
  el.imageModal.classList.remove('hidden');
}

function closeModal() {
  el.imageModal.classList.add('hidden');
  el.modalImg.src = '';
}

// ─── Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2500) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), duration);
}

// ─── Bootstrap ────────────────────────────────────────────
init().catch(e => {
  console.error('Init failed:', e);
  showToast('初始化失败，请刷新页面重试');
});
