import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getManagedExtensionPath } from './extensionLifecycle.js';

// 以下标识是 MicoMusic 新定义的内置视觉插件契约。
export const BUILTIN_VISUAL_ID = 'mico-liquid-glass';
export const BUILTIN_VISUAL_DIRECTORY = 'mico-liquid-glass';

function payload(directory) {
    const directoryStats = fs.lstatSync(directory);
    if (directoryStats.isSymbolicLink()) throw new Error('内置主题资源目录不能是符号链接');
    if (!directoryStats.isDirectory()) throw new Error('内置主题资源路径不是目录');
    const files = [];
    const visit = (relative = '') => {
        for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : (a.name > b.name ? 1 : 0))) {
            const child = path.join(relative, entry.name);
            if (entry.isSymbolicLink()) throw new Error('内置主题资源不能包含符号链接');
            if (entry.isDirectory()) visit(child);
            else if (entry.isFile()) files.push(child);
            else throw new Error('内置主题资源只能包含普通文件');
        }
    };
    visit();
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    if (!manifest || manifest.manifest_version !== 3 || manifest.plugin_id !== BUILTIN_VISUAL_ID ||
        typeof manifest.name !== 'string' || !manifest.name || typeof manifest.version !== 'string' || !manifest.version) {
        throw new Error('内置液态玻璃主题清单无效');
    }
    const hash = createHash('sha256');
    for (const file of files) {
        const content = fs.readFileSync(path.join(directory, file));
        // 明确编码文件名和内容长度，避免多个文件的连接边界影响资源身份。
        hash.update(file); hash.update('\0'); hash.update(String(content.length)); hash.update('\0'); hash.update(content);
    }
    return { fingerprint: hash.digest('hex'), version: manifest.version };
}

export function createBuiltinVisualPluginFiles({ sourceDirectory, extensionsDirectory, getState, setState }) {
    const target = () => getManagedExtensionPath(extensionsDirectory, BUILTIN_VISUAL_DIRECTORY, { mustExist: false });
    function prepare({ restore = false } = {}) {
        let staging = '';
        let backup = '';
        let committed = false;
        let result;
        try {
            const state = getState() || {};
            if (state.removed === true && !restore) return { success: true, skipped: true, removed: true };
            const saveState = resource => {
                try {
                    setState({ ...state, removed: false, ...resource });
                } catch (error) {
                    // 某些存储实现会写入后才报错；尝试恢复原有卸载/版本选择。
                    try { setState(state); } catch (rollbackError) {
                        throw new Error(error.message + '；元数据恢复失败：' + rollbackError.message);
                    }
                    throw error;
                }
            };
            const resource = payload(sourceDirectory);
            fs.mkdirSync(extensionsDirectory, { recursive: true });
            const installedPath = target();
            if (fs.existsSync(installedPath) && !state.fingerprint) throw new Error('内置主题目录已被其他安装占用，未覆盖现有文件');
            if (fs.existsSync(installedPath) && payload(installedPath).fingerprint === resource.fingerprint) {
                if (state.removed !== false || state.fingerprint !== resource.fingerprint || state.version !== resource.version) saveState(resource);
                return { success: true, path: installedPath, updated: false, ...resource };
            }
            // 同一父目录保留 rename 的原子替换；临时文件及回滚备份不会被扩展扫描器加载。
            const transactionDirectory = path.dirname(path.resolve(extensionsDirectory));
            staging = fs.mkdtempSync(path.join(transactionDirectory, '.mico-visual-stage-'));
            fs.cpSync(sourceDirectory, staging, { recursive: true });
            if (payload(staging).fingerprint !== resource.fingerprint) throw new Error('内置主题资源复制不完整');
            if (fs.existsSync(installedPath)) {
                backup = fs.mkdtempSync(path.join(transactionDirectory, '.mico-visual-backup-'));
                fs.rmdirSync(backup);
                fs.renameSync(installedPath, backup);
            }
            try {
                fs.renameSync(staging, installedPath);
                staging = '';
                saveState(resource);
            } catch (error) {
                if (backup) {
                    try {
                        if (fs.existsSync(installedPath)) fs.rmSync(installedPath, { recursive: true });
                        fs.renameSync(backup, installedPath); backup = '';
                    } catch (rollbackError) {
                        throw new Error(error.message + '；旧版恢复失败，备份保留在 ' + backup + '：' + rollbackError.message);
                    }
                } else if (fs.existsSync(installedPath)) fs.rmSync(installedPath, { recursive: true });
                throw error;
            }
            committed = true;
            result = { success: true, path: installedPath, updated: true, ...resource };
        } catch (error) {
            result = { success: false, message: error.message };
        } finally {
            for (const temporary of [staging, committed ? backup : ''].filter(Boolean)) {
                try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (error) {
                    if (result) result.cleanupMessage = '临时目录清理失败，已保留 ' + temporary + '：' + error.message;
                }
            }
        }
        return result;
    }
    function markUninstalled() { setState({ ...(getState() || {}), removed: true }); }
    return { prepare, markUninstalled, getState: () => getState() || {} };
}
