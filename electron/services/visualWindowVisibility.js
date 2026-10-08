import { BrowserWindow, ipcMain } from 'electron';

let registered = false;
const visible = window => Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized());

// 新定义的只读视觉通知；禁用 Chromium 后台节流时仍使用原生窗口状态。
export function attachVisualWindowVisibility(window) {
    if (!registered) {
        ipcMain.handle('get-visual-window-visibility', event => visible(BrowserWindow.fromWebContents(event.sender)));
        registered = true;
    }
    const contents = window.webContents;
    const send = () => {
        if (!window.isDestroyed() && !contents.isDestroyed()) {
            contents.send('visual-window-visibility', visible(window));
        }
    };
    const events = ['show', 'hide', 'minimize', 'restore'];
    for (const name of events) window.on(name, send);
    contents.on('did-finish-load', send);
    window.once('closed', () => {
        for (const name of events) window.removeListener(name, send);
        contents.removeListener('did-finish-load', send);
    });
}
