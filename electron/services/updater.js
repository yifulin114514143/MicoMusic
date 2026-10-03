import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { t } from '../language/i18n.js';

let silentCheck = false;
let suppressUpdateAvailableDialog = 0;
const latestReleaseUrl = 'https://api.github.com/repos/yifulin114514143/MicoMusic/releases/latest';
autoUpdater.autoDownload = false; // 自动下载更新
autoUpdater.autoInstallOnAppQuit = false; // 自动安装更新

function showUpdateUnavailableMessage() {
    dialog.showMessageBox({
        type: 'info',
        title: t('update-hint'),
        message: t('non-update'),
        buttons: [t('ok')]
    });
}

async function hasPublishedRelease() {
    const response = await fetch(latestReleaseUrl, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`);
    return true;
}

function showNoPublishedReleaseMessage() {
    dialog.showMessageBox({
        type: 'info',
        title: t('update-hint'),
        message: 'MicoMusic 尚未发布安装包，暂时无法在线更新。',
        buttons: [t('ok')]
    });
}
async function checkForUpdatesSilently() {
    suppressUpdateAvailableDialog += 1;
    try {
        return await autoUpdater.checkForUpdates();
    } finally {
        suppressUpdateAvailableDialog -= 1;
    }
}

// 正式安装包从 package.json 的 build.publish 读取更新源。
export function setupAutoUpdater(mainWindow) {
    autoUpdater.channel = 'latest';
    // 检查更新错误
    autoUpdater.on('error', (error) => {
        console.error('Update check failed:', error.message);
        mainWindow.webContents.send('update-error', {
            message: error.message
        });
        dialog.showMessageBox({
            type: 'error',
            message: error.message.includes('ETIMEDOUT')
                ? t('update-timeout')
                : (error.message || t('update-failed'))
        });
    });
    // 检查到新版本
    autoUpdater.on('update-available', (info) => {
        if (suppressUpdateAvailableDialog > 0) {
            return;
        }
        const notes = info.releaseNotes?.replace(/<[^>]*>/g, '') || t('no-release-notes');
        const msg = t('new-version-msg').replace('{version}', info.version).replace('{notes}', notes);
        dialog.showMessageBox({
            type: 'info',
            title: t('new-version'),
            message: msg,
            buttons: [t('update-now'), t('later')],
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });
    // 当前已是最新版本
    autoUpdater.on('update-not-available', () => {
        if (!silentCheck) {
            dialog.showMessageBox({
                type: 'info',
                title: t('update-hint'),
                message: t('already-latest'),
                buttons: [t('ok')]
            });
        }
    });
    // 更新下载进度
    autoUpdater.on('download-progress', (progressObj) => {
        mainWindow.setProgressBar(progressObj.percent / 100);
        mainWindow.webContents.send('update-progress', progressObj);
    });
    // 更新下载完成
    autoUpdater.on('update-downloaded', () => {
        mainWindow.setProgressBar(-1);
        mainWindow.webContents.send('update-downloaded');
        dialog.showMessageBox({
            type: 'info',
            title: t('update-ready'),
            message: t('update-ready-msg'),
            buttons: [t('install-now'), t('install-later')],
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                app.isQuitting = true;
                autoUpdater.quitAndInstall(true, true);
            }
        });
    });
}
// 检查更新
export async function checkForUpdates(silent = false) {
    silentCheck = silent;

    if (!autoUpdater.isUpdaterActive()) {
        if (!silent) {
            showUpdateUnavailableMessage();
        }
        return;
    }

    try {
        if (!await hasPublishedRelease()) {
            if (!silent) showNoPublishedReleaseMessage();
            return;
        }
    } catch (error) {
        console.error('MicoMusic release check error:', error);
        if (!silent) {
            dialog.showMessageBox({
                type: 'error',
                title: t('update-hint'),
                message: '无法读取 MicoMusic 发布信息，请稍后重试。',
                buttons: [t('ok')]
            });
        }
        return;
    }

    try {
        const result = await autoUpdater.checkForUpdates();
        if (!result && !silent) showUpdateUnavailableMessage();
    } catch (error) {
        console.error('Update check error:', error);
    }
}

export async function startUpdateDownload() {
    silentCheck = true;

    if (!autoUpdater.isUpdaterActive()) {
        return {
            success: false,
            reason: 'unsupported'
        };
    }

    try {
        if (!await hasPublishedRelease()) {
            return {
                success: false,
                reason: 'not-available'
            };
        }

        if (!autoUpdater.updateInfoAndProvider) {
            const result = await checkForUpdatesSilently();
            if (!result?.isUpdateAvailable) {
                return {
                    success: false,
                    reason: 'not-available'
                };
            }
        }

        await autoUpdater.downloadUpdate();
        return {
            success: true
        };
    } catch (error) {
        console.error('Start update download error:', error);
        return {
            success: false,
            reason: 'error',
            message: error?.message || String(error)
        };
    }
}
