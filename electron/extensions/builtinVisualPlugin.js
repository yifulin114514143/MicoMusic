import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import isDev from 'electron-is-dev';
import extensionManager from './extensionManager.js';
import { createBuiltinVisualPluginFiles, BUILTIN_VISUAL_ID, BUILTIN_VISUAL_DIRECTORY } from './builtinVisualPluginFiles.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const store = new Store();
const STATE_KEY = 'builtinVisualPlugins';
let preparationResult = null;
const sourceDirectory = isDev
    ? path.join(root, 'plugins/extensions', BUILTIN_VISUAL_DIRECTORY)
    : path.join(process.resourcesPath, 'visual-plugins', BUILTIN_VISUAL_DIRECTORY);
const installer = createBuiltinVisualPluginFiles({
    sourceDirectory,
    extensionsDirectory: extensionManager.getExtensionsDirectory(),
    getState: () => store.get(STATE_KEY, {})[BUILTIN_VISUAL_ID],
    setState: state => store.set(STATE_KEY, { ...store.get(STATE_KEY, {}), [BUILTIN_VISUAL_ID]: state })
});

export function prepareBuiltinVisualPlugin() {
    // 开发版直接加载受版本管理的源目录；不将源码作为用户安装目录覆盖。
    if (isDev) return { success: true, development: true };
    preparationResult = installer.prepare();
    return preparationResult;
}
export function markBuiltinVisualUninstalled(extension) {
    if (!isDev && extension?.manifest?.plugin_id === BUILTIN_VISUAL_ID) installer.markUninstalled();
}
export function getBuiltinVisualPluginState() { return { ...installer.getState(), development: isDev, preparationResult }; }
export async function restoreBuiltinVisualPlugin() {
    if (isDev) return { success: false, message: '开发版主题直接从源码加载，无需恢复安装' };
    const prepared = installer.prepare({ restore: true });
    preparationResult = prepared;
    if (!prepared.success) return prepared;
    const loaded = extensionManager.getLoadedExtensions().find(extension => extensionManager.pathsMatch(extension.path, prepared.path));
    if (loaded) return { success: true, extension: { id: loaded.id } };
    return extensionManager.installExtension(prepared.path);
}
