import { app, BrowserWindow, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const [profile, mode, apiBinary] = process.argv.slice(2);
assert.ok(profile && path.resolve(profile).startsWith(path.join(root, 'artifacts/phase2-runtime') + path.sep));
assert.ok(['capabilities', 'persistence', 'manual'].includes(mode));
const evidence = path.join(root, 'docs/phase2/evidence');
for (const name of ['logs', 'temp']) fs.mkdirSync(path.join(profile, name), { recursive: true });
app.setName('MicoMusic 阶段二验证');
app.setPath('userData', profile);
app.setPath('logs', path.join(profile, 'logs'));
app.setPath('temp', path.join(profile, 'temp'));
const report = {
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    platform: process.platform,
    timestamp: new Date().toISOString(),
    mode, checks: [], observations: {},
    scope: '真实生产 Vue 页面、真实扩展管理器与 IPC；隔离宿主不实现完整播放器主进程'
};
const check = (name, condition, detail = null) => {
    assert.ok(condition, name + (detail ? ': ' + JSON.stringify(detail) : ''));
    report.checks.push({ name, passed: true, detail });
    console.log('通过：' + name);
};
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
const waitFor = async (fn, label, timeout = 15000) => {
    const start = Date.now();
    let value;
    while (Date.now() - start < timeout) {
        value = await fn();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error('等待超时：' + label);
};
const state = win => evaluate(win, `JSON.parse(document.documentElement.getAttribute('data-phase2-probe') || 'null')`);
const styles = (win, selector) => evaluate(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const computed = getComputedStyle(element);
    return { proof: computed.getPropertyValue('--mico-phase2-css-proof').trim(),
        backdropFilter: computed.backdropFilter, background: computed.backgroundColor,
        radius: computed.borderRadius, outsideApp: !element.closest('#app') };
})()`);
const probeStyle = async (win, selector, name) => {
    const result = await waitFor(() => styles(win, selector), name);
    check(name, result.proof === 'applied' && result.backdropFilter === 'blur(12px)', result);
    return result;
};
const navigate = async (win, route, selector) => {
    await evaluate(win, `location.hash = ${JSON.stringify('#' + route)}`);
    if (selector) await waitFor(() => evaluate(win, `Boolean(document.querySelector(${JSON.stringify(selector)}))`), route);
};
const command = (win, settings) => evaluate(win, `window.dispatchEvent(new CustomEvent('phase2-audit-command', {
    detail: ${JSON.stringify(JSON.stringify(settings))}
}))`);
const capture = async (win, name) => {
    await waitFor(() => evaluate(win, `!document.querySelector('.page-route-view') || Number(getComputedStyle(document.querySelector('.page-route-view')).opacity) > 0.99`), '页面过渡结束');
    await evaluate(win, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const screenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(evidence, name + '.png'), screenshot.toPNG());
};
const frames = win => evaluate(win, `new Promise(resolve => {
    const deltas = []; let previous;
    const step = time => {
        if (previous !== undefined) deltas.push(time - previous);
        previous = time;
        if (deltas.length === 120) {
            const sorted = [...deltas].sort((a,b) => a-b);
            resolve({ frames: deltas.length, medianMs: sorted[60], p95Ms: sorted[114],
                maxMs: sorted[119], over33Ms: deltas.filter(x=>x>33.4).length });
        } else requestAnimationFrame(step);
    }; requestAnimationFrame(step);
})`);
let manager, extensions, api, server;
let auditExitCode = 0;

// 入口必须先结束 ESM 求值，不能用顶层 await 等待 Electron ready。
async function audit() {
try {
    ({ default: manager } = await import('../electron/extensions/extensionManager.js'));
    extensions = await import('../electron/extensions/extensions.js');
    const extensionDir = manager.ensureExtensionsDirectory();
    check('生产插件目录与隔离配置目录一致', extensionDir === path.join(profile, 'extensions'));
    const probeDir = path.join(extensionDir, 'phase2-visual-probe');
    if (mode !== 'persistence') fs.cpSync(path.join(root, 'tests/fixtures/phase2-visual-probe'), probeDir, { recursive: true });
    const validation = manager.validateManifest(path.join(probeDir, 'manifest.json'));
    check('探针通过项目真实 Manifest V3 校验', validation.valid, validation.error);
    const initialized = await extensions.initializeExtensions();
    check('插件系统初始化成功', initialized.success);
    const loaded = manager.getLoadedExtensions();
    check('启动扫描加载探针', loaded.length === 1, loaded.map(x => ({ name: x.name, id: x.id })));
    const extensionId = loaded[0].id;

    const { startLoopbackApi } = await import('../electron/services/loopbackApi.js');
    api = await startLoopbackApi(apiBinary, ['--platform=lite'], { cwd: profile });
    ipcMain.on('get-api-base-url', event => { event.returnValue = api.baseUrl; });
    ipcMain.handle('get-api-endpoints', () => ({ apiBaseUrl: api.baseUrl, websocketUrl: '' }));
    const onboarding = await import('../src/config/onboardingGuide.js');
    const initialStorage = [[onboarding.ONBOARDING_GUIDE_INTRO_STORAGE_KEY, onboarding.ONBOARDING_GUIDE_VERSION],
        ...onboarding.onboardingGuideGroups.map(guide => [guide.storageKey || `${onboarding.ONBOARDING_GUIDE_STORAGE_PREFIX}${guide.key}:version`, guide.version])];
    ipcMain.on('phase2-initial-storage', event => { event.returnValue = initialStorage; });
    const prefs = {
        preload: path.join(root, 'tests/fixtures/phase2-preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: false, webSecurity: false,
        allowRunningInsecureContent: true, backgroundThrottling: false
    };
    const main = new BrowserWindow({ width: 1180, height: 820, frame: false, titleBarStyle: 'hiddenInset', title: 'MicoMusic 阶段二验证', webPreferences: prefs, show: true });
    await main.loadFile(path.join(root, 'dist/index.html'));
    await waitFor(async () => (await state(main))?.settings, '生产页面内容脚本注入');
    await waitFor(() => evaluate(main, `Boolean((document.querySelector('.app-header') || document.querySelector('.side-navigation')) && document.querySelector('.player-container'))`), '生产主框架');
    const firstState = await state(main);
    check('file:// 页面注入 JS 与 CSS', firstState.documentRuns === 1 && !firstState.error, firstState);
    const pageBoundary = await evaluate(main, `({electron: typeof window.electron, electronAPI: typeof window.electronAPI, require: typeof require, chromeRuntime: typeof window.chrome?.runtime})`);
    report.observations.worldBoundary = { page: pageBoundary, content: firstState };
    check('内容脚本与宿主 preload 世界隔离', firstState.electronAPIInContentWorld === 'undefined' && pageBoundary.electronAPI === 'object', pageBoundary);

    if (mode === 'manual') {
        await probeStyle(main, '.app-header', '原生交互窗口的探针样式已开启');
        const opened = await evaluate(main, `window.electronAPI.openExtensionPopup(${JSON.stringify(extensionId)})`);
        check('原生交互用插件弹窗已打开', opened.success);
        console.log('等待原生交互核对；关闭主窗口后结束并清理测试进程。');
        await new Promise(resolve => main.once('closed', resolve));
    } else if (mode === 'persistence') {
        check('退出并重启 Electron 后插件设置保留', firstState.settings.enabled === false && firstState.settings.proof === 'cross-process', firstState.settings);
        const restored = await styles(main, '.player-container');
        check('重启后的关闭设置未应用验证样式', restored.proof !== 'applied', restored);
        report.observations.extensionId = extensionId;
    } else {
        await probeStyle(main, '.app-header', '顶部导航的 scoped 样式可由插件覆盖');
        await probeStyle(main, '.app-main-scroll', '主内容容器可由插件覆盖');
        await probeStyle(main, '.player-container', '底部播放器可由插件覆盖');
        const blurSupport = await evaluate(main, `CSS.supports('backdrop-filter', 'blur(12px)')`);
        check('当前 Chromium 支持 backdrop-filter', blurSupport);
        report.observations.platformTitlebar = await evaluate(main, `({customTitlebarPresent: Boolean(document.querySelector('.titlebar'))})`);
        await capture(main, '01-file-main-probe');

        await navigate(main, '/discover', '.discover-page');
        await navigate(main, '/settings', '.settings-page');
        const routed = await state(main);
        check('Hash 路由变化可监听且不重复注入', routed.documentRuns === 1 && routed.hashEvents >= 2, routed);
        check('Vue 动态节点变化可被 MutationObserver 监听', routed.mutationBatches > firstState.mutationBatches, routed.mutationBatches);

        await evaluate(main, `(() => {
            const settings = { ...JSON.parse(localStorage.getItem('settings') || '{}'), navigationMode: 'side', playerBarLayout: 'full' };
            localStorage.setItem('settings', JSON.stringify(settings));
            window.dispatchEvent(new CustomEvent('settings-change', { detail: { settings } }));
        })()`);
        await probeStyle(main, '.side-navigation', '切换到侧栏后的新节点由同一插件 CSS 覆盖');
        await probeStyle(main, '.side-top-actions', '侧栏顶部操作区域可覆盖');
        await evaluate(main, `document.documentElement.classList.add('dark')`);
        const dark = await styles(main, '.side-navigation');
        check('深色状态可使用独立规则', dark.background === 'rgba(20, 30, 55, 0.4)', dark);
        await capture(main, '02-side-dark-probe');
        await evaluate(main, `document.documentElement.classList.remove('dark')`);

        await evaluate(main, `void window.$modal.alert('阶段二样式覆盖验证')`);
        const modal = await probeStyle(main, '.modal', '独立挂载到 body 的真实弹窗可覆盖');
        check('弹窗覆盖不依赖 #app 内部范围', modal.outsideApp);
        await evaluate(main, `document.querySelector('.modal .btn').click()`);
        await evaluate(main, `window.$message.info('阶段二消息样式验证', 2000)`);
        await probeStyle(main, '.message', '动态消息提示可覆盖');
        await navigate(main, '/', '.player-container .album-art');
        await evaluate(main, `document.querySelector('.player-container .album-art').click()`);
        await probeStyle(main, '.lyrics-bg', '主窗口全屏歌词外层可覆盖');
        await evaluate(main, `document.querySelector('.lyrics-bg .close-btn').click()`);
        await waitFor(() => evaluate(main, `!document.querySelector('.lyrics-bg')`), '关闭全屏歌词');

        await command(main, { enabled: true, proof: 'popup-seed' });
        await waitFor(async () => (await state(main))?.settings?.proof === 'popup-seed', '先保存弹窗读取的真实设置');
        const popupResult = await evaluate(main, `window.electronAPI.openExtensionPopup(${JSON.stringify(extensionId)})`);
        check('真实插件弹窗 IPC 可打开 action.default_popup', popupResult.success, popupResult);
        const popup = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith(`chrome-extension://${extensionId}/`)), '插件弹窗窗口');
        const popupState = await waitFor(() => evaluate(popup, `JSON.parse(document.body.getAttribute('data-phase2-popup') || 'null')`), '弹窗读取设置');
        report.observations.popupBoundary = popupState;
        check('插件弹窗可以读取自己的 chrome.storage.local', popupState.settings?.enabled === true, popupState);
        await evaluate(popup, `document.getElementById('phase2-off').click()`);
        await waitFor(async () => (await state(main))?.settings?.enabled === false, '弹窗关闭样式同步到主窗口');
        const off = await styles(main, '.player-container');
        check('插件自有开关可实时恢复原 scoped 样式', off.proof !== 'applied', off);
        await evaluate(popup, `document.getElementById('phase2-on').click()`);
        await waitFor(async () => (await state(main))?.settings?.enabled === true, '弹窗重新开启样式');
        popup.destroy();

        const lyrics = new BrowserWindow({ width: 900, height: 160, transparent: true, frame: false, show: true, webPreferences: prefs });
        await lyrics.loadFile(path.join(root, 'dist/index.html'), { hash: 'lyrics' });
        await waitFor(async () => (await state(lyrics))?.settings, '歌词窗口注入');
        await probeStyle(lyrics, '.lyrics-panel', '默认会话的独立歌词窗口可注入');
        report.observations.lyricsWindow = await state(lyrics);
        await capture(lyrics, '03-desktop-lyrics-probe');
        lyrics.destroy();

        server = http.createServer((request, response) => {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const requested = path.resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
            const dist = path.join(root, 'dist') + path.sep;
            if (!requested.startsWith(dist) || !fs.existsSync(requested) || !fs.statSync(requested).isFile()) { response.writeHead(404); response.end(); return; }
            const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };
            response.setHeader('Content-Type', mime[path.extname(requested)] || 'application/octet-stream');
            response.end(fs.readFileSync(requested));
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const httpWindow = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: prefs });
        await httpWindow.loadURL(`http://localhost:${server.address().port}/`);
        await waitFor(async () => (await state(httpWindow))?.settings, 'localhost 内容脚本注入');
        await probeStyle(httpWindow, '.app-header', 'localhost HTTP 页面可注入 JS 与 CSS');
        httpWindow.destroy();
        await new Promise(resolve => server.close(resolve)); server = null;

        await command(main, { enabled: false, proof: 'performance-baseline' });
        await waitFor(async () => (await state(main))?.settings?.enabled === false, '性能基准关闭样式');
        main.show();
        app.getAppMetrics(); // 首次调用只建立 CPU 采样起点。
        const baseFrames = await frames(main);
        const baseMetrics = app.getAppMetrics();
        await command(main, { enabled: true, proof: 'performance-probe' });
        await waitFor(async () => (await state(main))?.settings?.enabled === true, '性能探针开启样式');
        const probeFrames = await frames(main);
        report.observations.performance = { baseFrames, probeFrames, baseMetrics, processMetrics: app.getAppMetrics(), gpuFeatureStatus: app.getGPUFeatureStatus(), acceptance: '短样本可行性记录，不是正式主题性能验收' };
        await navigate(main, '/LocalMusic', '.detail-page');
        const localReady = await waitFor(() => evaluate(main, `Boolean(document.querySelector('.track-list-container'))`), '本地音乐异步初始化');
        check('本地音乐空状态可正常切换', localReady);
        await navigate(main, '/search', '.login-page');
        check('视觉注入保留未登录时的搜索路由守卫', await evaluate(main, `location.hash.startsWith('#/login')`));

        const list = await evaluate(main, `window.electronAPI.getExtensions()`);
        report.observations.management = { list, scanned: manager.scanExtensions().map(item => ({directory:item.directory, installed:item.installed})), toggleAPI: await evaluate(main, `Object.keys(window.electronAPI)`)};
        const beforeRemove = await state(main);
        manager.unloadChromeExtensions();
        await navigate(main, '/settings', '.settings-page');
        const afterRemove = await state(main);
        report.observations.removeExtension = { loadedCount: manager.getLoadedExtensions().length, before: beforeRemove, after: afterRemove, style: await styles(main, '.player-container') };
        check('卸载后的当前文档内容监听仍存活，需定义清理机制', afterRemove.hashEvents > beforeRemove.hashEvents, afterRemove);
        await manager.loadChromeExtensions();
        await new Promise(resolve => setTimeout(resolve, 300));
        report.observations.loadIntoExistingDocument = await state(main);
        const reloaded = await evaluate(main, `window.electronAPI.reloadExtensions()`);
        report.observations.reload = { result: reloaded, currentDocument: await state(main), loadedCount: manager.getLoadedExtensions().length };
        check('真实重新加载 IPC 返回成功', reloaded.success);
        main.reload();
        await waitFor(async () => (await state(main))?.settings, '文档刷新后的脚本注入');
        const refreshed = await state(main);
        check('文档刷新后只注入一次且读取插件设置', refreshed.documentRuns === 1 && refreshed.settings.proof === 'performance-probe', refreshed);

        const brokenDir = path.join(extensionDir, 'phase2-invalid-manifest');
        fs.mkdirSync(brokenDir); fs.writeFileSync(path.join(brokenDir, 'manifest.json'), '{"manifest_version":3,');
        const partial = await manager.reloadExtensions();
        report.observations.partialLoad = { result: partial, loadedCount: manager.getLoadedExtensions().length, invalidValidation: manager.validateManifest(path.join(brokenDir, 'manifest.json')) };
        check('存在无效清单时重载仍报告成功，错误反馈需补齐', partial.success);
        fs.rmSync(brokenDir, { recursive: true });

        const restarted = await extensions.restartExtensions();
        report.observations.restart = { result: restarted, loadedCount: manager.getLoadedExtensions().length };
        check('现有 restartExtensions 只完成清理而未重新初始化', manager.getLoadedExtensions().length === 0, restarted);

        const sentinel = path.join(extensionDir, 'phase2-other-extension');
        fs.mkdirSync(sentinel); fs.writeFileSync(path.join(sentinel, 'owned-test-sentinel.txt'), '仅属于本次隔离验证');
        const emptyUninstall = manager.uninstallExtension('', '');
        report.observations.emptyDirectoryUninstall = { result: emptyUninstall, extensionsRootExists: fs.existsSync(extensionDir), otherDirectoryExists: fs.existsSync(sentinel) };
        check('空目录卸载会删除插件根目录，已在隔离探针中复现', !fs.existsSync(extensionDir), emptyUninstall);
        fs.cpSync(path.join(root, 'tests/fixtures/phase2-visual-probe'), probeDir, { recursive: true });
        await extensions.initializeExtensions();
        main.reload();
        await waitFor(async () => (await state(main))?.settings, '恢复探针后注入');
        await command(main, { enabled: false, proof: 'cross-process' });
        await waitFor(async () => (await state(main))?.settings?.proof === 'cross-process', '保存跨进程验证值');
        check('插件设置可保存供进程重启验证', (await state(main)).settings.enabled === false);
    }
    fs.writeFileSync(path.join(evidence, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
} catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
    console.error(error.stack);
    auditExitCode = 1;
} finally {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    if (server) server.close();
    if (extensions) await extensions.cleanupExtensions();
    if (api?.child && api.child.exitCode === null) {
        const closed = once(api.child, 'close'); api.child.kill(); await closed;
    }
    app.exit(auditExitCode);
}
}
app.whenReady().then(audit).catch(error => { console.error(error); app.exit(1); });
