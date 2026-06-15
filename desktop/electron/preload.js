const { contextBridge, ipcRenderer } = require('electron');

const store = {
  getServerUrl: () => ipcRenderer.invoke('vix:get-server'),
  setServerUrl: (url) => ipcRenderer.invoke('vix:set-server', url),
  getVersion: () => ipcRenderer.invoke('vix:get-version'),
};

contextBridge.exposeInMainWorld('VIXTV_NATIVE', {
  platform: 'windows',
  app: 'vixtv',
  version: null,
  versionCode: 1,
  server: null,
  isDesktop: true,
});

contextBridge.exposeInMainWorld('VixDesktop', {
  ...store,
  getAuthToken: () => localStorage.getItem('vix_token') || '',
  saveAuthToken: (token) => {
    if (token) localStorage.setItem('vix_token', token);
    else localStorage.removeItem('vix_token');
  },
  clearAuthToken: () => localStorage.removeItem('vix_token'),
  openExternal: (url) => ipcRenderer.invoke('vix:open-external', url),
  onOpenSettings: (fn) => {
    ipcRenderer.on('vix-desktop:open-settings', () => fn());
  },
});

ipcRenderer.invoke('vix:get-version').then((v) => {
  if (window.VIXTV_NATIVE && v) {
    window.VIXTV_NATIVE.version = v.version;
    window.VIXTV_NATIVE.server = v.server;
  }
});

ipcRenderer.invoke('vix:get-server').then((server) => {
  if (window.VIXTV_NATIVE && server) window.VIXTV_NATIVE.server = server;
});
