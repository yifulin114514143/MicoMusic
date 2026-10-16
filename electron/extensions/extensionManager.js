import { session, app } from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import AdmZip from 'adm-zip';
import { validateNativeHostManifest } from './nativeHostManager.js';
import { createExtensionLifecycle, getManagedExtensionPath, getExtensionPackagePath, pathsMatch } from './extensionLifecycle.js';

export { pathsMatch } from './extensionLifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chrome 插件管理 - 根据环境选择正确的路径
const EXTENSIONS_DIR = !isDev
    ? path.join(app.getPath('userData'), 'extensions')
    : path.join(__dirname, '../../plugins/extensions');

const lifecycle = createExtensionLifecycle({
    extensionsDirectory: EXTENSIONS_DIR,
    getSession: () => session.defaultSession,
    validateManifest,
    logger: log
});

// 所有卸载路径都先等待插件清理，然后移除 Electron 会话。
export const loadChromeExtensions = lifecycle.loadChromeExtensions;
export const unloadChromeExtensions = lifecycle.unloadChromeExtensions;
export const uninstallExtension = lifecycle.uninstallExtension;
export const reloadExtensions = lifecycle.reloadExtensions;
export const setBeforeExtensionUnloadHook = lifecycle.setBeforeExtensionUnloadHook;
export const setAfterExtensionLoadHook = lifecycle.setAfterExtensionLoadHook;
export const getLastLoadResults = lifecycle.getLastLoadResults;

/**
 * 获取已加载的插件列表
 */
export function getLoadedExtensions() {
    try {
        return session.defaultSession.getAllExtensions();
    } catch (error) {
        log.error('获取插件列表失败:', error);
        return [];
    }
}

/**
 * 安装单个插件
 * @param {string} extensionPath 插件路径
 */
export const installExtension = lifecycle.installExtension;

/**
 * 获取插件目录路径
 */
export function getExtensionsDirectory() {
    return EXTENSIONS_DIR;
}

/**
 * 检查插件目录是否存在
 */
export function ensureExtensionsDirectory() {
    if (!fs.existsSync(EXTENSIONS_DIR)) {
        fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
        log.info('创建插件目录:', EXTENSIONS_DIR);
    }
    return EXTENSIONS_DIR;
}

/**
 * 验证插件清单文件
 * @param {string} manifestPath manifest.json 文件路径
 */
export function validateManifest(manifestPath) {
    try {
        if (!fs.existsSync(manifestPath)) {
            return { valid: false, error: 'manifest.json 文件不存在' };
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        // 检查必需字段
        const requiredFields = ['manifest_version', 'name', 'version'];
        for (const field of requiredFields) {
            if (!manifest[field]) {
                return { valid: false, error: `缺少必需字段: ${field}` };
            }
        }

        // 检查 manifest 版本
        if (manifest.manifest_version !== 3) {
            return { valid: false, error: '仅支持 Manifest V3 格式' };
        }

        // Native Host 是本地进程能力，必须在 manifest 校验阶段先拦截不安全声明。
        const nativeHostError = validateNativeHostManifest(manifest);
        if (nativeHostError) {
            return { valid: false, error: nativeHostError };
        }

        return { valid: true, manifest };
    } catch (error) {
        return { valid: false, error: `解析 manifest.json 失败: ${error.message}` };
    }
}

function getExtensionPopupPath(manifest) {
    const popupPath = manifest?.action?.default_popup || '';

    return typeof popupPath === 'string' ? popupPath.trim() : '';
}

function hasExtensionPopupFile(extensionPath, manifest) {
    const popupPath = getExtensionPopupPath(manifest);
    if (!popupPath) {
        return false;
    }

    const normalizedPopupPath = popupPath.replace(/[\\/]+/g, path.sep);
    const fullPopupPath = path.join(extensionPath, normalizedPopupPath);
    return fs.existsSync(fullPopupPath);
}

/**
 * 获取插件详细信息
 * @param {string} extensionDir 插件目录名
 */
export function getExtensionInfo(extensionDir) {
    let extensionPath;
    try {
        extensionPath = getManagedExtensionPath(EXTENSIONS_DIR, extensionDir);
    } catch (error) {
        return { error: error.message };
    }
    const manifestPath = path.join(extensionPath, 'manifest.json');
    
    const validation = validateManifest(manifestPath);
    if (!validation.valid) {
        return { error: validation.error };
    }

    const manifest = validation.manifest;
    const stats = fs.statSync(extensionPath);
    const popupPath = getExtensionPopupPath(manifest);
    const hasPopup = hasExtensionPopupFile(extensionPath, manifest);
    
    return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description || '',
        author: manifest.author || '',
        permissions: manifest.permissions || [],
        path: extensionPath,
        size: getDirectorySize(extensionPath),
        lastModified: stats.mtime,
        manifest: manifest,
        popupPath,
        hasPopup
    };
}

/**
 * 获取目录大小
 * @param {string} dirPath 目录路径
 */
function getDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
        const files = fs.readdirSync(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            
            if (stats.isDirectory()) {
                totalSize += getDirectorySize(filePath);
            } else {
                totalSize += stats.size;
            }
        }
    } catch (error) {
        log.error('计算目录大小失败:', error);
    }
    
    return totalSize;
}

/**
 * 从zip文件安装插件
 * @param {string} zipPath zip文件路径
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function installPluginFromZip(zipPath) {
    try {
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // 确保插件目录存在
        ensureExtensionsDirectory();

        // 查找包含 manifest.json 的第一级目录
        let pluginEntry = null;
        let manifestEntry = null;
        for (const entry of zipEntries) {
            const parts = entry.entryName.split('/');
            if (parts.length === 2 && parts[1] === 'manifest.json') {
                manifestEntry = entry;
                pluginEntry = parts[0];
                break;
            }
        }

        if (!manifestEntry || !pluginEntry) {
            return { success: false, message: '无效的插件包格式：未找到 manifest.json' };
        }

        // 验证 manifest
        const manifestContent = zip.readAsText(manifestEntry);
        try {
            const manifest = JSON.parse(manifestContent);
            // 直接验证 manifest 对象而不是文件路径
            if (!manifest.manifest_version || !manifest.name || !manifest.version) {
                return { success: false, message: '清单文件缺少必需字段' };
            }
            if (manifest.manifest_version !== 3) {
                return { success: false, message: '仅支持 Manifest V3 格式' };
            }
            // zip 安装也走同一套 Native Host 校验，避免远程插件绕过权限声明。
            const nativeHostError = validateNativeHostManifest(manifest);
            if (nativeHostError) {
                return { success: false, message: nativeHostError };
            }
        } catch (error) {
            return { success: false, message: `manifest.json 解析失败: ${error.message}` };
        }

        // 保留既有 -main 包目录兼容行为；实际删除和写入路径必须先验证。
        const pluginName = pluginEntry.replace(/-main$/, '');
        const targetDir = getManagedExtensionPath(EXTENSIONS_DIR, pluginName, { mustExist: false });
        const packageFiles = zipEntries
            .filter(entry => entry.entryName.startsWith(pluginEntry + '/'))
            .map(entry => ({ entry, relativePath: entry.entryName.substring(pluginEntry.length + 1) }))
            .filter(item => item.relativePath);
        for (const item of packageFiles) {
            getExtensionPackagePath(targetDir, item.relativePath);
            // 先读取校验内容，损坏的 ZIP 不得在发现错误前删除现有插件。
            if (!item.entry.isDirectory) item.data = item.entry.getData();
        }

        // 更新也经过同一异步清理入口，失败时保留原插件，不继续覆盖。
        if (fs.existsSync(targetDir)) {
            const loaded = getLoadedExtensions().find(extension => pathsMatch(extension.path, targetDir));
            const result = await uninstallExtension(loaded?.id || '', pluginName);
            if (!result.success) return { success: false, message: '更新前卸载失败：' + result.message };
        }

        // 清理钩子返回后重新验证路径，避免目标被替换成符号链接。
        getManagedExtensionPath(EXTENSIONS_DIR, pluginName, { mustExist: false });
        fs.mkdirSync(targetDir);
        for (const { entry, relativePath, data } of packageFiles) {
            const targetPath = getExtensionPackagePath(targetDir, relativePath);
            if (entry.isDirectory) {
                fs.mkdirSync(targetPath, { recursive: true });
            } else {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, data);
            }
        }

        // 加载新插件
        const result = await installExtension(targetDir);
        if (!result.success) {
            // 如果加载失败，清理已解压的文件
            if (getLoadedExtensions().some(extension => pathsMatch(extension.path, targetDir))) {
                return { success: false, message: '插件加载失败，清理未完成，已保留插件文件：' + result.message };
            }
            if (fs.existsSync(targetDir)) {
                getManagedExtensionPath(EXTENSIONS_DIR, pluginName);
                fs.rmSync(targetDir, { recursive: true });
            }
            return { success: false, message: '插件加载失败：' + result.message };
        }

        return { 
            success: true, 
            message: `插件安装成功`,
            extension: result.extension
        };
    } catch (error) {
        log.error('安装插件失败:', error);
        return { success: false, message: '安装插件失败：' + error.message };
    }
}

/**
 * Download a zip package and install or update a plugin from a remote URL.
 * @param {string} downloadUrl
 * @param {string} extensionId
 * @param {string} extensionDir
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function installPluginFromUrl(downloadUrl, extensionId = '', extensionDir = '') {
    const tempZipPath = path.join(app.getPath('temp'), `moekoe-plugin-${Date.now()}.zip`);

    try {
        if (!downloadUrl || typeof downloadUrl !== 'string') {
            return { success: false, message: 'Invalid plugin download url' };
        }

        const response = await fetch(downloadUrl);
        if (!response.ok) {
            return {
                success: false,
                message: `Failed to download plugin package: ${response.status} ${response.statusText || ''}`.trim()
            };
        }

        const arrayBuffer = await response.arrayBuffer();
        const zipBuffer = Buffer.from(arrayBuffer);

        if (!isZipBuffer(zipBuffer)) {
            return { success: false, message: '下载内容不是有效的 zip 插件包' };
        }

        fs.writeFileSync(tempZipPath, zipBuffer);

        if (extensionId || extensionDir) {
            const uninstallResult = await uninstallExtension(extensionId, extensionDir);
            if (!uninstallResult.success) {
                return { success: false, message: '更新前卸载失败：' + uninstallResult.message };
            }
        }

        return await installPluginFromZip(tempZipPath);
    } catch (error) {
        log.error('Failed to install plugin from url:', error);
        return { success: false, message: error.message };
    } finally {
        if (fs.existsSync(tempZipPath)) {
            fs.rmSync(tempZipPath, { force: true });
        }
    }
}

function isZipBuffer(buffer) {
    return Boolean(buffer) &&
        buffer.length >= 4 &&
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (
            (buffer[2] === 0x03 && buffer[3] === 0x04) ||
            (buffer[2] === 0x05 && buffer[3] === 0x06) ||
            (buffer[2] === 0x07 && buffer[3] === 0x08)
        );
}

/**
 * 格式化文件大小
 * @param {number} bytes 字节数
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 扫描并获取所有插件信息
 */
export function scanExtensions() {
    ensureExtensionsDirectory();
    
    try {
        const extensionDirs = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        const extensions = [];
        
        for (const extensionDir of extensionDirs) {
            const info = getExtensionInfo(extensionDir);
            if (!info.error) {
                extensions.push({
                    ...info,
                    directory: extensionDir,
                    installed: isExtensionInstalled(info.path)
                });
            } else {
                log.warn(`插件 ${extensionDir} 信息获取失败:`, info.error);
            }
        }
        
        return extensions;
    } catch (error) {
        log.error('扫描插件失败:', error);
        return [];
    }
}

/**
 * 检查插件是否已安装
 * @param {string} extensionPath 插件绝对路径
 */
function isExtensionInstalled(extensionPath) {
    try {
        const loadedExtensions = getLoadedExtensions();
        return loadedExtensions.some(ext => pathsMatch(ext.path, extensionPath));
    } catch (error) {
        return false;
    }
}

// 默认导出所有功能
export default {
    loadChromeExtensions,
    unloadChromeExtensions,
    setBeforeExtensionUnloadHook,
    setAfterExtensionLoadHook,
    getLastLoadResults,
    pathsMatch,
    getLoadedExtensions,
    installExtension,
    uninstallExtension,
    reloadExtensions,
    getExtensionsDirectory,
    ensureExtensionsDirectory,
    validateManifest,
    getExtensionInfo,
    formatFileSize,
    scanExtensions,
    installPluginFromZip,
    installPluginFromUrl
};
