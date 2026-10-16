import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_VISUAL_ID, BUILTIN_VISUAL_DIRECTORY } from './builtinVisualPluginFiles.js';
import extensionManager from './extensionManager.js';

const rendererFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const bridges = new Map();
const READY_ATTRIBUTE = 'data-mico-visual-ready';
const LIFECYCLE_EVENT = 'mico-visual-lifecycle';

export function isBuiltinVisualPlugin(extension) {
    return extension?.manifest?.plugin_id === BUILTIN_VISUAL_ID &&
        extensionManager.pathsMatch(extension.path, path.join(extensionManager.getExtensionsDirectory(), BUILTIN_VISUAL_DIRECTORY));
}
function targets() {
    return BrowserWindow.getAllWindows().map(window => window.webContents).filter(contents => {
        if (contents.isDestroyed() || contents.session !== session.defaultSession) return false;
        try {
            const url = new URL(contents.getURL());
            if (url.protocol === 'file:') return extensionManager.pathsMatch(fileURLToPath(url), rendererFile);
            return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8080';
        } catch { return false; }
    });
}
async function bounded(promise, milliseconds, label) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + '超时')), milliseconds); })]); }
    finally { clearTimeout(timer); }
}
async function bridgeFor(extension) {
    const existing = bridges.get(extension.id);
    if (existing && !existing.isDestroyed()) return existing;
    const bridge = new BrowserWindow({ show: false, title: 'MicoMusic 视觉插件桥', webPreferences: {
        session: session.defaultSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false
    } });
    bridges.set(extension.id, bridge);
    bridge.on('closed', () => { if (bridges.get(extension.id) === bridge) bridges.delete(extension.id); });
    try {
        await bounded(bridge.loadURL(`chrome-extension://${extension.id}/host-bridge.html`), 3000, '视觉桥准备');
        return bridge;
    } catch (error) { if (!bridge.isDestroyed()) bridge.destroy(); throw error; }
}
async function executeInExtension(bridge, contents, script) {
    // Electron 39 隔离实验已验证 tabs.id 与 WebContents.id 对应；再同时核对精确 URL。
    const target = { id: contents.id, url: contents.getURL() };
    return bounded(bridge.webContents.executeJavaScript(`(async () => {
        const expected = ${JSON.stringify(target)};
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(item => item.id === expected.id && item.url === expected.url);
        if (!tab) return { skipped: true };
        return ${script};
    })()`, true), 4000, '视觉脚本执行');
}
export async function waitForVisualPluginReady(contents, extensionId, milliseconds = 2500) {
    const started = Date.now();
    while (!contents.isDestroyed() && Date.now() - started < milliseconds) {
        const state = await bounded(contents.executeJavaScript(`JSON.parse(document.documentElement?.getAttribute(${JSON.stringify(READY_ATTRIBUTE)}) || 'null')`), milliseconds, '视觉状态读取');
        if (state?.extensionId === extensionId) {
            if (!state.success) throw new Error(state.error || '视觉插件初始化失败');
            return state;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('视觉插件就绪超时');
}
export async function prepareVisualPlugin(extension) {
    if (!isBuiltinVisualPlugin(extension)) return;
    const documents = targets();
    if (!documents.length) return;
    const files = extension.manifest.content_scripts[0].js;
    const bridge = await bridgeFor(extension);
    for (const contents of documents) {
        if (contents.isLoading()) continue; // 新文档由 manifest 注入；重载只处理已经打开的文档。
        const result = await executeInExtension(bridge, contents,
            `chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ${JSON.stringify(files)}, world: 'ISOLATED' })`);
        if (!result?.skipped) await waitForVisualPluginReady(contents, extension.id);
    }
}
export async function disposeVisualPlugin(extension) {
    if (!isBuiltinVisualPlugin(extension)) return;
    const documents = targets();
    try {
        if (!documents.length) return;
        const bridge = await bridgeFor(extension);
        for (const contents of documents) {
            if (contents.isDestroyed()) continue;
            const token = randomUUID();
            const command = { extensionId: extension.id, action: 'dispose', token };
            const result = await executeInExtension(bridge, contents, `chrome.scripting.executeScript({
                target: { tabId: tab.id }, world: 'ISOLATED', args: [${JSON.stringify(command)}],
                func: command => {
                    if (!globalThis.__micoLiquidGlassRuntime) return { inactive: true };
                    document.dispatchEvent(new CustomEvent(${JSON.stringify(LIFECYCLE_EVENT)}, { detail: JSON.stringify(command) }));
                    const ack = JSON.parse(document.documentElement.getAttribute('data-mico-visual-ack') || 'null');
                    document.documentElement.removeAttribute('data-mico-visual-ack');
                    return { ack, active: Boolean(globalThis.__micoLiquidGlassRuntime), styles: document.querySelectorAll('#mico-liquid-glass-style').length };
                }
            })`);
            if (result?.skipped) continue;
            for (const injection of result) {
                const value = injection.result;
                if (value?.inactive) continue;
                if (!value?.ack?.success || value.ack.extensionId !== extension.id || value.ack.token !== token || value.active || value.styles) {
                    throw new Error('视觉插件未完成清理，已停止卸载');
                }
            }
        }
    } finally {
        const bridge = bridges.get(extension.id);
        if (bridge && !bridge.isDestroyed()) bridge.destroy();
        bridges.delete(extension.id);
    }
}
export function closeVisualBridges() {
    for (const bridge of bridges.values()) if (!bridge.isDestroyed()) bridge.destroy();
    bridges.clear();
}

export async function getVisualPluginRuntimeStatus() {
    const result = [];
    for (const contents of targets()) {
        try {
            const state = await bounded(contents.executeJavaScript(`JSON.parse(document.documentElement?.getAttribute('data-mico-visual-ready') || 'null')`), 1000, '视觉状态读取');
            if (state) result.push({ windowId: contents.id, state });
        } catch (error) { result.push({ windowId: contents.id, state: { success: false, error: error.message } }); }
    }
    return result;
}
