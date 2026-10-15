// For the app's own small pages (prompt.html, audio.html): a narrow IPC bridge.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('SDV_APP', {
  send: (channel, data) => { if (/^(prompt|audio):/.test(channel)) ipcRenderer.send(channel, data); },
  on: (channel, fn) => { if (/^(prompt|audio):/.test(channel)) ipcRenderer.on(channel, (e, data) => fn(data)); },
});
