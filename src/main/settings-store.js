const log = require('./logger');
const { app, ipcMain, nativeTheme, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const IPC = require('../shared/ipc-channels');

// Apply theme to nativeTheme so webviews get correct prefers-color-scheme
function applyNativeTheme(theme) {
  if (theme === 'light') {
    nativeTheme.themeSource = 'light';
  } else if (theme === 'dark') {
    nativeTheme.themeSource = 'dark';
  } else {
    nativeTheme.themeSource = 'system';
  }
}

const SETTINGS_FILE = 'settings.json';
const DEFAULT_SETTINGS = {
  theme: 'system',
  enableRadicleIntegration: false,
  enableIdentityWallet: false,
  beeNodeMode: 'ultraLight',
  startBeeAtLaunch: true,
  startIpfsAtLaunch: true,
  startRadicleAtLaunch: false,
  autoUpdate: true,
  showBookmarkBar: false,
  enableEnsCustomRpc: false,
  ensRpcUrl: '',
  sidebarOpen: false,
  sidebarWidth: 320,
};

let cachedSettings = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }

  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    log.error('Failed to load settings:', err);
    cachedSettings = { ...DEFAULT_SETTINGS };
  }

  // Apply theme to nativeTheme
  applyNativeTheme(cachedSettings.theme);

  return cachedSettings;
}

function broadcastSettingsUpdated(merged) {
  if (!webContents?.getAllWebContents) return;
  for (const wc of webContents.getAllWebContents()) {
    try {
      wc.send(IPC.SETTINGS_UPDATED, merged);
    } catch {
      // webContents may be destroyed
    }
  }
}

// Strict shallow equality. Safe because every value in DEFAULT_SETTINGS is a
// primitive (string/number/boolean); revisit if a nested value is added.
function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function pickKnownSettings(input) {
  if (!input || typeof input !== 'object') return {};
  const filtered = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      filtered[key] = input[key];
    }
  }
  return filtered;
}

function saveSettings(newSettings) {
  try {
    const previous = loadSettings();
    const sanitized = pickKnownSettings(newSettings);
    const merged = { ...previous, ...sanitized };
    if (shallowEqual(previous, merged)) {
      return true;
    }
    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    cachedSettings = merged;

    if (sanitized.theme && sanitized.theme !== previous.theme) {
      applyNativeTheme(sanitized.theme);
    }

    broadcastSettingsUpdated(merged);

    return true;
  } catch (err) {
    log.error('Failed to save settings:', err);
    return false;
  }
}

function registerSettingsIpc() {
  ipcMain.handle(IPC.SETTINGS_GET, () => {
    return loadSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SAVE, (_event, newSettings) => {
    return saveSettings(newSettings);
  });
}

module.exports = {
  loadSettings,
  saveSettings,
  registerSettingsIpc,
};
