import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const [profile, mode, apiBinary] = process.argv.slice(2);
const runtime = path.join(root, 'artifacts/phase3-runtime') + path.sep;
assert.ok(profile && path.resolve(profile).startsWith(runtime), '只允许本次阶段三隔离 profile');
assert.ok(['capabilities', 'persistence', 'uninstall-persistence', 'restored', 'startup-resource-failure', 'startup-manifest-failure', 'startup-timeout'].includes(mode));
for (const name of ['logs', 'temp']) fs.mkdirSync(path.join(profile, name), { recursive: true });
app.setName('MicoMusic 阶段三验证');
app.setPath('userData', profile);
app.setPath('logs', path.join(profile, 'logs'));
app.setPath('temp', path.join(profile, 'temp'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const evidence = path.join(root, 'docs/phase3/evidence');
fs.mkdirSync(evidence, { recursive: true });
function sourceState() {
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--',
        'electron', 'src', 'plugins/extensions/mico-liquid-glass', 'scripts', 'tests', 'package.json', 'package-lock.json'],
    { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const hash = createHash('sha256');
    const sourceFiles = [...new Set(files)].sort().filter(file => fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile());
    for (const file of sourceFiles) { hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(root, file))); hash.update('\0'); }
    const rendererHash = createHash('sha256');
    const rendererFiles = fs.readdirSync(path.join(root, 'dist'), { recursive: true }).sort()
        .filter(file => fs.statSync(path.join(root, 'dist', file)).isFile());
    for (const file of rendererFiles) { rendererHash.update(file); rendererHash.update('\0'); rendererHash.update(fs.readFileSync(path.join(root, 'dist', file))); rendererHash.update('\0'); }
    return {
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        gitStatusShort: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
        sourceFingerprintSha256: hash.digest('hex'), files: sourceFiles,
        rendererFingerprintSha256: rendererHash.digest('hex'), rendererFiles,
        interpretation: '运行时读取当前工作树，包含未提交源码；HEAD 本身不是此次测试源码的全部内容'
    };
}
const report = {
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform,
    timestamp: new Date().toISOString(), mode, sourceState: sourceState(), checks: [], observations: {},
    scope: '真实生产 Vue、扩展管理器与 IPC；隔离宿主不实现完整播放器主进程；自生成 PCM 仅验证技术连续性'
};
const check = (name, condition, detail = null) => {
    assert.ok(condition, name + (detail ? ': ' + JSON.stringify(detail) : ''));
    report.checks.push({ name, passed: true, detail }); console.log('通过：' + name);
};
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
const waitFor = async (fn, label, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const value = await fn(); if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('等待超时：' + label);
};
let main, popup, manager, extensions, builtin, api;
let exitCode = 0;
let navigationCount = 0;
let releaseStartupLoad;
let originalStartupLoad;
let delayedStartupLoad;
const state = () => evaluate(main, `(() => {
    const root = document.documentElement;
    return { ready: JSON.parse(root.getAttribute('data-mico-visual-ready') || 'null'),
        ack: JSON.parse(root.getAttribute('data-mico-visual-ack') || 'null'),
        styles: document.querySelectorAll('#mico-liquid-glass-style').length,
        enabled: root.getAttribute('data-mico-liquid-glass'), theme: root.getAttribute('data-mico-liquid-glass-theme'),
        motion: root.getAttribute('data-mico-liquid-glass-motion'), blur: root.getAttribute('data-mico-liquid-glass-blur'),
        materialSeen: root.getAttribute('data-phase3-material-seen') === 'true',
        identity: window.phase3DocumentIdentity,
        media: window.phase3Audio ? { time: window.phase3Audio.currentTime, paused: window.phase3Audio.paused, starts: window.phase3MediaStarts } : null,
        materialMutations: window.phase3MaterialMutations ? { ...window.phase3MaterialMutations } : null };
})()`);
const surface = selector => evaluate(main, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null;
    const css = getComputedStyle(node); const rect = node.getBoundingClientRect();
    return { background: css.backgroundColor, backdropFilter: css.backdropFilter,
        shadow: css.boxShadow, color: css.color, width: rect.width, height: rect.height,
        surface: css.getPropertyValue('--mico-glass-surface').trim() };
})()`);
const controlColors = () => evaluate(main, `(() => {
    const selectors = ['.player-bar .control-btn', '.player-bar .control-btn i', '.player-bar .extra-btn', '.player-bar .extra-btn i', '.player-bar .volume-control i'];
    return Object.fromEntries(selectors.map(selector => [selector, [...document.querySelectorAll(selector)].map(node => {
        const css = getComputedStyle(node); const parent = getComputedStyle(node.closest('.player-container'));
        return { color: css.color, text: css.getPropertyValue('--mico-glass-text').trim(), muted: css.getPropertyValue('--mico-glass-muted').trim(),
            parentText: parent.getPropertyValue('--mico-glass-text').trim(), parentMuted: parent.getPropertyValue('--mico-glass-muted').trim() };
    })]));
})()`);
const readableControls = (colors, primary, secondary) =>
    ['.player-bar .control-btn', '.player-bar .control-btn i'].every(selector => colors[selector].length >= 3 && colors[selector].every(item => item.color === primary)) &&
    ['.player-bar .extra-btn', '.player-bar .extra-btn i', '.player-bar .volume-control i'].every(selector => colors[selector].length > 0 && colors[selector].every(item => item.color === secondary));
const geometry = () => evaluate(main, `(() => {
    const result = {};
    for (const selector of ['.app-header', '.player-container', '.profile', '.profile-avatar', '.profile-avatar img']) {
        const node = document.querySelector(selector); if (!node) continue;
        const rect = node.getBoundingClientRect(); const css = getComputedStyle(node);
        result[selector] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        if (selector.startsWith('.profile')) Object.assign(result[selector], {
            background: css.backgroundColor, overflow: css.overflow, transform: css.transform });
    }
    return result;
})()`);
const capture = async name => {
    await waitFor(() => evaluate(main, `!document.querySelector('.page-route-view') || Number(getComputedStyle(document.querySelector('.page-route-view')).opacity) > 0.99`), '页面过渡');
    await evaluate(main, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(evidence, name + '.png'), (await main.webContents.capturePage()).toPNG());
};
const loadedBuiltin = () => manager.getLoadedExtensions().find(item => item.manifest?.plugin_id === 'mico-liquid-glass');
async function openPopup() {
    const extension = loadedBuiltin(); assert.ok(extension, '内置主题已加载');
    const opened = await evaluate(main, `window.electronAPI.openExtensionPopup(${JSON.stringify(extension.id)})`);
    check('生产插件弹窗 IPC 可打开主题设置', opened.success, opened);
    popup = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === `chrome-extension://${extension.id}/popup.html`), '主题设置窗口');
    await waitFor(() => evaluate(popup, `Boolean(document.getElementById('enabled') && !document.getElementById('enabled').disabled)`), '主题配置读取');
    popup.hide();
    return popup;
}
async function settings(value) {
    if (!popup || popup.isDestroyed()) await openPopup();
    const saved = await evaluate(popup, `(async () => {
        const config = globalThis.MicoLiquidGlassSettings;
        const stored = await chrome.storage.local.get(config.key);
        const value = config.normalize({ ...stored[config.key], ...${JSON.stringify(value)} });
        await chrome.storage.local.set({ [config.key]: value }); return value;
    })()`);
    await waitFor(async () => {
        const current = await state();
        return current.ready?.success && current.ready.enabled === saved.enabled &&
            (saved.enabled ? current.styles === 1 && current.theme === saved.theme &&
                current.blur === (saved.lowBlur ? 'low' : 'normal') && current.motion === (saved.reduceMotion ? 'reduced' : 'normal')
                : current.styles === 0 && current.enabled === null && current.theme === null && current.blur === null && current.motion === null);
    }, '即时保存设置');
    return saved;
}
function closePopup() { if (popup && !popup.isDestroyed()) popup.destroy(); popup = null; }
const frames = () => evaluate(main, `new Promise(resolve => {
    const deltas = []; let previous;
    const frame = time => {
        if (previous !== undefined) deltas.push(time - previous); previous = time;
        if (deltas.length === 600) {
            const sorted = [...deltas].sort((a,b) => a-b);
            resolve({ frames: 600, medianMs: sorted[300], p95Ms: sorted[570], maxMs: sorted[599], over33Ms: deltas.filter(x => x > 33.4).length });
        } else requestAnimationFrame(frame);
    }; requestAnimationFrame(frame);
})`);
function makeAudio() {
    const rate = 8000, duration = 300;
    const buffer = Buffer.alloc(44 + rate * duration * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
    buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
    for (let i = 0; i < rate * duration; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 500), 44 + i * 2);
    const filename = path.join(profile, 'continuity.wav'); fs.writeFileSync(filename, buffer); return filename;
}
function continuity(name, before, after) {
    check(name, after.identity === before.identity && !after.media.paused && after.media.time >= before.media.time &&
        after.media.starts === 1 && navigationCount === 1, { before: before.media, after: after.media, navigationCount });
}
async function capabilities() {
    const initial = await state();
    check('首次内置主题默认开启并成功读取 CSS', initial.ready?.success && initial.ready.enabled && initial.styles === 1, initial);
    const installed = loadedBuiltin();
    report.observations.builtin = { installed: { id: installed.id, path: installed.path, version: installed.version }, state: builtin.getBuiltinVisualPluginState() };
    check('内置主题复制到隔离用户插件目录', installed.path === path.join(profile, 'extensions/mico-liquid-glass'));
    await evaluate(main, `(() => {
        window.phase3DocumentIdentity = crypto.randomUUID();
        window.phase3MediaStarts = 0;
        window.phase3Audio = new Audio(${JSON.stringify(pathToFileURL(makeAudio()).href)});
        window.phase3Audio.volume = 0.03;
        window.phase3Audio.addEventListener('playing', () => window.phase3MediaStarts++);
        return window.phase3Audio.play();
    })()`);
    await waitFor(async () => (await state()).media?.time > 0.1, 'PCM 技术音频连续播放');
    await evaluate(main, `(() => {
        const counts = window.phase3MaterialMutations = { added: 0, removed: 0 };
        window.phase3MaterialObserver = new MutationObserver(records => {
            for (const record of records) {
                counts.added += [...record.addedNodes].filter(node => node.id === 'mico-liquid-glass-style').length;
                counts.removed += [...record.removedNodes].filter(node => node.id === 'mico-liquid-glass-style').length;
            }
        });
        window.phase3MaterialObserver.observe(document.documentElement, { childList: true });
    })()`);
    await settings({ enabled: false });
    const base = await geometry();
    const baseSurfaces = { header: await surface('.app-header'), player: await surface('.player-container') };
    await capture('01-base');
    await settings({ enabled: true, theme: 'light', lowBlur: false, reduceMotion: false });
    await waitFor(async () => readableControls(await controlColors(), 'rgb(35, 48, 68)', 'rgb(88, 103, 121)'), '浅色控件实际颜色完成过渡');
    check('浅色控制与音量图标使用主题可读颜色', true, await controlColors());
    const light = { header: await surface('.app-header'), player: await surface('.player-container') };
    check('生产导航和播放器应用浅色 22px 材质', light.header.backdropFilter.includes('blur(22px)') && light.player.backdropFilter.includes('blur(22px)') && light.header.surface === 'rgba(249, 251, 255, 0.74)', light);
    const glassGeometry = await geometry();
    check('材质不改变导航、播放器和头像几何', JSON.stringify(base) === JSON.stringify(glassGeometry), { base, glass: glassGeometry });
    check('头像保持均匀裁切且无粉色底色', base['.profile-avatar'].width === 40 && base['.profile-avatar'].height === 40 &&
        base['.profile-avatar'].overflow === 'hidden' && base['.profile'].background === 'rgba(0, 0, 0, 0)' &&
        Math.abs(base['.profile-avatar img'].width - 44.4) < 0.01, base);
    await capture('02-light');
    await settings({ theme: 'dark' });
    const dark = { header: await surface('.app-header'), player: await surface('.player-container') };
    check('深色材质即时生效', dark.header.surface === 'rgba(25, 31, 43, 0.76)' && dark.player.surface === dark.header.surface, dark);
    const readableDark = colors => readableControls(colors, 'rgb(238, 243, 252)', 'rgb(186, 199, 217)');
    await waitFor(async () => readableDark(await controlColors()), '暗色控件实际颜色完成过渡');
    const darkControls = await controlColors();
    report.observations.darkControls = darkControls;
    console.log('暗色控件计算颜色：' + JSON.stringify(darkControls));
    check('深色播放与扩展控件、音量图标保持可读颜色', readableDark(darkControls), darkControls);
    await capture('03-dark');
    await settings({ lowBlur: true, reduceMotion: true });
    const low = { header: await surface('.app-header'), player: await surface('.player-container') };
    check('低模糊与减少动效设置即时生效', low.header.backdropFilter.includes('blur(8px)') && (await state()).motion === 'reduced', low);
    await settings({ theme: 'auto', lowBlur: false });
    await evaluate(main, `document.documentElement.classList.add('dark')`);
    check('auto 设置跟随宿主深色标记', (await surface('.app-header')).surface === dark.header.surface);
    await evaluate(main, `document.documentElement.classList.remove('dark')`);
    check('auto 设置跟随宿主浅色标记', (await surface('.app-header')).surface === light.header.surface);
    const switches = [];
    for (let i = 0; i < 20; i++) {
        const before = await state();
        await settings({ enabled: false }); const off = await state();
        await settings({ enabled: true }); const on = await state();
        continuity(`开关第 ${i + 1} 次不刷新或中断技术播放`, before, on);
        check(`开关第 ${i + 1} 次样式完整撤回并保持单实例`, off.styles === 0 && on.styles === 1, { off: off.styles, on: on.styles });
        switches.push({ before, off, on });
    }
    closePopup();
    const reloads = [];
    for (let i = 0; i < 20; i++) {
        const before = await state();
        const result = await manager.reloadExtensions();
        await waitFor(async () => (await state()).ready?.success && (await state()).styles === 1, '重载注入');
        const after = await state();
        check(`重载第 ${i + 1} 次完整清理后重新注入`, result.success &&
            after.materialMutations.removed === before.materialMutations.removed + 1 &&
            after.materialMutations.added === before.materialMutations.added + 1 && after.styles === 1, { result, before: before.materialMutations, after: after.materialMutations });
        continuity(`重载第 ${i + 1} 次文档与技术音频连续`, before, after);
        reloads.push({ result, before, after });
    }
    report.observations.switches = switches; report.observations.reloads = reloads;
    const restarted = await extensions.restartExtensions();
    check('插件系统重启完成重新初始化', restarted.success && Boolean(loadedBuiltin()), restarted);
    const ipc = await evaluate(main, `window.electronAPI.getExtensions()`);
    check('重启后原 preload 插件 IPC 恢复', ipc.success && ipc.extensions.some(item => item.pluginId === 'mico-liquid-glass'), ipc);
    await settings({ enabled: false });
    check('关闭后恢复生产 scoped 样式', JSON.stringify(baseSurfaces) === JSON.stringify({ header: await surface('.app-header'), player: await surface('.player-container') }));
    check('关闭后音量图标恢复基础颜色', (await controlColors())['.player-bar .volume-control i'].every(item => item.color === 'rgb(102, 102, 102)'));
    await capture('04-off');
    const rootDir = manager.getExtensionsDirectory();
    const empty = await evaluate(main, `window.electronAPI.uninstallExtension('', '')`);
    check('空目录卸载拒绝且保留内置插件及根目录', !empty.success && fs.existsSync(rootDir) && fs.existsSync(path.join(rootDir, 'mico-liquid-glass')), empty);
    const otherDir = path.join(rootDir, 'phase3-other-plugin');
    fs.mkdirSync(otherDir);
    fs.writeFileSync(path.join(otherDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: '阶段三其他插件保留验证', version: '0.0.1' }));
    const other = await manager.installExtension(otherDir);
    check('合法其他插件可正常安装', other.success, other);
    const mismatched = await evaluate(main, `window.electronAPI.uninstallExtension(${JSON.stringify(loadedBuiltin().id)}, 'phase3-other-plugin')`);
    check('身份目录不匹配拒绝且保留其他插件', !mismatched.success && fs.existsSync(otherDir) && manager.getLoadedExtensions().some(item => item.id === other.extension.id), mismatched);
    const otherRemoved = await evaluate(main, `window.electronAPI.uninstallExtension(${JSON.stringify(other.extension.id)}, 'phase3-other-plugin')`);
    check('合法其他插件卸载不影响内置主题', otherRemoved.success && !fs.existsSync(otherDir) && Boolean(loadedBuiltin()), otherRemoved);
    for (const [directory, content] of [['phase3-invalid-json', '{"manifest_version":3,'],
        ['phase3-invalid-version', JSON.stringify({ manifest_version: 2, name: 'invalid version', version: '1.0.0' })]]) {
        fs.mkdirSync(path.join(rootDir, directory)); fs.writeFileSync(path.join(rootDir, directory, 'manifest.json'), content);
    }
    closePopup();
    const errors = await manager.reloadExtensions();
    check('错误清单逐条返回且合法主题继续可用', !errors.success && ['phase3-invalid-json', 'phase3-invalid-version'].every(directory =>
        errors.results.some(item => item.directory === directory && item.success === false && typeof item.message === 'string' && item.message)) && Boolean(loadedBuiltin()), errors);
    report.observations.invalidManifest = errors;
    for (const directory of ['phase3-invalid-json', 'phase3-invalid-version']) fs.rmSync(path.join(rootDir, directory), { recursive: true });
    check('移除测试错误清单后重载恢复成功', (await manager.reloadExtensions()).success);
    // 模拟用户目录保留旧资源，检验内置升级；配置由 chrome.storage 保留。
    await extensions.cleanupExtensions();
    const installedCss = path.join(rootDir, 'mico-liquid-glass/glass.css');
    fs.appendFileSync(installedCss, '\n/* 隔离验证中的旧资源差异 */\n');
    const upgrade = builtin.prepareBuiltinVisualPlugin();
    check('内置资源差异触发原子升级', upgrade.success && upgrade.updated === true, upgrade);
    check('升级后重新初始化成功', (await extensions.initializeExtensions()).success);
    await waitFor(async () => (await state()).ready?.success, '升级后主题');
    check('升级保留用户关闭选择', (await state()).ready.enabled === false && (await state()).styles === 0);
    report.observations.upgrade = upgrade;
    // CSS 缺失是真实内容脚本资源失败；加载错误应逐条返回并留下可操作的基础 Vue 页面。
    closePopup();
    const beforeFallback = await state();
    check('资源错误测试前完整清理成功', (await manager.unloadChromeExtensions()).success);
    fs.unlinkSync(path.join(rootDir, 'mico-liquid-glass/glass.css'));
    const fallback = await manager.loadChromeExtensions();
    const failedState = await state();
    check('材质资源失败返回基础界面及明确错误', !fallback.success && !loadedBuiltin() && failedState.styles === 0 &&
        failedState.ready?.success === false && typeof failedState.ready.error === 'string' &&
        await evaluate(main, `Boolean(document.querySelector('.app-header') && document.querySelector('.player-container'))`), { fallback, failedState });
    continuity('材质失败回退保留当前文档和技术播放', beforeFallback, failedState);
    report.observations.resourceFailureFallback = { fallback, failedState };
    check('正式资源可修复隔离缺失文件', builtin.prepareBuiltinVisualPlugin().success);
    check('修复后当前文档可重新注入', (await manager.loadChromeExtensions()).success);
    const performance = {};
    for (const [label, value] of [['base', { enabled: false }], ['glass', { enabled: true, theme: 'light', lowBlur: false }], ['lowBlur', { enabled: true, lowBlur: true }]]) {
        await settings(value); main.show(); app.getAppMetrics();
        performance[label] = { frames: await frames(), processMetrics: app.getAppMetrics() };
        check(`${label} 性能样本完成 600 帧`, performance[label].frames.frames === 600);
    }
    report.observations.performance = { ...performance, gpuFeatureStatus: app.getGPUFeatureStatus(), acceptance: '当前设备实测记录；不替代其他平台性能验收' };
    await settings({ enabled: false, theme: 'dark', lowBlur: true, reduceMotion: true });
    check('已保存跨进程完整设置', (await state()).ready.enabled === false);
}
async function audit() {
try {
    ({ default: manager } = await import('../electron/extensions/extensionManager.js'));
    extensions = await import('../electron/extensions/extensions.js');
    builtin = await import('../electron/extensions/builtinVisualPlugin.js');
    let initialized;
    if (mode === 'startup-timeout') {
        originalStartupLoad = manager.loadChromeExtensions;
        const gate = new Promise(resolve => { releaseStartupLoad = resolve; });
        manager.loadChromeExtensions = () => {
            delayedStartupLoad = gate.then(() => originalStartupLoad());
            return delayedStartupLoad;
        };
        const start = Date.now();
        initialized = await extensions.prepareExtensionsForStartup(50);
        report.observations.startupBound = { result: initialized, elapsedMs: Date.now() - start, requestedMs: 50 };
        check('插件初始化超时有界返回且未加载主题', initialized.timedOut === true && !initialized.success &&
            report.observations.startupBound.elapsedMs < 1000 && !loadedBuiltin(), report.observations.startupBound);
    } else {
        initialized = await extensions.initializeExtensions();
        if (mode === 'startup-manifest-failure') check('首屏内置清单异常返回明确准备错误', !initialized.success && !initialized.builtinResult?.success && typeof initialized.builtinResult?.message === 'string', initialized);
        else check('隔离生产插件系统初始化成功', initialized.success, initialized);
    }
    check('生产插件目录属于隔离 profile', manager.getExtensionsDirectory() === path.join(profile, 'extensions'));
    const { startLoopbackApi } = await import('../electron/services/loopbackApi.js');
    api = await startLoopbackApi(apiBinary, ['--platform=lite'], { cwd: profile });
    ipcMain.on('get-api-base-url', event => { event.returnValue = api.baseUrl; });
    ipcMain.handle('get-api-endpoints', () => ({ apiBaseUrl: api.baseUrl, websocketUrl: '' }));
    const onboarding = await import('../src/config/onboardingGuide.js');
    const initialStorage = [[onboarding.ONBOARDING_GUIDE_INTRO_STORAGE_KEY, onboarding.ONBOARDING_GUIDE_VERSION],
        ...onboarding.onboardingGuideGroups.map(guide => [guide.storageKey || `${onboarding.ONBOARDING_GUIDE_STORAGE_PREFIX}${guide.key}:version`, guide.version]),
        ['settings', JSON.stringify({ navigationMode: 'top', playerBarLayout: 'full' })]];
    ipcMain.on('phase3-initial-storage', event => { event.returnValue = initialStorage; });
    main = new BrowserWindow({ width: 1180, height: 820, frame: false, titleBarStyle: 'hiddenInset',
        title: 'MicoMusic 阶段三验证', show: true,
        webPreferences: { preload: path.join(root, 'tests/fixtures/phase3-preload.cjs'), contextIsolation: true,
            nodeIntegration: false, sandbox: false, webSecurity: false, backgroundThrottling: false } });
    main.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) navigationCount++;
    });
    await main.loadFile(path.join(root, 'dist/index.html'));
    await waitFor(() => evaluate(main, `Boolean(document.querySelector('.app-header') && document.querySelector('.player-container'))`), '真实 Vue 导航与播放器');
    await evaluate(main, `window.phase3DocumentIdentity = crypto.randomUUID()`);
    check('生产 Vue 主框架加载成功', true);
    if (mode === 'capabilities') await capabilities();
    else if (mode === 'persistence') {
        await waitFor(async () => (await state()).ready?.success, '跨进程关闭状态');
        const restored = await state();
        check('退出并重启后关闭状态保留且无材质闪动', restored.ready.enabled === false && restored.styles === 0 && !restored.materialSeen, restored);
        await openPopup();
        const values = await evaluate(popup, `({ enabled: document.getElementById('enabled').checked, theme: document.getElementById('theme').value,
            lowBlur: document.getElementById('lowBlur').checked, reduceMotion: document.getElementById('reduceMotion').checked })`);
        check('跨进程保留完整主题设置', values.enabled === false && values.theme === 'dark' && values.lowBlur && values.reduceMotion, values);
        closePopup();
        const extension = loadedBuiltin();
        const removed = await evaluate(main, `window.electronAPI.uninstallExtension(${JSON.stringify(extension.id)}, 'mico-liquid-glass')`);
        check('合法卸载通过实际 IPC 清理并删除文件', removed.success && !loadedBuiltin() && !fs.existsSync(path.join(profile, 'extensions/mico-liquid-glass')), removed);
        check('卸载记录用户选择并清空视觉样式', builtin.getBuiltinVisualPluginState().removed === true && (await state()).styles === 0, builtin.getBuiltinVisualPluginState());
    } else if (mode === 'uninstall-persistence') {
        check('进程重启保留卸载选择，不自动重新安装', !loadedBuiltin() && builtin.getBuiltinVisualPluginState().removed === true && !fs.existsSync(path.join(profile, 'extensions/mico-liquid-glass')));
        const restored = await evaluate(main, `window.electronAPI.restoreBuiltinVisualPlugin()`);
        check('主动恢复内置插件成功', restored.success && Boolean(loadedBuiltin()), restored);
        await waitFor(async () => (await state()).ready?.success, '主动恢复当前文档注入');
        check('主动恢复保留原关闭配置', (await state()).ready.enabled === false && (await state()).styles === 0);
        await settings({ enabled: true });
        check('主动恢复后能即时开启', (await state()).styles === 1 && builtin.getBuiltinVisualPluginState().removed === false);
    } else if (mode === 'restored') {
        await waitFor(async () => (await state()).ready?.success, '恢复后的进程重启');
        check('主动恢复选择在下次启动保持', Boolean(loadedBuiltin()) && builtin.getBuiltinVisualPluginState().removed === false && (await state()).ready.enabled === true && (await state()).styles === 1, await state());
    } else if (mode === 'startup-resource-failure') {
        await waitFor(async () => (await state()).ready?.success === false, '首屏 CSS 资源错误反馈');
        const failed = await state();
        check('首屏材质资源丢失时基础页面仍可用', failed.styles === 0 && !failed.materialSeen && typeof failed.ready.error === 'string', failed);
        const management = await evaluate(main, `window.electronAPI.getExtensions()`);
        check('插件管理 IPC 返回首屏材质明确失败状态', management.success && management.visualRuntime.some(item =>
            item.windowId === main.webContents.id && item.state?.success === false && item.state.extensionId === failed.ready.extensionId &&
            item.state.error === failed.ready.error), management);
        report.observations.resourceFailureManagement = management;
        await capture('05-startup-resource-fallback');
    } else if (mode === 'startup-manifest-failure') {
        const failed = await state();
        check('首屏内置清单异常不阻止基础 Vue 打开', !loadedBuiltin() && failed.styles === 0 && !failed.materialSeen, failed);
        await capture('06-startup-manifest-fallback');
    } else if (mode === 'startup-timeout') {
        const base = await state();
        check('首屏插件准备超时后基础 Vue 正常打开', !loadedBuiltin() && base.styles === 0 && !base.materialSeen, base);
        await capture('07-startup-timeout-base');
        // 启动时 AbortSignal 必须阻止超时后的自动主题；随后用户主动重载仍可恢复。
        manager.loadChromeExtensions = originalStartupLoad;
        releaseStartupLoad(); releaseStartupLoad = null;
        const lateLoad = await delayedStartupLoad;
        const lateState = await state();
        report.observations.lateStartup = { loaded: lateLoad, currentDocument: lateState, behavior: '超时后自动加载被启动门闩拒绝并完整回滚，维持基础界面' };
        check('超时后的晚到主题被拒绝并完整回退', !lateLoad.success && lateLoad.results.some(item => !item.success && typeof item.message === 'string') &&
            !loadedBuiltin() && lateState.styles === 0 && !lateState.materialSeen && lateState.identity === base.identity && navigationCount === 1,
        report.observations.lateStartup);
        const restored = await evaluate(main, `window.electronAPI.reloadExtensions()`);
        await waitFor(async () => (await state()).ready?.success, '用户主动重载恢复主题');
        const active = await state();
        check('用户主动重载可恢复主题且不刷新文档', restored.success && Boolean(loadedBuiltin()) && active.styles === 1 &&
            active.identity === base.identity && navigationCount === 1, { restored, active, navigationCount });
    }
} catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    console.error(error.stack); exitCode = 1;
} finally {
    closePopup();
    if (releaseStartupLoad) {
        manager.loadChromeExtensions = originalStartupLoad;
        releaseStartupLoad();
        await delayedStartupLoad.catch(() => {});
    }
    if (extensions) {
        const cleanup = await extensions.cleanupExtensions();
        report.observations.finalCleanup = cleanup;
        if (!cleanup.success) exitCode = 1;
    }
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    if (api?.child && api.child.exitCode === null) {
        const closed = once(api.child, 'close'); api.child.kill(); await closed;
    }
    fs.writeFileSync(path.join(evidence, mode + '.json'), JSON.stringify(report, null, 2) + '\n');
    app.exit(exitCode);
}
}
app.whenReady().then(audit).catch(error => { console.error(error.stack); app.exit(1); });
