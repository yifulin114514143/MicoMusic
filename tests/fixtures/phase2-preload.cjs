// 沿用实际 preload，只在隔离配置中预先完成引导，避免遮挡审计截图。
require('../../electron/preload.cjs');
const { ipcRenderer } = require('electron');
for (const [key, value] of ipcRenderer.sendSync('phase2-initial-storage')) localStorage.setItem(key, value);
