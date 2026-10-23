// Gives the scene pages the same bridge the Mac app's WKWebView gives them:
//   window.SDV_HOST                               'mac' (desktop), 'editor', 'saver', 'setup'
//   window.webkit.messageHandlers.sdv.postMessage  page → app
// The app talks back with webContents.executeJavaScript('SDV.host.…').
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find(a => a.startsWith('--sdv-role='));
const role = arg ? arg.slice('--sdv-role='.length) : '';
contextBridge.exposeInMainWorld('SDV_HOST', role);
contextBridge.exposeInMainWorld('SDV_PLATFORM', 'win');
contextBridge.exposeInMainWorld('webkit', { messageHandlers: { sdv: { postMessage: msg => ipcRenderer.send('sdv', msg) } } });
