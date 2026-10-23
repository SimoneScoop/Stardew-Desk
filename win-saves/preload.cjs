'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('farmAPI',{
 call:(action,value)=>ipcRenderer.invoke('farm-api',action,value),
 on:(event,callback)=>{if(!['farm-changed','settings-changed','weather-changed','status','paused','desktop-cursor','desktop-click','original-state','npc-command','npc-state'].includes(event))return;ipcRenderer.on(event,(_e,v)=>callback(v));}
});
