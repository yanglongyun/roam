const statusEl = document.getElementById('status');
const saveStatusEl = document.getElementById('save-status');
const hostInput = document.getElementById('host');
const portInput = document.getElementById('port');

function renderStatus(message) {
  statusEl.innerHTML = message;
}

function renderSaveStatus(message) {
  saveStatusEl.textContent = message;
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    throw new Error(response?.error || '插件发生未知错误。');
  }
  return response;
}

function formatStatus(response) {
  const rows = [
    {
      label: '连接状态',
      value: `<span class="status-pill ${response.bridge?.connected ? 'connected' : 'disconnected'}">${response.bridge?.connected ? '已连接' : '未连接'}</span>`
    },
    {
      label: '服务地址',
      value: escapeHtml(response.bridge?.baseUrl || 'n/a')
    },
    {
      label: '浏览器控制',
      value: `<span class="status-pill ${response.attached ? 'enabled' : 'disabled'}">${response.attached ? '已启用' : '未启用'}</span>`
    },
    {
      label: '标签页 ID',
      value: escapeHtml(String(response.tabId ?? 'n/a'))
    },
    {
      label: '页面标题',
      value: escapeHtml(response.tabTitle || '空')
    },
    {
      label: '页面地址',
      value: escapeHtml(response.tabUrl || '空')
    }
  ];

  if (response.bridge?.lastHeartbeatAt) {
    rows.push({
      label: '最近同步',
      value: escapeHtml(response.bridge.lastHeartbeatAt)
    });
  }
  if (response.bridge?.lastError) {
    rows.push({
      label: '异常信息',
      value: escapeHtml(response.bridge.lastError)
    });
  }

  return `<div class="status-list">${rows.map((row) => `
    <div class="status-row">
      <div class="status-label">${row.label}</div>
      <div class="status-value">${row.value}</div>
    </div>
  `).join('')}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadConfig() {
  const response = await send('get-config');
  hostInput.value = response.bridge?.host || '127.0.0.1';
  portInput.value = String(response.bridge?.port || 17373);
}

async function refreshStatus() {
  try {
    const response = await send('status');
    renderStatus(formatStatus(response));
  } catch (error) {
    renderStatus(`<div class="status-list"><div class="status-row"><div class="status-label">状态错误</div><div class="status-value">${escapeHtml(error.message)}</div></div></div>`);
  }
}

document.getElementById('save').addEventListener('click', async () => {
  renderSaveStatus('正在保存...');
  try {
    await send('save-config', {
      host: hostInput.value.trim(),
      port: portInput.value.trim()
    });
    renderSaveStatus('连接设置已保存。');
    await refreshStatus();
  } catch (error) {
    renderSaveStatus(`保存失败：${error.message}`);
  }
});

(async () => {
  await loadConfig();
  await refreshStatus();
})();
