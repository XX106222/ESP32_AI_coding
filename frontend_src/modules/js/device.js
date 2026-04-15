// ─── 设备管理函数 ─────────────────────────────────────────────
var codeHistoryItems = [];
var selectedCodeHistoryVersion = '';
var selectedCodeHistoryCode = '';
var codeRunTransitioning = false;
var codeSwitchSaving = false;

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setCodeRunButtonsState(running, switching = false) {
  const isRunning = !!running;
  const isSwitching = !!switching;

  if (el.codeRunBtn) {
    // 运行中: 运行按钮填充；非运行: 运行按钮描边。
    el.codeRunBtn.classList.toggle('code-btn-filled', isRunning && !isSwitching);
    el.codeRunBtn.classList.toggle('code-btn-outline', !isRunning || isSwitching);
    // 运行中允许再次点击覆盖运行；仅在切换中禁用防抖。
    el.codeRunBtn.disabled = isSwitching;
  }

  if (el.codeStopBtn) {
    // 停止按钮保持描边，避免与“运行中填充”语义冲突。
    el.codeStopBtn.classList.remove('code-btn-filled');
    el.codeStopBtn.classList.add('code-btn-outline');
    el.codeStopBtn.disabled = isSwitching || !isRunning;
  }

  if (el.codePersistBtn) {
    el.codePersistBtn.disabled = isSwitching || isRunning;
  }
}

async function waitUntilCodeStopped(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await apiGet('/code/status');
    if (!status?.running) return status;
    await sleepMs(250);
  }
  throw new Error('stop timeout');
}

function formatHistoryTime(ts) {
  const n = Number(ts || 0);
  if (!n) return '—';
  const d = new Date(n * 1000);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function renderCodeHistoryList(activeVersion = '') {
  if (!el.codeHistoryList) return;
  if (!Array.isArray(codeHistoryItems) || codeHistoryItems.length === 0) {
    el.codeHistoryList.textContent = '暂无历史版本';
    return;
  }

  el.codeHistoryList.innerHTML = codeHistoryItems.map(item => {
    const version = String(item?.version || '');
    const savedAt = formatHistoryTime(item?.savedAt);
    const note = String(item?.note || '').trim();
    const active = activeVersion && activeVersion === version;
    const selected = selectedCodeHistoryVersion && selectedCodeHistoryVersion === version;
    const badge = active ? '<span class="code-history-badge">当前</span>' : '';
    const noteText = note ? ` · ${escapeHtml(note)}` : '';
    const cls = `code-history-item${selected ? ' selected' : ''}`;
    const deleteDisabled = active ? 'disabled title="当前固化版本不可删除"' : 'title="删除该历史版本"';
    return `<div class="code-history-row"><button class="${cls}" data-action="view" data-version="${escapeHtml(version)}"><b class="code-history-item-title">版本 v${escapeHtml(version)} ${badge}</b><span class="code-history-item-meta">${savedAt}${noteText}</span></button><button class="code-history-delete" data-action="delete" data-version="${escapeHtml(version)}" ${deleteDisabled}>删除</button></div>`;
  }).join('');
}

function renderCodeHistoryPreview(meta, code) {
  if (el.codeHistoryMeta) {
    if (!meta) {
      el.codeHistoryMeta.textContent = '—';
    } else {
      const note = String(meta.note || '').trim();
      const base = `版本 v${meta.version || '—'} · 保存于 ${formatHistoryTime(meta.savedAt)}`;
      el.codeHistoryMeta.textContent = note ? `${base} · 备注: ${note}` : base;
    }
  }
  if (el.codeHistoryPreview) {
    el.codeHistoryPreview.textContent = code || '—';
  }
}

async function viewCodeHistoryVersion(version, silent = false) {
  if (!version) return;
  try {
    const data = await apiGet(`/code/history?version=${encodeURIComponent(version)}`);
    selectedCodeHistoryVersion = String(data?.version || version);
    selectedCodeHistoryCode = String(data?.code || '');
    renderCodeHistoryPreview(data?.meta || null, selectedCodeHistoryCode);
    const status = await apiGet('/code/status');
    renderCodeHistoryList(status?.meta?.activeVersion || '');
  } catch (e) {
    if (!silent) showToast('读取历史版本失败: ' + e.message);
  }
}

async function loadCodeHistoryList(silent = false) {
  try {
    const listRes = await apiGet('/code/history');
    codeHistoryItems = Array.isArray(listRes?.items) ? listRes.items : [];
    const status = await apiGet('/code/status');
    const activeVersion = status?.meta?.activeVersion || '';
    renderCodeHistoryList(activeVersion);

    const hasSelected = codeHistoryItems.some(it => String(it?.version || '') === selectedCodeHistoryVersion);
    if (!hasSelected) {
      selectedCodeHistoryVersion = codeHistoryItems[0]?.version ? String(codeHistoryItems[0].version) : '';
    }

    if (selectedCodeHistoryVersion) {
      await viewCodeHistoryVersion(selectedCodeHistoryVersion, true);
    } else {
      selectedCodeHistoryCode = '';
      renderCodeHistoryPreview(null, '');
    }
    if (!silent) showToast('已加载代码历史');
  } catch (e) {
    if (!silent) showToast('加载代码历史失败: ' + e.message);
  }
}

async function restoreSelectedHistoryToDraft() {
  if (!selectedCodeHistoryVersion) {
    showToast('请先选择一个历史版本');
    return false;
  }
  if (!selectedCodeHistoryCode) {
    await viewCodeHistoryVersion(selectedCodeHistoryVersion, true);
  }
  try {
    await apiPost('/code/draft', { code: selectedCodeHistoryCode || '' });
    if (el.codeEditor) el.codeEditor.value = selectedCodeHistoryCode || '';
    showToast(`已恢复 v${selectedCodeHistoryVersion} 到草稿`);
    return true;
  } catch (e) {
    showToast('恢复历史到草稿失败: ' + e.message);
    return false;
  }
}

async function persistSelectedHistoryVersion() {
  if (!selectedCodeHistoryVersion) {
    showToast('请先选择一个历史版本');
    return;
  }
  const ok = await restoreSelectedHistoryToDraft();
  if (!ok) return;
  try {
    const note = `checkout history v${selectedCodeHistoryVersion}`;
    const res = await apiPost('/code/persist', { note });
    showToast('已设为当前固化: v' + (res?.version || ''));
    refreshCodeStatus(true);
    loadCodeHistoryList(true);
  } catch (e) {
    showToast('设为当前固化失败: ' + e.message);
  }
}

async function deleteCodeHistoryVersion(version) {
  const v = String(version || '').trim();
  if (!v) return;
  if (!confirm(`确认删除版本 v${v} ?`)) return;

  try {
    await apiPost('/code/history/delete', { version: v });
    if (selectedCodeHistoryVersion === v) {
      selectedCodeHistoryVersion = '';
      selectedCodeHistoryCode = '';
    }
    showToast(`已删除历史版本 v${v}`);
    await loadCodeHistoryList(true);
  } catch (e) {
    showToast('删除历史版本失败: ' + e.message);
  }
}

async function loadDeviceStatus() {
  try {
    // 加载系统信息
    const sysInfo = await apiGet('/device/system-info');
    if (sysInfo) {
      const memPercent = sysInfo.memory_usage_percent || 0;
      el.memoryProgress.style.width = memPercent + '%';
      el.memoryValue.textContent = `${sysInfo.memory_alloc_bytes} / ${sysInfo.memory_total_bytes} bytes (${memPercent}%)`;
    }

    await loadBoardLedStatus();

    // 加载 GPIO 状态
    const gpioStatus = await apiGet('/device/gpio-status');
    if (gpioStatus) {
      renderGpioList(gpioStatus);
      updateServoPortOptions(gpioStatus);
    }

    // 加载舵机列表
    const servoList = await apiGet('/device/servo-list');
    if (servoList && Array.isArray(servoList)) {
      renderServoList(servoList);
    }
  } catch (e) {
    console.error('Load device status failed:', e);
  }
}

async function loadBoardLedStatus() {
  if (!el.boardLedStatus) return;
  try {
    const data = await apiGet('/device/board-led');
    if (!data?.supported) {
      el.boardLedStatus.textContent = '板载 LED 不可用';
      if (el.boardLedOnBtn) el.boardLedOnBtn.disabled = true;
      if (el.boardLedOffBtn) el.boardLedOffBtn.disabled = true;
      if (el.boardLedColor) el.boardLedColor.disabled = true;
      return;
    }

    if (el.boardLedOnBtn) el.boardLedOnBtn.disabled = false;
    if (el.boardLedOffBtn) el.boardLedOffBtn.disabled = false;
    if (el.boardLedColor) {
      el.boardLedColor.disabled = false;
      el.boardLedColor.value = rgbToHex(data.state?.r || 0, data.state?.g || 0, data.state?.b || 0);
    }
    if (el.boardLedMode) {
      el.boardLedMode.value = data.mode || 'static';
    }
    el.boardLedStatus.textContent = data.state?.on
      ? `GPIO${data.pin} 亮 (${data.state.r}, ${data.state.g}, ${data.state.b})`
      : `GPIO${data.pin} 灭`;
  } catch (e) {
    el.boardLedStatus.textContent = '板载 LED 状态读取失败';
  }
}

async function setBoardLed(on) {
  try {
    const rgb = hexToRgb(el.boardLedColor?.value || '#00ff00');
    const mode = el.boardLedMode?.value || 'static';
    let interval_ms = 120;
    if (mode === 'blink_fast') interval_ms = 120;
    if (mode === 'blink_slow') interval_ms = 500;
    if (mode === 'breath') interval_ms = 60;
    if (mode === 'multi_flash') interval_ms = 180;
    await apiPost('/device/board-led', {
      on,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      mode,
      interval_ms,
    });
    await loadBoardLedStatus();
  } catch (e) {
    showToast('板载 LED 控制失败: ' + e.message);
  }
}

function updateServoModeForm() {
  if (!el.servoMode || !el.servoContinuousCfg) return;
  const isContinuous = el.servoMode.value === 'continuous';
  el.servoContinuousCfg.style.display = isContinuous ? 'flex' : 'none';
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return { r: 0, g: 255, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const rr = Number(r).toString(16).padStart(2, '0');
  const gg = Number(g).toString(16).padStart(2, '0');
  const bb = Number(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

function renderGpioList(gpioStatus) {
  el.gpioList.innerHTML = '';
  Object.values(gpioStatus).forEach(gpio => {
    const item = document.createElement('div');
    item.className = `gpio-item ${gpio.status}`;
    const statusText = {
      'reserved': '系统保留',
      'active': '已占用',
      'available': '可用'
    }[gpio.status] || '—';

    item.innerHTML = `
      <div class="gpio-pin">GPIO ${gpio.pin}</div>
      <div class="gpio-status ${gpio.status}">${statusText}</div>
      <div style="font-size:0.7rem;color:var(--text3);margin-top:2px">电平: ${gpio.level ?? '—'}</div>
      ${gpio.usage ? `<div style="font-size:0.7rem;color:var(--text3);margin-top:2px">用途: ${gpio.usage}</div>` : ''}
      <div class="gpio-card-actions">
        <button class="gpio-mini-btn" data-action="high" data-pin="${gpio.pin}" ${gpio.status !== 'available' && gpio.usage !== 'gpio_out' ? 'disabled' : ''}>高</button>
        <button class="gpio-mini-btn" data-action="low" data-pin="${gpio.pin}" ${gpio.status !== 'available' && gpio.usage !== 'gpio_out' ? 'disabled' : ''}>低</button>
        <button class="gpio-mini-btn" data-action="read" data-pin="${gpio.pin}" ${gpio.status === 'reserved' ? 'disabled' : ''}>读</button>
        <button class="gpio-mini-btn" data-action="release" data-pin="${gpio.pin}" ${gpio.usage !== 'gpio_out' ? 'disabled' : ''}>释放</button>
      </div>
    `;
    el.gpioList.appendChild(item);
  });
}

function updateServoPortOptions(gpioStatus) {
  el.servoPin.innerHTML = '<option value="">-- 选择可用端口 --</option>';
  if (el.gpioWritePin) el.gpioWritePin.innerHTML = '<option value="">写入端口</option>';
  if (el.gpioReadPin) el.gpioReadPin.innerHTML = '<option value="">读取端口</option>';

  Object.values(gpioStatus).forEach(gpio => {
    if (gpio.status === 'available') {
      const opt = document.createElement('option');
      opt.value = gpio.pin;
      opt.textContent = `GPIO ${gpio.pin}`;
      el.servoPin.appendChild(opt);

      if (el.gpioWritePin) {
        const w = opt.cloneNode(true);
        el.gpioWritePin.appendChild(w);
      }
      if (el.gpioReadPin) {
        const r = opt.cloneNode(true);
        el.gpioReadPin.appendChild(r);
      }
    }

    if (gpio.usage === 'gpio_out') {
      if (el.gpioWritePin) {
        const w = document.createElement('option');
        w.value = gpio.pin;
        w.textContent = `GPIO ${gpio.pin} (输出)`;
        el.gpioWritePin.appendChild(w);
      }
      if (el.gpioReadPin) {
        const r = document.createElement('option');
        r.value = gpio.pin;
        r.textContent = `GPIO ${gpio.pin} (输出)`;
        el.gpioReadPin.appendChild(r);
      }
    }
  });
}

function renderServoList(servos) {
  el.servoList.innerHTML = '';
  servos.forEach(servo => {
    const item = document.createElement('div');
    item.className = 'servo-item';
    const modeLabel = servo.mode === 'continuous' ? '连续旋转' : '角度';
    item.innerHTML = `
      <div class="servo-item-header">
        <span class="servo-pin-badge">GPIO ${servo.pin}</span>
        <span class="servo-actions">
          <span style="font-size:0.7rem;color:var(--text3)">${modeLabel} · ${servo.freq}Hz</span>
          <button class="servo-remove-btn" data-pin="${servo.pin}">删除</button>
        </span>
      </div>
      ${servo.mode === 'continuous'
        ? `<div class="servo-angle-control">
             <input type="range" class="servo-angle-slider" min="-100" max="100" value="${servo.speed ?? 0}"
                    oninput="updateServoSpeedLabel(this)" onchange="setServoSpeed(${servo.pin}, this.value, this)" />
             <span class="servo-angle-value">${servo.speed ?? 0}</span>
           </div>`
        : `<div class="servo-angle-control">
             <input type="range" class="servo-angle-slider" min="0" max="180" value="${servo.angle}"
                    oninput="updateServoAngleLabel(this)" onchange="setServoAngle(${servo.pin}, this.value, this)" />
             <span class="servo-angle-value">${servo.angle}°</span>
           </div>`}
    `;
    item.querySelector('.servo-remove-btn')?.addEventListener('click', () => removeServo(servo.pin));
    el.servoList.appendChild(item);
  });
}

async function configureServo() {
  const pin = el.servoPin.value;
  const freq = el.servoFreq.value;
  const minUs = el.servoMinUs.value;
  const maxUs = el.servoMaxUs.value;
  const mode = el.servoMode?.value || 'angle';
  const neutralUs = el.servoNeutralUs?.value || '1500';
  const spanUs = el.servoSpanUs?.value || '300';

  if (!pin) {
    showToast('请选择 GPIO 端口');
    return;
  }

  try {
    const res = await apiPost('/device/servo-config', {
      pin: parseInt(pin),
      freq: parseInt(freq),
      min_us: parseInt(minUs),
      max_us: parseInt(maxUs),
      mode,
      neutral_us: parseInt(neutralUs),
      span_us: parseInt(spanUs),
    });
    if (res) {
      showToast(`舵机已配置: GPIO ${pin}`);
      await loadDeviceStatus();
    }
  } catch (e) {
    showToast('舵机配置失败: ' + e.message);
  }
}

async function setServoAngle(pin, angle, sliderEl) {
  try {
    const res = await apiPost('/device/servo-angle', {
      pin: parseInt(pin),
      angle: parseFloat(angle),
    });
    if (res) {
      const valueEl = sliderEl?.parentElement?.querySelector('.servo-angle-value');
      if (valueEl) valueEl.textContent = angle + '°';
    }
  } catch (e) {
    showToast('舵机控制失败: ' + e.message);
  }
}

function updateServoAngleLabel(sliderEl) {
  const valueEl = sliderEl?.parentElement?.querySelector('.servo-angle-value');
  if (valueEl) valueEl.textContent = `${sliderEl.value}°`;
}

function updateServoSpeedLabel(sliderEl) {
  const valueEl = sliderEl?.parentElement?.querySelector('.servo-angle-value');
  if (valueEl) valueEl.textContent = `${sliderEl.value}`;
}

async function setServoSpeed(pin, speed, sliderEl) {
  try {
    const res = await apiPost('/device/servo-speed', {
      pin: parseInt(pin),
      speed: parseInt(speed),
    });
    const valueEl = sliderEl?.parentElement?.querySelector('.servo-angle-value');
    if (valueEl) valueEl.textContent = `${res.speed}`;
  } catch (e) {
    showToast('舵机速度控制失败: ' + e.message);
  }
}

async function removeServo(pin) {
  try {
    await apiPost('/device/servo-delete', { pin: parseInt(pin) });
    showToast(`已删除舵机 GPIO ${pin}`);
    await loadDeviceStatus();
  } catch (e) {
    showToast('删除舵机失败: ' + e.message);
  }
}

async function writeGpioValue() {
  const pin = el.gpioWritePin?.value;
  if (!pin) {
    showToast('请选择写入端口');
    return;
  }
  try {
    const res = await apiPost('/device/gpio-write', {
      pin: parseInt(pin),
      value: parseInt(el.gpioWriteValue?.value || '0'),
    });
    showToast(`GPIO ${res.pin} 写入 ${res.value}`);
    await loadDeviceStatus();
  } catch (e) {
    showToast('GPIO 写入失败: ' + e.message);
  }
}

async function readGpioValue() {
  const pin = el.gpioReadPin?.value;
  if (!pin) {
    showToast('请选择读取端口');
    return;
  }
  try {
    const res = await apiPost('/device/gpio-read', { pin: parseInt(pin) });
    if (el.gpioReadResult) el.gpioReadResult.textContent = `GPIO ${res.pin}: ${res.value}`;
  } catch (e) {
    showToast('GPIO 读取失败: ' + e.message);
  }
}

async function onGpioCardAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const pin = Number(btn.dataset.pin);
  if (!Number.isInteger(pin)) return;

  try {
    if (action === 'high' || action === 'low') {
      const value = action === 'high' ? 1 : 0;
      await apiPost('/device/gpio-write', { pin, value });
      showToast(`GPIO ${pin} 已写入 ${value}`);
      await loadDeviceStatus();
      return;
    }

    if (action === 'read') {
      const res = await apiPost('/device/gpio-read', { pin });
      showToast(`GPIO ${pin} 当前电平: ${res.value}`);
      if (el.gpioReadResult) el.gpioReadResult.textContent = `GPIO ${pin}: ${res.value}`;
      await loadDeviceStatus();
      return;
    }

    if (action === 'release') {
      await apiPost('/device/gpio-release', { pin });
      showToast(`GPIO ${pin} 已释放`);
      await loadDeviceStatus();
    }
  } catch (err) {
    showToast(`GPIO 操作失败: ${err.message}`);
  }
}

window.setServoAngle = setServoAngle;
window.updateServoAngleLabel = updateServoAngleLabel;
window.setServoSpeed = setServoSpeed;
window.updateServoSpeedLabel = updateServoSpeedLabel;
window.runCodeSnippet = runCodeSnippet;

async function loadCodeDraft() {
  if (!el.codeEditor) return;
  try {
    const data = await apiGet('/code/draft');
    el.codeEditor.value = data?.code || '';
  } catch (e) {
    showToast('加载草稿失败: ' + e.message);
  }
}

async function loadCodeActive() {
  if (!el.codeEditor) return;
  try {
    const data = await apiGet('/code/active');
    el.codeEditor.value = data?.code || '';
    showToast('已读取固化代码');
  } catch (e) {
    showToast('读取固化代码失败: ' + e.message);
  }
}

function setCodeLimitsFormEnabled(enabled) {
  const on = !!enabled;
  if (el.codeCfgLimitsEnabled) el.codeCfgLimitsEnabled.checked = on;
  if (el.codeCfgLimitsGroup) {
    el.codeCfgLimitsGroup.classList.toggle('disabled', !on);
    const fields = el.codeCfgLimitsGroup.querySelectorAll('input, textarea, select, button');
    fields.forEach(node => {
      node.disabled = !on;
    });
  }
}

async function setBootAutorunEnabled(enabled, silent = false) {
  try {
    codeSwitchSaving = true;
    const cfg = await apiGet('/code/config');
    const payload = { ...cfg, bootAutorunEnabled: !!enabled };
    const res = await apiPost('/code/config', payload);
    if (el.codeBootAutorunEnabled) {
      el.codeBootAutorunEnabled.checked = !!res?.config?.bootAutorunEnabled;
    }
    await refreshCodeStatus(true);
    if (!silent) showToast(payload.bootAutorunEnabled ? '已开启开机运行' : '已关闭开机运行');
  } catch (e) {
    if (el.codeBootAutorunEnabled) el.codeBootAutorunEnabled.checked = !enabled;
    if (!silent) showToast('保存开机运行失败: ' + e.message);
  } finally {
    codeSwitchSaving = false;
  }
}

async function setLimitsEnabled(enabled, silent = false) {
  try {
    codeSwitchSaving = true;
    const on = !!enabled;
    setCodeLimitsFormEnabled(on);

    const cfg = await apiGet('/code/config');
    let payload = { ...cfg, limitsEnabled: on };

    if (!on) {
      // 关闭限制后立即落盘为无限制配置。
      payload = {
        ...payload,
        codeTextLimit: 0,
        callBudget: 0,
        iterBudget: 0,
        outputMaxChars: 0,
        outputMaxLines: 0,
        httpHeaderMaxBytes: 0,
        httpBodyMaxBytes: 0,
        heartbeatIntervalMs: 0,
        heartbeatStallMs: 0,
        importBlocklist: [],
      };
      if (el.codeCfgTextLimit) el.codeCfgTextLimit.value = '0';
      if (el.codeCfgCallBudget) el.codeCfgCallBudget.value = '0';
      if (el.codeCfgIterBudget) el.codeCfgIterBudget.value = '0';
      if (el.codeCfgOutputChars) el.codeCfgOutputChars.value = '0';
      if (el.codeCfgOutputLines) el.codeCfgOutputLines.value = '0';
      if (el.codeCfgHttpHeader) el.codeCfgHttpHeader.value = '0';
      if (el.codeCfgHttpBody) el.codeCfgHttpBody.value = '0';
      if (el.codeCfgHeartbeatInterval) el.codeCfgHeartbeatInterval.value = '0';
      if (el.codeCfgHeartbeatStall) el.codeCfgHeartbeatStall.value = '0';
      if (el.codeCfgImportBlocklist) el.codeCfgImportBlocklist.value = '';
    }

    const res = await apiPost('/code/config', payload);
    setCodeConfigForm(res?.config || payload);
    await refreshCodeStatus(true);
    if (!silent) showToast(on ? '已开启运行限制并保存' : '已关闭运行限制并保存');
  } catch (e) {
    if (el.codeCfgLimitsEnabled) el.codeCfgLimitsEnabled.checked = !enabled;
    setCodeLimitsFormEnabled(!enabled);
    if (!silent) showToast('保存运行限制开关失败: ' + e.message);
  } finally {
    codeSwitchSaving = false;
  }
}

function bindCodeConfigSwitches() {
  if (el.codeBootAutorunEnabled && !el.codeBootAutorunEnabled.__bound) {
    el.codeBootAutorunEnabled.addEventListener('change', () => {
      if (codeSwitchSaving) return;
      setBootAutorunEnabled(!!el.codeBootAutorunEnabled.checked, false);
    });
    el.codeBootAutorunEnabled.__bound = true;
  }
  if (el.codeCfgLimitsEnabled && !el.codeCfgLimitsEnabled.__bound) {
    el.codeCfgLimitsEnabled.addEventListener('change', () => {
      if (codeSwitchSaving) return;
      setLimitsEnabled(!!el.codeCfgLimitsEnabled.checked, false);
    });
    el.codeCfgLimitsEnabled.__bound = true;
  }
}

async function saveCodeDraft() {
  try {
    await apiPost('/code/draft', { code: el.codeEditor?.value || '' });
    showToast('草稿已保存');
  } catch (e) {
    showToast('保存草稿失败: ' + e.message);
  }
}

async function runCodeSnippet(codeText, source = 'chat_block') {
  const text = String(codeText || '').trim();
  if (!text) {
    throw new Error('empty code');
  }

  const current = await apiGet('/code/status');
  if (current?.running) {
    await apiPost('/code/stop', {});
    await waitUntilCodeStopped(8000);
  }

  await apiPost('/code/draft', { code: text + '\n' });
  if (el.codeEditor) {
    el.codeEditor.value = text + '\n';
  }

  const ret = await apiPost('/code/run', { source, code: text + '\n' });
  if (!ret?.ok) {
    throw new Error(ret?.error || 'run failed');
  }

  await refreshCodeStatus(true);
  startCodeStatusPolling();
  return ret;
}

function setCodeConfigForm(cfg = {}) {
  const limitsEnabled = cfg.limitsEnabled !== false;
  if (el.codeBootAutorunEnabled) el.codeBootAutorunEnabled.checked = !!cfg.bootAutorunEnabled;
  setCodeLimitsFormEnabled(limitsEnabled);

  if (el.codeCfgTextLimit) el.codeCfgTextLimit.value = cfg.codeTextLimit ?? '';
  if (el.codeCfgCallBudget) el.codeCfgCallBudget.value = cfg.callBudget ?? '';
  if (el.codeCfgIterBudget) el.codeCfgIterBudget.value = cfg.iterBudget ?? '';
  if (el.codeCfgOutputChars) el.codeCfgOutputChars.value = cfg.outputMaxChars ?? '';
  if (el.codeCfgOutputLines) el.codeCfgOutputLines.value = cfg.outputMaxLines ?? '';
  if (el.codeCfgHttpHeader) el.codeCfgHttpHeader.value = cfg.httpHeaderMaxBytes ?? '';
  if (el.codeCfgHttpBody) el.codeCfgHttpBody.value = cfg.httpBodyMaxBytes ?? '';
  if (el.codeCfgHeartbeatInterval) el.codeCfgHeartbeatInterval.value = cfg.heartbeatIntervalMs ?? '';
  if (el.codeCfgHeartbeatStall) el.codeCfgHeartbeatStall.value = cfg.heartbeatStallMs ?? '';
  if (el.codeCfgImportBlocklist) {
    const list = Array.isArray(cfg.importBlocklist) ? cfg.importBlocklist : [];
    el.codeCfgImportBlocklist.value = list.join(',');
  }
}

function readCodeConfigForm() {
  const parseList = text => String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  const parseLimit = (raw, fallback) => {
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    if (Number.isNaN(n)) return fallback;
    return n < 0 ? fallback : n;
  };
  const limitsEnabled = !!(el.codeCfgLimitsEnabled?.checked);
  const bootAutorunEnabled = !!(el.codeBootAutorunEnabled?.checked);

  if (!limitsEnabled) {
    return {
      limitsEnabled: false,
      bootAutorunEnabled,
      codeTextLimit: 0,
      callBudget: 0,
      iterBudget: 0,
      outputMaxChars: 0,
      outputMaxLines: 0,
      httpHeaderMaxBytes: 0,
      httpBodyMaxBytes: 0,
      heartbeatIntervalMs: 0,
      heartbeatStallMs: 0,
      importBlocklist: [],
    };
  }

  return {
    limitsEnabled: true,
    bootAutorunEnabled,
    codeTextLimit: parseLimit(el.codeCfgTextLimit?.value, 12000),
    callBudget: parseLimit(el.codeCfgCallBudget?.value, 6000),
    iterBudget: parseLimit(el.codeCfgIterBudget?.value, 2000),
    outputMaxChars: parseLimit(el.codeCfgOutputChars?.value, 4000),
    outputMaxLines: parseLimit(el.codeCfgOutputLines?.value, 120),
    httpHeaderMaxBytes: parseLimit(el.codeCfgHttpHeader?.value, 8192),
    httpBodyMaxBytes: parseLimit(el.codeCfgHttpBody?.value, 16384),
    heartbeatIntervalMs: parseLimit(el.codeCfgHeartbeatInterval?.value, 300),
    heartbeatStallMs: parseLimit(el.codeCfgHeartbeatStall?.value, 5000),
    importBlocklist: parseList(el.codeCfgImportBlocklist?.value || 'os,uos,sys,socket,usocket,network,_thread,threading,subprocess,select,ssl,asyncio,uasyncio'),
  };
}

async function loadCodeConfig() {
  try {
    bindCodeConfigSwitches();
    const cfg = await apiGet('/code/config');
    setCodeConfigForm(cfg || {});
    showToast('已加载运行配置');
  } catch (e) {
    showToast('加载运行配置失败: ' + e.message);
  }
}

async function saveCodeConfig() {
  try {
    const cfg = readCodeConfigForm();
    const res = await apiPost('/code/config', cfg);
    setCodeConfigForm(res?.config || cfg);
    showToast('运行配置已保存到 Flash');
    refreshCodeStatus(true);
  } catch (e) {
    showToast('保存运行配置失败: ' + e.message);
  }
}

async function resetCodeConfigDefaults() {
  const defaults = {
    limitsEnabled: true,
    bootAutorunEnabled: false,
    codeTextLimit: 12000,
    callBudget: 6000,
    iterBudget: 2000,
    outputMaxChars: 4000,
    outputMaxLines: 120,
    httpHeaderMaxBytes: 8192,
    httpBodyMaxBytes: 16384,
    heartbeatIntervalMs: 300,
    heartbeatStallMs: 5000,
    importBlocklist: ['os', 'uos', 'sys', 'socket', 'usocket', 'network', '_thread', 'threading', 'subprocess', 'select', 'ssl', 'asyncio', 'uasyncio'],
  };
  setCodeConfigForm(defaults);
  showToast('已恢复默认配置到输入框，点击“保存配置”才会写入 Flash');
  refreshCodeStatus(true);
}

async function stopCodeRun() {
  if (codeRunTransitioning) return;
  try {
    codeRunTransitioning = true;
    setCodeRunButtonsState(true, true);
    const res = await apiPost('/code/stop', {});
    showToast(res?.running ? '已请求停止运行' : '当前没有运行中的任务');
    await refreshCodeStatus(true);
  } catch (e) {
    showToast('停止运行失败: ' + e.message);
  } finally {
    codeRunTransitioning = false;
    refreshCodeStatus(true);
  }
}

async function runCode() {
  if (codeRunTransitioning) return;
  try {
    codeRunTransitioning = true;
    setCodeRunButtonsState(true, true);

    const source = el.codeRunSource?.value || 'draft';
    const payload = { source };
    if (source !== 'draft' && source !== 'active') {
      payload.code = el.codeEditor?.value || '';
    }

    const current = await apiGet('/code/status');
    if (current?.running) {
      showToast('检测到已有任务，正在停止并覆盖运行...');
      await apiPost('/code/stop', {});
      await waitUntilCodeStopped(8000);
    }

    const res = await apiPost('/code/run', payload);
    if (res?.ok) {
      showToast('代码开始运行: ' + (res.jobId || '')); 
      await refreshCodeStatus(true);
      startCodeStatusPolling();
    }
  } catch (e) {
    showToast('运行失败: ' + e.message);
  } finally {
    codeRunTransitioning = false;
    refreshCodeStatus(true);
  }
}

async function persistCode() {
  try {
    await saveCodeDraft();
    const res = await apiPost('/code/persist', { note: 'web persist' });
    showToast('固化成功: v' + (res?.version || '')); 
    refreshCodeStatus(true);
  } catch (e) {
    showToast('固化失败: ' + e.message);
  }
}

function startCodeStatusPolling() {
  stopCodeStatusPolling();
  codeStatusTimer = setInterval(() => {
    refreshCodeStatus(true);
  }, 300);
}

function stopCodeStatusPolling() {
  if (codeStatusTimer) {
    clearInterval(codeStatusTimer);
    codeStatusTimer = null;
  }
}

async function refreshCodeStatus(silent = false) {
  try {
    const data = await apiGet('/code/status');
    const status = data?.status || 'idle';
    const statusMap = {
      idle: '空闲',
      running: '运行中',
      ok: '成功',
      error: '错误',
      blocked: '已拦截',
      timeout: '超时',
      limited: '受限终止',
    };
    if (el.codeRuntimeStatus) el.codeRuntimeStatus.textContent = statusMap[status] || status;
    if (el.codeRuntimeJob) el.codeRuntimeJob.textContent = data?.jobId || '—';
    if (el.codeRuntimeDuration) el.codeRuntimeDuration.textContent = `${data?.durationMs || 0} ms`;
    if (el.codeRuntimeVersion) el.codeRuntimeVersion.textContent = data?.lastVersion || data?.meta?.activeVersion || '—';
    const notes = [];
    if (data?.lastNote) notes.push(data.lastNote);
    if (data?.limitHit) notes.push(`limit=${data.limitHit}`);
    if (data?.outputTruncated) notes.push('output_truncated');
    if (el.codeRuntimeNote) el.codeRuntimeNote.textContent = notes.join(' | ') || '—';

    let out = [data?.output || '', data?.error ? `\n[ERROR]\n${data.error}` : ''].join('').trim();
    if (!out) {
      if (status === 'running') out = '(运行中，等待输出...)';
      else if (status === 'ok') out = '(运行成功，无输出)';
      else out = '—';
    }
    if (el.codeRuntimeOutput) el.codeRuntimeOutput.textContent = out;

    setCodeRunButtonsState(!!data?.running, codeRunTransitioning);
    if (el.codeBootAutorunEnabled && data?.config && Object.prototype.hasOwnProperty.call(data.config, 'bootAutorunEnabled')) {
      el.codeBootAutorunEnabled.checked = !!data.config.bootAutorunEnabled;
    }
    if (data?.config && Object.prototype.hasOwnProperty.call(data.config, 'limitsEnabled')) {
      setCodeLimitsFormEnabled(!!data.config.limitsEnabled);
    }

    const log = await apiGet('/code/log');
    if (el.codeRuntimeLog) el.codeRuntimeLog.textContent = log?.log || '—';

    if (status !== 'running') {
      stopCodeStatusPolling();
      if (!silent && status && status !== 'idle') {
        showToast('运行状态: ' + (statusMap[status] || status));
      }
    }
  } catch (e) {
    if (!silent) showToast('状态刷新失败: ' + e.message);
  }
}

function toggleCodeConfigPanel() {
  if (!el.codeConfigModal) return;
  const hidden = el.codeConfigModal.classList.contains('hidden');
  if (hidden) {
    el.codeConfigModal.classList.remove('hidden');
    loadCodeConfig();
  } else {
    el.codeConfigModal.classList.add('hidden');
  }
}

function closeCodeConfigModal() {
  if (!el.codeConfigModal) return;
  el.codeConfigModal.classList.add('hidden');
}

function setSidebarWidth(px) {
  const parsed = parseInt(String(px), 10);
  const width = Math.max(320, Math.min(560, Number.isNaN(parsed) ? 380 : parsed));
  sidebarExpandedWidth = width;
  if (el.sidebar) {
    el.sidebar.style.width = `${width}px`;
    el.sidebar.style.minWidth = `${width}px`;
  }
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
  } catch (e) {
    console.warn('save sidebar width failed', e);
  }
}

function initSidebarWidth() {
  let width = 380;
  try {
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || '380', 10);
    if (!Number.isNaN(saved)) width = saved;
  } catch (e) {
    // ignore
  }
  setSidebarWidth(width);
}

function startSidebarResize(e) {
  if (!el.sidebar) return;
  e.preventDefault();
  const onMove = ev => setSidebarWidth(ev.clientX);
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ...existing code...
