// 插件系统统一入口文件
import extensionManager from './extensionManager.js';
import { registerExtensionIPC, unregisterExtensionIPC } from './extensionIPC.js';
import nativeHostManager from './nativeHostManager.js';
import log from 'electron-log';
import { prepareBuiltinVisualPlugin } from './builtinVisualPlugin.js';
import { prepareVisualPlugin, disposeVisualPlugin, closeVisualBridges, isBuiltinVisualPlugin } from './visualPluginHost.js';

/**
 * 初始化插件系统
 */
export async function initializeExtensions({ signal } = {}) {
    let preparing = true;
    try {
        extensionManager.setBeforeExtensionUnloadHook(async (extension, reason) => {
            await disposeVisualPlugin(extension);
            if (reason === 'uninstall') await nativeHostManager.stopExtension(extension.id, true);
        });
        extensionManager.setAfterExtensionLoadHook(async extension => {
            if (preparing && signal?.aborted && isBuiltinVisualPlugin(extension)) {
                throw new Error('本次启动的视觉插件准备已超时，保留基础界面');
            }
            await prepareVisualPlugin(extension);
        });
        // 确保插件目录存在
        extensionManager.ensureExtensionsDirectory();
        const builtinResult = prepareBuiltinVisualPlugin();
        
        // 注册 IPC 处理程序
        registerExtensionIPC();
        
        // 加载插件
        const loaded = await extensionManager.loadChromeExtensions();

        // 同步本地程序索引
        syncNativeHosts();
        
        return { ...loaded, success: loaded.success && builtinResult.success, builtinResult };
    } catch (error) {
        log.error('插件系统初始化失败:', error);
        return { success: false, error: error.message };
    } finally { preparing = false; }
}

// 内置主题或第三方扩展卡住时，基础窗口仍须能够打开。
export async function prepareExtensionsForStartup(timeoutMs = 6000) {
    let timer;
    const controller = new AbortController();
    try {
        return await Promise.race([
            initializeExtensions({ signal: controller.signal }),
            new Promise(resolve => { timer = setTimeout(() => {
                controller.abort();
                resolve({ success: false, timedOut: true, message: '插件准备超时，已使用基础界面' });
            }, timeoutMs); })
        ]);
    } finally { clearTimeout(timer); }
}

/**
 * 清理插件系统
 */
export async function cleanupExtensions() {
    try {
        // 先停止所有本地程序并等待其退出，再卸载扩展
        // 顺序至关重要：若先卸载扩展，WebSocket 断开后 EXE 会自行退出，
        // 但 stopAll 的 await 可保证 restartExtensions 不会在旧进程存活时启动新进程。
        await nativeHostManager.stopAll();
        const unloaded = await extensionManager.unloadChromeExtensions();
        if (!unloaded.success) return unloaded;
        closeVisualBridges();
        
        // 注销 IPC 处理程序
        unregisterExtensionIPC();
        
        return { success: true };
    } catch (error) {
        log.error('插件系统清理失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 重启插件系统
 */
export async function restartExtensions() {
    try {
        const cleanupResult = await cleanupExtensions();
        if (!cleanupResult.success) {
            return cleanupResult;
        }
        
        const initResult = await initializeExtensions();
        return initResult;
    } catch (error) {
        log.error('重启插件系统失败:', error);
        return { success: false, error: error.message };
    }
}

function syncNativeHosts() {
    try {
        nativeHostManager.syncExtensions(
            extensionManager.getLoadedExtensions(),
            extensionManager.scanExtensions()
        );
        nativeHostManager.startAuthorizedAutoHosts();
    } catch (error) {
        log.error('同步本地程序索引失败:', error);
    }
}

export {
    extensionManager,
    registerExtensionIPC,
    unregisterExtensionIPC
};

export default {
    initializeExtensions,
    cleanupExtensions,
    restartExtensions,
    extensionManager,
    registerExtensionIPC,
    unregisterExtensionIPC
};
