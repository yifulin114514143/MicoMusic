import { app, ipcMain } from 'electron';
import { APP_PROTOCOL } from './identityConfig.js';
import { createDeepLinkQueue } from './deepLinks.js';

let mainWindow = null;
const queue = createDeepLinkQueue(params => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('url-params', params);
});

function focusWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function handleArgv(argv) {
    for (const arg of argv) queue.receive(arg);
}

// 在 app.ready 前调用一次，接收 macOS 冷启动 URL 和 Windows/Linux 第二实例 URL。
export function initializeProtocolHandler() {
    handleArgv(process.argv);
    app.on('second-instance', (_event, commandLine) => {
        focusWindow();
        handleArgv(commandLine);
    });
    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (queue.receive(url)) focusWindow();
    });
    ipcMain.on('protocol-ready', event => {
        if (mainWindow && event.sender === mainWindow.webContents) queue.setReady(true);
    });
    // 开发进程不注册系统协议，避免把协议关联到临时 Electron 路径。
    if (app.isPackaged) app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

export function attachProtocolWindow(window) {
    mainWindow = window;
    queue.setReady(false);
    window.webContents.on('did-start-loading', () => queue.setReady(false));
}
