import fs from 'node:fs';
import path from 'node:path';

/** Electron 的 Extension.path 是绝对路径；不以名称或大小写推断插件身份。 */
export function pathsMatch(firstPath, secondPath) {
    return typeof firstPath === 'string' && typeof secondPath === 'string' &&
        path.isAbsolute(firstPath) && path.isAbsolute(secondPath) &&
        path.resolve(firstPath) === path.resolve(secondPath);
}

function assertDirectoryWithoutLinks(directoryPath, includeChildren) {
    const stats = fs.lstatSync(directoryPath);
    if (stats.isSymbolicLink()) throw new Error('插件路径不能包含符号链接');
    if (!stats.isDirectory()) throw new Error('插件路径不是目录');
    if (!includeChildren) return;

    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const entryPath = path.join(directoryPath, entry.name);
        const entryStats = fs.lstatSync(entryPath);
        if (entryStats.isSymbolicLink()) throw new Error('插件目录不能包含符号链接');
        if (entryStats.isDirectory()) assertDirectoryWithoutLinks(entryPath, true);
    }
}

/** 只接受插件根目录下的实际一级目录名，禁止静默截取/修正输入。 */
export function getManagedExtensionPath(extensionsDirectory, directory, { mustExist = true } = {}) {
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('插件目录名不能为空');
    if (directory === '.' || directory === '..' || directory.includes('/') || directory.includes('\\') ||
        path.isAbsolute(directory) || path.basename(directory) !== directory) {
        throw new Error('插件目录必须是插件根目录下的一级目录名');
    }

    const root = path.resolve(extensionsDirectory);
    assertDirectoryWithoutLinks(root, false);
    const target = path.resolve(root, directory);
    if (path.dirname(target) !== root || target === root) throw new Error('插件目录超出管理范围');
    if (mustExist || fs.lstatSync(target, { throwIfNoEntry: false })) assertDirectoryWithoutLinks(target, true);
    return target;
}

/** ZIP 中的文件名使用 / 分隔，不能把越界条目转换成合法路径后继续安装。 */
export function getExtensionPackagePath(extensionPath, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') ||
        path.posix.isAbsolute(relativePath) || relativePath.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('插件包包含不安全的文件路径');
    }
    const root = path.resolve(extensionPath);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('插件包文件超出插件目录');
    }
    return target;
}

/** 将会话操作与 Electron 入口分离，便于用真实目录验证删除及异步清理边界。 */
export function createExtensionLifecycle({ extensionsDirectory, getSession, validateManifest, logger }) {
    let beforeUnload = null;
    let afterLoad = null;
    let lastLoadResults = [];

    function getLastLoadResults() {
        return lastLoadResults.map(result => ({ ...result }));
    }

    function setBeforeExtensionUnloadHook(hook) {
        if (hook !== null && typeof hook !== 'function') throw new TypeError('卸载前清理钩子必须是函数或 null');
        beforeUnload = hook;
    }

    function setAfterExtensionLoadHook(hook) {
        if (hook !== null && typeof hook !== 'function') throw new TypeError('加载后钩子必须是函数或 null');
        afterLoad = hook;
    }

    async function removeLoadedExtension(extension, reason) {
        if (beforeUnload) await beforeUnload(extension, reason);
        getSession().removeExtension(extension.id);
        if (getSession().getAllExtensions().some(item => item.id === extension.id)) {
            throw new Error('插件仍在会话中，卸载未完成');
        }
    }

    async function installExtension(extensionPath) {
        let extension;
        try {
            const validation = validateManifest(path.join(extensionPath, 'manifest.json'));
            if (!validation.valid) throw new Error(validation.error);
            extension = await getSession().loadExtension(extensionPath, { allowFileAccess: true });
            if (afterLoad) await afterLoad(extension);
            return { success: true, extension: { id: extension.id, name: extension.name, path: extension.path } };
        } catch (error) {
            let rollbackMessage = '';
            if (extension) {
                try {
                    await removeLoadedExtension(extension, 'unload');
                } catch (rollbackError) {
                    rollbackMessage = '；加载失败后的清理失败：' + rollbackError.message;
                }
            }
            logger.error('插件加载失败:', error);
            return { success: false, message: error.message + rollbackMessage };
        }
    }

    async function loadChromeExtensions() {
        const results = [];
        try {
            fs.mkdirSync(extensionsDirectory, { recursive: true });
            assertDirectoryWithoutLinks(extensionsDirectory, false);
            const directories = fs.readdirSync(extensionsDirectory, { withFileTypes: true })
                .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
                .map(entry => entry.name);

            for (const directory of directories) {
                let extensionPath = '';
                try {
                    extensionPath = getManagedExtensionPath(extensionsDirectory, directory);
                    const installed = await installExtension(extensionPath);
                    if (!installed.success) throw new Error(installed.message);
                    const extension = installed.extension;
                    results.push({ success: true, directory, path: extensionPath, id: extension.id, name: extension.name });
                    logger.info(`成功加载插件: ${extension.name} (${extension.id})`);
                } catch (error) {
                    results.push({ success: false, directory, path: extensionPath, message: error.message });
                    logger.error(`加载插件失败 ${directory}:`, error);
                }
            }
            lastLoadResults = results.map(result => ({ ...result }));
            return { success: results.every(result => result.success), results };
        } catch (error) {
            logger.error('扫描插件目录失败:', error);
            lastLoadResults = [
                ...results.map(result => ({ ...result })),
                { success: false, directory: '', path: extensionsDirectory, message: error.message }
            ];
            return { success: false, results, message: error.message };
        }
    }

    async function unloadChromeExtensions() {
        const results = [];
        try {
            for (const extension of getSession().getAllExtensions()) {
                try {
                    await removeLoadedExtension(extension, 'unload');
                    results.push({ success: true, id: extension.id, path: extension.path });
                } catch (error) {
                    results.push({ success: false, id: extension.id, path: extension.path, message: error.message });
                    logger.error(`卸载插件失败 ${extension.id}:`, error);
                }
            }
            return { success: results.every(result => result.success), results };
        } catch (error) {
            return { success: false, results, message: error.message };
        }
    }

    async function uninstallExtension(extensionId, directory = '') {
        let removedFromSession = false;
        let removedFiles = false;
        let targetPath = '';
        try {
            if (typeof extensionId !== 'string') throw new Error('插件 ID 必须是字符串');
            targetPath = getManagedExtensionPath(extensionsDirectory, directory);
            const loadedExtensions = getSession().getAllExtensions();
            const loadedAtPath = loadedExtensions.find(extension => pathsMatch(extension.path, targetPath));
            const loadedById = loadedExtensions.find(extension => extension.id === extensionId);
            if (extensionId && (!loadedById || !pathsMatch(loadedById.path, targetPath))) {
                throw new Error('插件 ID 与目录不匹配');
            }
            if (loadedAtPath && loadedAtPath.id !== extensionId) throw new Error('已加载插件的 ID 与目录不匹配');

            if (loadedAtPath) {
                // 清理失败时保留会话和文件；清理结束后再次验证，避免钩子改变删除目标。
                if (beforeUnload) await beforeUnload(loadedAtPath, 'uninstall');
                getManagedExtensionPath(extensionsDirectory, directory);
                const current = getSession().getAllExtensions().find(extension => pathsMatch(extension.path, targetPath));
                if (!current || current.id !== extensionId) throw new Error('清理期间插件身份发生变化');
                getSession().removeExtension(extensionId);
                if (getSession().getAllExtensions().some(extension => extension.id === extensionId)) {
                    throw new Error('插件仍在会话中，卸载未完成');
                }
                removedFromSession = true;
            }
            getManagedExtensionPath(extensionsDirectory, directory);
            fs.rmSync(targetPath, { recursive: true });
            removedFiles = true;
            return { success: true, removedFromSession, removedFiles, path: targetPath };
        } catch (error) {
            logger.error('卸载插件失败:', error);
            return { success: false, message: error.message, removedFromSession, removedFiles, path: targetPath };
        }
    }

    async function reloadExtensions() {
        const unloaded = await unloadChromeExtensions();
        if (!unloaded.success) {
            return { success: false, message: '插件清理失败，重新加载已停止', unloadResults: unloaded.results, results: [] };
        }
        const loaded = await loadChromeExtensions();
        return {
            ...loaded,
            unloadResults: unloaded.results,
            message: loaded.success ? '插件重新加载成功' : (loaded.message || '部分插件加载失败')
        };
    }

    return {
        loadChromeExtensions, unloadChromeExtensions, uninstallExtension, reloadExtensions, installExtension,
        setBeforeExtensionUnloadHook, setAfterExtensionLoadHook, getLastLoadResults
    };
}
