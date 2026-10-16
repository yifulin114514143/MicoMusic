// 使用生产 preload；仅在隔离 profile 中关闭引导并固定测试导航模式。
require('../../electron/preload.cjs');
const { ipcRenderer } = require('electron');
for (const [key, value] of ipcRenderer.sendSync('phase3-initial-storage')) {
    localStorage.setItem(key, value);
}
// preload 隔离世界记录当前文档内是否插入过主题材质，供关闭状态首屏验收。
let materialSeen = false;
const materialObserver = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.id === 'mico-liquid-glass-style'))) materialSeen = true;
    document.documentElement?.setAttribute('data-phase3-material-seen', String(materialSeen));
});
materialObserver.observe(document, { childList: true, subtree: true });
window.addEventListener('pagehide', () => materialObserver.disconnect(), { once: true });
