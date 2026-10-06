import { app, ipcMain, BrowserWindow, screen, Tray, Menu, TouchBar, globalShortcut, dialog, shell, nativeImage } from 'electron';
import path from 'path';
import log from 'electron-log';
import Store from 'electron-store';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import fs from 'fs';
import { exec } from 'child_process';
import { checkForUpdates } from './services/updater.js';
import { Notification } from 'electron';
import { t } from './language/i18n.js';
import { bindExternalLinkHandler } from './services/externalLinkHandler.js';
import customTrayMenuService from './services/customTrayMenuService.js';
import { startLoopbackApi } from './services/loopbackApi.js';
import extensionManager from './extensions/extensionManager.js';
import { isBuiltinVisualPlugin, waitForVisualPluginReady } from './extensions/visualPluginHost.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new Store();
const { TouchBarLabel, TouchBarButton, TouchBarGroup, TouchBarSpacer } = TouchBar;
let mainWindow = null;
let apiProcess = null;
let runtimeApiBaseUrl = 'http://127.0.0.1:6521';
export const getRuntimeApiBaseUrl = () => runtimeApiBaseUrl;
ipcMain.on('get-api-base-url', event => { event.returnValue = runtimeApiBaseUrl; });
let tray = null;

// 创建主窗口
export function createWindow() {
    const savedConfig = store.get('settings');
    const useNativeTitleBar = savedConfig?.nativeTitleBar === 'on' ? true : false;
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    const windowWidth = Math.min(1200, screenWidth * 0.8);
    const windowHeight = Math.min(938, screenHeight * 0.9);
    const lastWindowState = store.get('windowState') || {};

    let x = lastWindowState.x;
    let y = lastWindowState.y;
    let width = lastWindowState.width || windowWidth;
    let height = lastWindowState.height || windowHeight;

    width = Math.min(width, screenWidth);
    height = Math.min(height, screenHeight);

    const isValidPosition = x !== undefined && y !== undefined &&
        x >= 0 && x <= screenWidth &&
        y >= 0 && y <= screenHeight;

    if (!isValidPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = Math.floor((screenHeight - height) / 2);
    }

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: 890,
        minHeight: 750,
        show: false,
        frame: useNativeTitleBar,
        titleBarStyle: useNativeTitleBar ? 'default' : 'hiddenInset',
        autoHideMenuBar: false, 
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            // 默认开启节流；用户在设置中开启该选项时禁用，以修复后台/最小化时 Web Audio 音效失效
            backgroundThrottling: savedConfig?.backgroundThrottling !== 'on',
            zoomFactor: 1.0
        },
        title: 'MicoMusic',
        icon: getIconPath('icon.ico')
    });
    bindExternalLinkHandler(mainWindow);

    // 隐藏菜单栏但保留默认菜单
    mainWindow.setMenuBarVisibility(false);

    if (store.get('maximize')) {
        mainWindow.maximize();
    }

    if (isDev) {
        mainWindow.loadURL('http://localhost:8080');
        mainWindow.webContents.openDevTools();
    } else {
        if (savedConfig?.networkMode == 'devnet') { //开发网
            mainWindow.loadURL('http://localhost:8080');
        } else { //主网；旧版 testnet 配置也使用本地页面
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
        }
    }

    mainWindow.webContents.on('dom-ready', () => {
        console.log('DOM Ready');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    const createdWindow = mainWindow;
    mainWindow.once('ready-to-show', async () => {
        const visual = extensionManager.getLoadedExtensions().find(isBuiltinVisualPlugin);
        try {
            if (visual) await waitForVisualPluginReady(createdWindow.webContents, visual.id);
        } catch (error) { log.warn('首屏主题未就绪，显示基础界面:', error.message); }
        if (!createdWindow.isDestroyed() && savedConfig?.startMinimized !== 'on') createdWindow.show();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Page Loaded Successfully');
        mainWindow.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
        if (!store.get('disclaimerAccepted')) {
            mainWindow.webContents.send('show-disclaimer');
        }
        mainWindow.webContents.send('version', app.getVersion());
    });

    mainWindow.on('close', (event) => {
        const savedConfig = store.get('settings');
        if (savedConfig?.minimizeToTray === 'off') {
            app.isQuitting = true;
            app.quit();
        }
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    if (process.platform === 'win32') {
        setThumbarButtons(mainWindow);
    }

    if (savedConfig?.desktopLyrics === 'on') {
        createLyricsWindow();
    }
    return mainWindow;
}

let lyricsWindow;

const persistLyricsWindowBounds = () => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    const { x, y, width, height } = lyricsWindow.getBounds();
    store.set('lyricsWindowPosition', { x, y });
    store.set('lyricsWindowSize', { width, height });
};

export function createLyricsWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const windowWidth = Math.floor(screenWidth * 0.7);
    const windowHeight = 128;
    const legacyWindowHeight = 200;

    const savedLyricsPosition = store.get('lyricsWindowPosition') || {};
    const savedLyricsSize = store.get('lyricsWindowSize') || {
        width: windowWidth,
        height: windowHeight
    };

    let x = savedLyricsPosition.x;
    let y = savedLyricsPosition.y;
    let width = savedLyricsSize.width || windowWidth;
    let height = savedLyricsSize.height || windowHeight;
    if (height === legacyWindowHeight) height = windowHeight;

    // 限制窗口尺寸不超过屏幕
    width = Math.min(width, screenWidth);
    height = Math.min(height, screenHeight);

    // 检查位置是否有效
    const isValidPosition = x !== undefined && y !== undefined &&
        x >= 0 && x <= screenWidth &&
        y >= 0 && y <= screenHeight;

    // 如果位置无效，设置默认位置
    if (!isValidPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = screenHeight - height;
    }

    lyricsWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: 800,
        minHeight: windowHeight,
        maxWidth: screenWidth,
        maxHeight: screenHeight,
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        resizable: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            backgroundThrottling: false,
            zoomFactor: 1.0
        }
    });

    lyricsWindow.on('resize', persistLyricsWindowBounds);
    lyricsWindow.on('move', persistLyricsWindowBounds);
    mainWindow.lyricsWindow = lyricsWindow;
    lyricsWindow.on('closed', () => {
        mainWindow.lyricsWindow = null;
    });
    if (isDev) {
        lyricsWindow.loadURL('http://localhost:8080/#/lyrics');
        lyricsWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        lyricsWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'lyrics'
        });
    }



    // 设置窗口置顶级别
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 允许窗口透明
    lyricsWindow.setBackgroundColor('#00000000');
}

export function createMvWindow() {
    const { screenWidth, screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    return new BrowserWindow({
        width: Math.min(screenWidth * 0.8, 1280),
        height: Math.min(screenHeight * 0.8, 720),
        frame: false,
        transparent: true,
        show: false,
        titleBarStyle: 'hiddenInset',
        autoHideMenuBar: true,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            zoomFactor: 1.0,
            devTools: isDev
        },
        icon: getIconPath('icon.ico')
    });
}

const getIconPath = (iconName, subPath = '') => path.join(
    isDev ? __dirname + '/../build/icons' : process.resourcesPath + '/icons',
    subPath,
    iconName
);

export function getTray() {
    return tray;
}

// 创建托盘图标及菜单
export function createTray(mainWindow, title = '') {
    if (tray && title) {
        tray.setToolTip(title);
        return tray;
    }

    let trayIconName
    if (process.platform === 'linux') {
        trayIconName = 'logo.png'
    } else if (process.platform === 'darwin') {
        trayIconName = 'mico-trayTemplate.png'
    } else {
        trayIconName = 'icon.ico'
    }

    const trayImage = nativeImage.createFromPath(getIconPath(trayIconName));
    if (process.platform === 'darwin') trayImage.setTemplateImage(true);
    tray = new Tray(trayImage);
    tray.setToolTip('MicoMusic');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: t('show-hide'),
            accelerator: 'CmdOrCtrl+Shift+S',
            icon: getIconPath('show.png', 'menu'),
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                    }
                }
            }
        },
        { type: 'separator' },
        {
            label: t('prev-track'),
            icon: getIconPath('prev.png', 'menu'),
            accelerator: 'Alt+CommandOrControl+Left',
            click: () => {
                mainWindow.webContents.send('play-previous-track');
            }
        },
        {
            label: t('pause'),
            accelerator: 'Alt+CommandOrControl+Space',
            icon: getIconPath('play.png', 'menu'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
            }
        },
        {
            label: t('next-track'),
            accelerator: 'Alt+CommandOrControl+Right',
            icon: getIconPath('next.png', 'menu'),
            click: () => {
                mainWindow.webContents.send('play-next-track');
            }
        },
        { type: 'separator' },
        {
            label: t('project-home'),
            icon: getIconPath('home.png', 'menu'),
            click: () => {
                shell.openExternal('https://github.com/yifulin114514143/MicoMusic');
            }
        },
        {
            label: t('report-bug'),
            icon: getIconPath('bug.png', 'menu'),
            click: () => {
                shell.openExternal('https://github.com/yifulin114514143/MicoMusic/issues');
            }
        },
        {
            label: t('check-updates'),
            icon: getIconPath('update.png', 'menu'),
            click: () => {
                checkForUpdates(false);
            }
        },
        {
            label: t('restart-app'),
            icon: getIconPath('restart.png', 'menu'),
            click: () => {
                app.relaunch();
                app.isQuitting = true;
                app.quit();
            }
        },
        { type: 'separator' },
        {
            label: t('quit'),
            accelerator: 'CmdOrCtrl+Q',
            icon: getIconPath('quit.png', 'menu'),
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    const useCustomTrayMenu = !!mainWindow && store.get('settings')?.customTrayMenu === 'custom';
    const useLinuxCustomTrayMenu = process.platform === 'linux' && useCustomTrayMenu;
    switch (process.platform) {
        case 'linux':
            if (useLinuxCustomTrayMenu) {
                tray.on('click', () => {
                    void customTrayMenuService.toggle();
                });
                break;
            }
            customTrayMenuService.hide();
            tray.setContextMenu(contextMenu);
            break;
        default:
            tray.on('right-click', () => {
                if (useCustomTrayMenu) {
                    void customTrayMenuService.toggle();
                    return;
                }
                customTrayMenuService.hide();
                tray.popUpContextMenu(contextMenu);
            });
    }
    if (!useLinuxCustomTrayMenu) {
        tray.on('click', () => {
            customTrayMenuService.hide();
            if (!mainWindow.isVisible()) {
                mainWindow.show();
            } else if (!mainWindow.isFocused()) {
                mainWindow.show();
                mainWindow.focus();
            } else {
                mainWindow.hide(); //大概率永远不会执行
            }
        });
        tray.on('double-click', () => {
            customTrayMenuService.hide();
            mainWindow.show();
        });
    }
    return tray;
}

// 创建 TouchBar
export function createTouchBar(mainWindow) {
    const ICON_SIZE = 16;

    let isPlaying = false;

    const iconPath = (iconName) => {
        const originalIcon = nativeImage.createFromPath(
            getIconPath(`${iconName}.png`)
        );

        // 调整图标大小
        return originalIcon.resize({
            width: ICON_SIZE,
            height: ICON_SIZE,
        });
    };

    const prevButton = new TouchBarButton({
        icon: iconPath("prev"),
        iconPosition: "center",
        click: () => {
            mainWindow.webContents.send("play-previous-track");
        },
    });

    const playPauseButton = new TouchBarButton({
        icon: iconPath(isPlaying ? "pause" : "play"),
        iconPosition: "center",
        click: () => {
            isPlaying = !isPlaying;
            playPauseButton.icon = iconPath(isPlaying ? "pause" : "play");
            mainWindow.webContents.send("toggle-play-pause");
        },
    });

    const nextButton = new TouchBarButton({
        icon: iconPath("next"),
        iconPosition: "center",
        click: () => {
            mainWindow.webContents.send("play-next-track");
        },
    });

    // 歌词
    const lyricsLabel = new TouchBarLabel({
        label: t('no-lyrics'),
        textColor: "#FFFFFF",
    });

    const touchBar = new TouchBar({
        items: [
            prevButton,
            new TouchBarSpacer({ size: "small" }),
            playPauseButton,
            new TouchBarSpacer({ size: "small" }),
            nextButton,
            new TouchBarSpacer({ size: "flexible" }),
            lyricsLabel,
            new TouchBarSpacer({ size: "flexible" }),
        ],
    });

    mainWindow.setTouchBar(touchBar);

    // 监听播放状态变化
    ipcMain.on("play-pause-action", (event, playing) => {
        isPlaying = playing;
        playPauseButton.icon = iconPath(isPlaying ? "pause" : "play");
    });

    // 监听歌词更新
    ipcMain.on("update-current-lyrics", (event, currentLyric) => {
        if (currentLyric) {
            lyricsLabel.label = currentLyric;
        }
    });

    return touchBar;
}

// 启动独立的内置 API；开发模式由 npm run api 提供固定端口。
export async function startApiServer() {
    if (isDev) return;
    const filenames = { win32: 'app_win.exe', darwin: 'app_macos', linux: 'app_linux' };
    const filename = filenames[process.platform];
    if (!filename) throw new Error(`Unsupported platform: ${process.platform}`);
    const apiPath = path.join(process.resourcesPath, '../api', filename);
    if (!fs.existsSync(apiPath)) throw new Error(`API可执行文件未找到：${apiPath}`);
    const savedConfig = store.get('settings') || {};
    const args = [];
    if ((savedConfig.dataSource || 'concept') === 'concept') args.push('--platform=lite');
    if (savedConfig.proxy === 'on' && savedConfig.proxyUrl) {
        const proxyAddress = String(savedConfig.proxyUrl).trim();
        if (proxyAddress) args.push(`--proxy=${proxyAddress}`);
    }
    const result = await startLoopbackApi(apiPath, args, {
        cwd: app.getPath('userData'),
        onOutput: (output, isError) => isError ? log.error(output) : log.info(output)
    });
    apiProcess = result.child;
    runtimeApiBaseUrl = result.baseUrl;
    log.info(`MicoMusic 内置 API 地址: ${runtimeApiBaseUrl}`);
    apiProcess.on('close', code => log.info(`API 关闭，退出码: ${code}`));
}

// 只终止 MicoMusic 创建的子进程，不按固定端口关闭其他应用。
export function stopApiServer() {
    if (apiProcess) {
        apiProcess.kill();
        apiProcess = null;
    }
}

// 注册快捷键
export function registerShortcut() {
    try {
        const settings = store.get('settings');
        globalShortcut.unregisterAll();
        let clickFunc = () => { app.isQuitting = true; };
        if (process.platform === 'darwin') {
            app.on('before-quit', clickFunc);
        } else {
            clickFunc = () => {
                app.isQuitting = true;
                app.quit();
            };
            if (settings?.shortcuts?.quitApp) {
                globalShortcut.register(settings?.shortcuts?.quitApp, clickFunc);
            } else if (!settings?.shortcuts) {
                globalShortcut.register('CmdOrCtrl+Q', clickFunc);
            }
        }

        clickFunc = () => {
            if (mainWindow) {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                }
            }
        }
        if (settings?.shortcuts?.mainWindow) {
            globalShortcut.register(settings?.shortcuts?.mainWindow, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('CmdOrCtrl+Shift+S', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('play-previous-track');
        if (settings?.shortcuts?.prevTrack) {
            globalShortcut.register(settings?.shortcuts?.prevTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Left', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('play-next-track');
        if (settings?.shortcuts?.nextTrack) {
            globalShortcut.register(settings?.shortcuts?.nextTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Right', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('volume-up');
        if (settings?.shortcuts?.volumeUp) {
            globalShortcut.register(settings?.shortcuts?.volumeUp, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Up', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('volume-down');
        if (settings?.shortcuts?.volumeDown) {
            globalShortcut.register(settings?.shortcuts?.volumeDown, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Down', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-play-pause');
        if (settings?.shortcuts?.playPause) {
            globalShortcut.register(settings?.shortcuts?.playPause, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Space', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-mute');
        if (settings?.shortcuts?.mute) {
            globalShortcut.register(settings?.shortcuts?.mute, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+M', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-like');
        if (settings?.shortcuts?.like) {
            globalShortcut.register(settings?.shortcuts?.like, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+L', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-mode');
        if (settings?.shortcuts?.mode) {
            globalShortcut.register(settings?.shortcuts?.mode, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+P', clickFunc);
        }

        clickFunc = () => {
            if (mainWindow.lyricsWindow) {
                mainWindow.lyricsWindow.close();
                mainWindow.lyricsWindow = null;
                new Notification({
                    title: t('desktop-lyrics-closed'),
                    icon: getIconPath('logo.png')
                }).show();
                syncDesktopLyricsSetting('off');
            } else {
                createLyricsWindow();
                syncDesktopLyricsSetting('on');
            }
        }
        if (settings?.shortcuts?.toggleDesktopLyrics) {
            globalShortcut.register(settings.shortcuts.toggleDesktopLyrics, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+Ctrl+D', clickFunc);
        }
    } catch {
        dialog.showMessageBox({
            type: 'error',
            title: t('hint'),
            message: t('shortcut-failed'),
            buttons: [t('ok')]
        });
    }
}

const syncDesktopLyricsSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopLyrics: value
    });
};

// 播放启动问候语
export function playStartupSound() {
    const savedConfig = store.get('settings');
    if (!savedConfig || (savedConfig['greetings'] !== 'on' && savedConfig['greetings'] !== 'null')) {
        return;
    }
    const audioFiles = [
        '/assets/sound/yise-jp.mp3',
        '/assets/sound/qiqi-jp.mp3',
        '/assets/sound/qiqi-zh.mp3'
    ];
    const randomIndex = Math.floor(Math.random() * audioFiles.length);
    const soundPath = isDev
        ? path.join(__dirname, '..', 'public', audioFiles[randomIndex])
        : path.join(process.resourcesPath, 'public', audioFiles[randomIndex]);
    try {
        switch (process.platform) {
            case 'win32':
                const escapedPath = soundPath.replace(/'/g, "''");
                exec(`powershell -c "Add-Type -AssemblyName PresentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open('${escapedPath}'); $player.Play(); Start-Sleep -s 3; $player.Stop()"`);
                break;
            case 'darwin':
                exec(`afplay "${soundPath}"`);
                break;
            case 'linux':
                exec(`paplay "${soundPath}"`, (error) => {
                    if (error) {
                        exec(`play "${soundPath}"`);
                    }
                });
                break;
        }
    } catch (error) {
        log.error('播放启动问候语失败:', error);
    }
}

// 设置任务栏缩略图工具栏
export function setThumbarButtons(mainWindow, isPlaying = false) {
    const buttons = [
        {
            tooltip: t('prev-track'),
            icon: getIconPath('prev.png'),
            click: () => {
                mainWindow.webContents.send('play-previous-track');
                setThumbarButtons(mainWindow, true);
            }
        },
        {
            tooltip: t('pause'),
            icon: getIconPath('pause.png'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
                setThumbarButtons(mainWindow, false);
            }
        },
        {
            tooltip: t('next-track'),
            icon: getIconPath('next.png'),
            click: () => {
                mainWindow.webContents.send('play-next-track');
                setThumbarButtons(mainWindow, true);
            }
        }
    ];

    if (!isPlaying) {
        buttons[1] = {
            tooltip: t('play'),
            icon: getIconPath('play.png'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
                setThumbarButtons(mainWindow, true);
            }
        };
    }

    mainWindow.setThumbarButtons(buttons);
}
