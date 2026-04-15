// Loads split HTML shell first, then loads runtime scripts in order.
(function () {
  const SHELL_PATH = 'frontend_src/modules/html/app_shell.html';
  const SCRIPT_CHAIN = [
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
    'frontend_src/modules/js/core.js',
    'frontend_src/modules/js/chat.js',
    'frontend_src/modules/js/device.js',
    'frontend_src/modules/js/code.js',
    'frontend_src/modules/js/ui.js',
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.body.appendChild(s);
    });
  }

  async function boot() {
    try {
      const res = await fetch(SHELL_PATH, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      document.body.innerHTML = html;

      for (const src of SCRIPT_CHAIN) {
        await loadScript(src);
      }
    } catch (e) {
      document.body.innerHTML = '<pre style="padding:12px;color:#f87171">页面加载失败: ' + String(e && e.message ? e.message : e) + '</pre>';
      console.error('bootstrap failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

