const {
  app,
  BrowserWindow,
  shell,
  session,
  powerSaveBlocker,
  Menu,
  nativeTheme,
  ipcMain,
} = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store({
  name: 'vixtv-settings',
  defaults: {
    serverUrl: 'https://tv.vixred.com',
    windowBounds: { width: 1280, height: 800 },
    startMaximized: false,
  },
});

const APP_VERSION = app.getVersion();
const PLATFORM = 'windows';
let mainWindow = null;
let powerBlockerId = null;

function defaultServerUrl() {
  return process.env.VIXTV_SERVER_URL || store.get('serverUrl') || 'https://tv.vixred.com';
}

function buildUserAgent() {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VixTV/${APP_VERSION} ${PLATFORM}`;
}

function startPowerSaveBlocker() {
  if (powerBlockerId !== null) return;
  try {
    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  } catch {
    powerBlockerId = null;
  }
}

function stopPowerSaveBlocker() {
  if (powerBlockerId === null) return;
  try {
    powerSaveBlocker.stop(powerBlockerId);
  } catch { /* ignore */ }
  powerBlockerId = null;
}

function createWindow() {
  const bounds = store.get('windowBounds') || { width: 1280, height: 800 };
  const startMaximized = !!store.get('startMaximized');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#07070d',
    autoHideMenuBar: true,
    title: 'Vix TV',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  if (startMaximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    store.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.on('maximize', () => store.set('startMaximized', true));
  mainWindow.on('unmaximize', () => store.set('startMaximized', false));

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopPowerSaveBlocker();
  });

  const server = defaultServerUrl().replace(/\/$/, '');
  const startUrl = `${server}/?vix_platform=windows&vix_desktop=1`;
  mainWindow.loadURL(startUrl, { userAgent: buildUserAgent() });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('media-started-playing', () => startPowerSaveBlocker());
  mainWindow.webContents.on('media-paused', () => {
    if (!mainWindow?.webContents.isCurrentlyAudible()) stopPowerSaveBlocker();
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Vix TV',
      submenu: [
        {
          label: 'Recargar',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: 'Pantalla completa',
          accelerator: 'F11',
          click: () => {
            if (!mainWindow) return;
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
        { type: 'separator' },
        {
          label: 'Cambiar servidor…',
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send('vix-desktop:open-settings');
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('vix:get-server', () => defaultServerUrl());
ipcMain.handle('vix:set-server', (_event, url) => {
  const clean = String(url || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(clean)) return { ok: false, error: 'URL inválida' };
  store.set('serverUrl', clean);
  if (mainWindow) {
    mainWindow.loadURL(`${clean}/?vix_platform=windows&vix_desktop=1`, {
      userAgent: buildUserAgent(),
    });
  }
  return { ok: true, server: clean };
});
ipcMain.handle('vix:get-version', () => ({
  version: APP_VERSION,
  platform: PLATFORM,
  server: defaultServerUrl(),
}));
ipcMain.handle('vix:open-external', (_event, url) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
  return true;
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  buildMenu();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = ['media', 'fullscreen', 'pointerLock'].includes(permission);
    callback(allow);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => stopPowerSaveBlocker());
