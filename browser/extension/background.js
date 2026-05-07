const DEBUGGER_VERSION = '1.3';
const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 17373;
const attachedTabs = new Set();

let bridgeConfig = {
  host: DEFAULT_BRIDGE_HOST,
  port: DEFAULT_BRIDGE_PORT
};

let bridgeStatus = {
  connected: false,
  lastError: null,
  lastHeartbeatAt: null
};

function getTarget(tabId) {
  return { tabId };
}

function getBridgeBaseUrl() {
  return `http://${bridgeConfig.host}:${bridgeConfig.port}`;
}

function normalizeHost(value) {
  const next = String(value || '').trim();
  return next || DEFAULT_BRIDGE_HOST;
}

function normalizePort(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_BRIDGE_PORT;
  }
  return parsed;
}

async function loadBridgeConfig() {
  const stored = await chrome.storage.local.get({
    bridgeHost: DEFAULT_BRIDGE_HOST,
    bridgePort: DEFAULT_BRIDGE_PORT
  });

  bridgeConfig = {
    host: normalizeHost(stored.bridgeHost),
    port: normalizePort(stored.bridgePort)
  };
}

async function saveBridgeConfig(host, port) {
  bridgeConfig = {
    host: normalizeHost(host),
    port: normalizePort(port)
  };

  await chrome.storage.local.set({
    bridgeHost: bridgeConfig.host,
    bridgePort: bridgeConfig.port
  });
}

async function queryActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found.');
  }
  return tab;
}

async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) {
    return;
  }

  await chrome.debugger.attach(getTarget(tabId), DEBUGGER_VERSION);
  attachedTabs.add(tabId);
}

async function sendCommand(tabId, method, commandParams = {}) {
  await ensureDebuggerAttached(tabId);
  return chrome.debugger.sendCommand(getTarget(tabId), method, commandParams);
}

async function navigate(tabId, url) {
  await sendCommand(tabId, 'Page.enable');
  return sendCommand(tabId, 'Page.navigate', { url });
}

async function evaluate(tabId, expression, returnByValue = true) {
  return sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue
  });
}

async function requestBridge(path, options = {}) {
  const response = await fetch(`${getBridgeBaseUrl()}${path}`, options);
  if (!response.ok) {
    throw new Error(`Bridge returned ${response.status}.`);
  }
  return response.json();
}

async function postBridge(path, payload) {
  return requestBridge(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function setBridgeError(error) {
  bridgeStatus = {
    connected: false,
    lastError: error?.message || String(error),
    lastHeartbeatAt: bridgeStatus.lastHeartbeatAt
  };
}

function setBridgeSuccess() {
  bridgeStatus = {
    connected: true,
    lastError: null,
    lastHeartbeatAt: new Date().toISOString()
  };
}

async function registerBridge() {
  try {
    await postBridge('/extension/register', {
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      name: chrome.runtime.getManifest().name
    });
    setBridgeSuccess();
  } catch (error) {
    setBridgeError(error);
  }
}

async function heartbeatBridge() {
  try {
    const tab = await queryActiveTab().catch(() => null);
    await postBridge('/extension/heartbeat', {
      tab: tab ? {
        id: tab.id,
        url: tab.url || '',
        title: tab.title || ''
      } : null
    });
    setBridgeSuccess();
  } catch (error) {
    setBridgeError(error);
  }
}

async function reportCommandResult(id, body) {
  await postBridge(`/commands/${id}/result`, body);
}

async function executeCommand(command, payload) {
  switch (command.type) {
    case 'open-tab': {
      const url = String(payload?.url || '').trim();
      if (!url) {
        throw new Error('Missing payload.url.');
      }
      const tab = await chrome.tabs.create({ url, active: true });
      return { tabId: tab.id, url: tab.url || url };
    }
    case 'navigate': {
      const tab = await queryActiveTab();
      const url = String(payload?.url || '').trim();
      if (!url) {
        throw new Error('Missing payload.url.');
      }
      await navigate(tab.id, url);
      return { tabId: tab.id, url };
    }
    case 'evaluate': {
      const tab = await queryActiveTab();
      const expression = String(payload?.expression || '').trim();
      if (!expression) {
        throw new Error('Missing payload.expression.');
      }
      const result = await evaluate(tab.id, expression, payload?.returnByValue !== false);
      return { tabId: tab.id, evaluation: result };
    }
    default:
      throw new Error(`Unsupported command type: ${command.type}`);
  }
}

async function pullAndRunNextCommand() {
  let next;
  try {
    next = await requestBridge('/commands/next');
  } catch (error) {
    setBridgeError(error);
    return;
  }

  const command = next?.command;
  if (!command) {
    return;
  }

  try {
    const result = await executeCommand(command, next?.payload || {});
    await reportCommandResult(command.id, { ok: true, result });
  } catch (error) {
    await reportCommandResult(command.id, {
      ok: false,
      error: error?.message || String(error)
    }).catch(() => {});
  }
}

async function syncBridge() {
  await heartbeatBridge();
  await pullAndRunNextCommand();
}

async function getStatusPayload() {
  const tab = await queryActiveTab();
  return {
    ok: true,
    tabId: tab.id,
    tabUrl: tab.url || '',
    tabTitle: tab.title || '',
    bridge: {
      ...bridgeStatus,
      ...bridgeConfig,
      baseUrl: getBridgeBaseUrl()
    }
  };
}

async function initialize() {
  await loadBridgeConfig();
  chrome.alarms.create('bridge-heartbeat', {
    delayInMinutes: 0.5,
    periodInMinutes: 0.5
  });
  await registerBridge();
  await pullAndRunNextCommand();
}

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId === 'number') {
    attachedTabs.delete(source.tabId);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bridge-heartbeat') {
    syncBridge();
  }
});

setInterval(() => {
  pullAndRunNextCommand();
}, 3000);

initialize();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'status': {
        sendResponse(await getStatusPayload());
        return;
      }
      case 'get-config': {
        sendResponse({
          ok: true,
          bridge: {
            ...bridgeConfig,
            baseUrl: getBridgeBaseUrl()
          }
        });
        return;
      }
      case 'save-config': {
        await saveBridgeConfig(message?.host, message?.port);
        await registerBridge();
        sendResponse({
          ok: true,
          bridge: {
            ...bridgeConfig,
            baseUrl: getBridgeBaseUrl()
          }
        });
        return;
      }
      case 'connect-config': {
        await saveBridgeConfig(message?.host, message?.port);
        await registerBridge();
        await heartbeatBridge();
        await pullAndRunNextCommand();
        sendResponse(await getStatusPayload());
        return;
      }
      default: {
        throw new Error(`Unsupported message type: ${message?.type ?? 'unknown'}`);
      }
    }
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error?.message || String(error)
    });
  });

  return true;
});
