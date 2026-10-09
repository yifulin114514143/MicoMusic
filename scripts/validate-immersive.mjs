import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const [profile, mode = 'default'] = process.argv.slice(2);
assert.ok(['default', 'unthrottled'].includes(mode));
const reportName = mode === 'default' ? 'validation' : 'validation-unthrottled';
const runtime = path.join(root, 'artifacts/immersive-runtime') + path.sep;
assert.ok(profile && path.resolve(profile).startsWith(runtime), '只允许本次沉浸播放器隔离 profile');
for (const name of ['logs', 'temp']) fs.mkdirSync(path.join(profile, name), { recursive: true });
app.setName('MicoMusic 沉浸播放器隔离验收');
app.setPath('userData', profile);
app.setPath('logs', path.join(profile, 'logs'));
app.setPath('temp', path.join(profile, 'temp'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});
const evidence = path.join(root, 'docs/immersive/evidence/webgl');
fs.mkdirSync(evidence, { recursive: true });
function sourceState() {
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'src', 'electron', 'plugins/extensions/mico-liquid-glass', 'scripts', 'tests', 'package.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const sourceFiles = [...new Set(files)].sort().filter(file => fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile());
    const fingerprint = createHash('sha256');
    for (const file of sourceFiles) { fingerprint.update(file); fingerprint.update('\0'); fingerprint.update(fs.readFileSync(path.join(root, file))); fingerprint.update('\0'); }
    const rendererFiles = fs.readdirSync(path.join(root, 'dist'), { recursive: true }).sort().filter(file => fs.statSync(path.join(root, 'dist', file)).isFile());
    const renderer = createHash('sha256');
    for (const file of rendererFiles) { renderer.update(file); renderer.update('\0'); renderer.update(fs.readFileSync(path.join(root, 'dist', file))); renderer.update('\0'); }
    return { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        gitStatusShort: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
        sourceFingerprintSha256: fingerprint.digest('hex'), rendererFingerprintSha256: renderer.digest('hex'),
        sourceFiles, rendererFiles, interpretation: '当前工作树与生产构建；含未提交源码，不能只用 HEAD 标识本次运行内容' };
}
const report = { timestamp: new Date().toISOString(), mode, backgroundThrottling: mode !== 'unthrottled', electron: process.versions.electron, chromium: process.versions.chrome,
    platform: process.platform, validationRevision: 'webgl-hero-spring', sourceState: sourceState(), checks: [], observations: {},
    isolation: { userData: app.getPath('userData'), logs:app.getPath('logs'), temp:app.getPath('temp'), executable:app.getPath('exe'),
        interpretation:'仅本工作树 artifacts/immersive-runtime 中复制的Electron bundle与临时profile，不读取或迁移已安装音乐客户端profile' },
    limitations: ['真实生产 Vue/PlayerControl/AudioController/插件加载器的隔离 Electron 宿主；不是完整发行版主进程',
        'loopback WAV、原创 SVG 和 KRC 为技术 fixtures；不代表真实酷狗账号或真实酷狗歌曲播放验收',
        '截图与性能仅覆盖当前 macOS 设备；视觉通过仍须用户实际评审'] };
const check = (name, condition, detail = null) => {
    assert.ok(condition, name + (detail ? ': ' + JSON.stringify(detail) : ''));
    report.checks.push({ name, passed: true, detail }); console.log('通过：' + name);
};
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
const waitFor = async (fn, label, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('等待超时：' + label);
};
let main, popup, manager, extensions, fixtureServer;
let navigationCount = 0, exitCode = 0;
const requests = [], blockedExternal = [], rendererErrors = [];
const rendererConsole = [];
const testActions=[];
const duration = 180;
function makeWav(frequency) {
    const rate = 8000, buffer = Buffer.alloc(44 + rate * duration * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
    buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
    for (let i = 0; i < rate * duration; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * frequency) * 300), 44 + i * 2);
    return buffer;
}
const fixtureLines = [
    ['You ', 'must ', 'be ', 'talking ', 'crazy'],
    ['米可', '跟随', '音乐', '向前', '走'],
    ['A long sentence stays readable across the entire lyric pane without overflowing into the cover or controls.'],
    ['雨落', '窗边', '轻轻', '听见'], ['Another ', 'verse ', 'follows ', 'the ', 'clock'],
    ['音乐', '不会', '因', '界面', '重建'], ['Pause ', 'and ', 'resume ', 'in ', 'place'],
    ['继续', '跟随', '真实', '播放', '时间'], ['Final ', 'verse ', 'with ', 'timed ', 'words']
];
const translations = fixtureLines.map((_, index) => [`技术歌词翻译 ${index + 1}：这是原创的隔离验证文本`]);
const language = Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: translations },
    { type: 0, lyricContent: fixtureLines.map((_, index) => [`romanization ${index + 1}`]) }] })).toString('base64');
const krc = `[language:${language}]\n` + fixtureLines.map((words, index) => {
    const step = 10000 / words.length;
    return `[${index * 12000},10000]` + words.map((word, token) => `<${Math.round(token * step)},${Math.round(step)},0>${word}`).join('');
}).join('\n');
const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="warm" x2="1" y2="1"><stop stop-color="#ffaf36"/><stop offset=".48" stop-color="#ee5a21"/><stop offset="1" stop-color="#653552"/></linearGradient></defs><rect width="800" height="800" fill="url(#warm)"/><circle cx="560" cy="240" r="260" fill="#fbe698" opacity=".4"/><path d="M-100 690L440 120L970 830" fill="none" stroke="#f5c747" stroke-width="110" opacity=".6"/><text x="60" y="140" fill="white" font-family="sans-serif" font-size="80" font-weight="700">MICO</text><text x="62" y="208" fill="white" font-family="sans-serif" font-size="36">IMMERSIVE VALIDATION</text></svg>`;
async function serveFixtures() {
    const waves = [makeWav(220), makeWav(330)];
    let base;
    fixtureServer = http.createServer((req, res) => {
        const url = new URL(req.url, base); requests.push({ path: url.pathname, query: url.search });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (url.pathname === '/fixture-cover.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(cover); return; }
        if (url.pathname === '/fixture-cover-missing.svg') { res.writeHead(404); res.end('fixture: intentional missing cover'); return; }
        if (['/fixture-a.wav', '/fixture-b.wav'].includes(url.pathname)) {
            const bytes = waves[url.pathname === '/fixture-a.wav' ? 0 : 1];
            const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
            const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
            res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes');
            if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`); }
            res.setHeader('Content-Length', end - start + 1); res.end(bytes.subarray(start, end + 1)); return;
        }
        let data;
        if (url.pathname === '/search/lyric') data = { status: 200, candidates: url.searchParams.get('hash') === 'immersive-a' ? [{ id: 'fixture-krc-a', accesskey: 'fixture-access-key' }] : [] };
        else if (url.pathname === '/lyric') data = { status: 200, decodeContent: krc };
        else if (url.pathname === '/song/url') data = { status: 1, url: [base + (url.searchParams.get('hash') === 'immersive-b' ? '/fixture-b.wav' : '/fixture-a.wav')], timeLength: duration, extName: 'wav' };
        else if (url.pathname === '/register/dev') data = { status: 1, data: { dfid: 'isolated-technical-fixture' } };
        else if (url.pathname === '/song/climax' || url.pathname === '/images') data = { status: 0 };
        else { res.writeHead(404); res.end('fixture: endpoint not defined'); return; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));
    });
    await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${fixtureServer.address().port}`;
    return base;
}
const state = () => evaluate(main, `(() => {
    document.dispatchEvent(new CustomEvent('mico-validation-observation-request'));
    const html = document.documentElement, audio = window.__immersiveValidationAudios?.[0];
    const pluginObservation = JSON.parse(html.getAttribute('data-mico-validation-plugin-observation') || 'null');
    const background = document.querySelector('.mico-immersive-background');
    return { identity: window.__immersiveValidationIdentity, navigationCount: performance.getEntriesByType('navigation').length,
        ready: JSON.parse(html.getAttribute('data-mico-visual-ready') || 'null'),
        styles: document.querySelectorAll('#mico-liquid-glass-style').length,
        theme: html.getAttribute('data-mico-liquid-glass-theme'), blur: html.getAttribute('data-mico-liquid-glass-blur'), motion: html.getAttribute('data-mico-liquid-glass-motion'),
        immersive: document.querySelectorAll('.mico-immersive-player').length, legacy: document.querySelectorAll('.lyrics-bg').length,
        closeButtons: document.querySelectorAll('.mico-immersive-player [aria-label="退出沉浸播放器"]').length,
        audioCount: window.__immersiveValidationAudios?.length,
        pauseCalls:window.__immersiveValidationPauseCalls,
        inputEvents:window.__immersiveValidationInputEvents,
        clipboardWrites:window.__immersiveValidationClipboardWrites,
        audio: audio ? { time: audio.currentTime, paused: audio.paused, src: audio.src, duration: audio.duration, volume: audio.volume, speed: audio.playbackRate, loop: audio.loop } : null,
        song: JSON.parse(localStorage.getItem('current_song') || 'null'),
        activeListeners: window.__immersiveValidationListeners?.filter(item => item.active).length,
        activeObservers: window.__immersiveValidationObservers?.filter(item => item.active).length,
        pendingRAF: window.__immersiveValidationRAF?.pending.size,
        pluginObservation,
        fluid: JSON.parse(background?.getAttribute('data-mico-fluid-state') || 'null'),
        ownedCanvases: document.querySelectorAll('#mico-liquid-glass-canvas, .mico-immersive-background-canvas, .mico-immersive-glass-overlay').length,
        fluidDisposals: window.__immersiveValidationFluidDisposals,
        gl: pluginObservation?.gl || [],
        visibility: document.visibilityState,
        nativeVisible: html.getAttribute('data-mico-window-visible'),
        background: background ? { motion: background.getAttribute('data-motion'), blur: background.getAttribute('data-blur'),
            layers: [...background.querySelectorAll('.mico-immersive-background-layer')].map(node => ({ playState: getComputedStyle(node).animationPlayState, transform: getComputedStyle(node).transform })) } : null };
})()`);
const click = async selector => {
    testActions.push({action:'DOM click',selector,time:Date.now()});
    return evaluate(main, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('缺少控件：' + ${JSON.stringify(selector)}); node.focus(); node.click(); })()`);
};
const setInput = (selector, value, type = 'change') => evaluate(main, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('缺少输入控件：' + ${JSON.stringify(selector)}); node.value = ${JSON.stringify(String(value))}; node.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); })()`);
const pressedKey = async (keyCode, modifiers = []) => { testActions.push({action:'native key',keyCode,modifiers,time:Date.now()}); main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await new Promise(resolve => setTimeout(resolve, 80)); };
const loadedBuiltin = () => manager.getLoadedExtensions().find(item => item.manifest?.plugin_id === 'mico-liquid-glass');
async function settings(patch) {
    if (!popup || popup.isDestroyed()) {
        const extension = loadedBuiltin(); assert.ok(extension, '正式内置主题已加载');
        const result = await evaluate(main, `window.electronAPI.openExtensionPopup(${JSON.stringify(extension.id)})`);
        assert.ok(result.success, JSON.stringify(result));
        popup = await waitFor(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === `chrome-extension://${extension.id}/popup.html`), '真实插件设置弹窗');
        await waitFor(() => evaluate(popup, `Boolean(globalThis.MicoLiquidGlassSettings && document.getElementById('enabled') && !document.getElementById('enabled').disabled)`), '插件存储就绪');
        popup.hide();
    }
    const saved = await evaluate(popup, `(async () => { const config = globalThis.MicoLiquidGlassSettings; const stored = await chrome.storage.local.get(config.key);
        const value = config.normalize({ ...stored[config.key], ...${JSON.stringify(patch)} }); await chrome.storage.local.set({ [config.key]: value }); return value; })()`);
    await waitFor(async () => { const now = await state(); return now.ready?.success && now.ready.enabled === saved.enabled &&
        (saved.enabled ? now.styles === 1 && now.blur === (saved.lowBlur ? 'low' : 'normal') && now.motion === (saved.reduceMotion ? 'reduced' : 'normal') : now.styles === 0); }, '插件真实存储驱动即时启停');
    return saved;
}
const closePopup = () => { if (popup && !popup.isDestroyed()) popup.destroy(); popup = null; };
async function installPluginObservers() {
    if (!popup || popup.isDestroyed()) await settings({});
    const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/immersive-preload.cjs'), 'utf8');
    const start = fixture.indexOf('function installImmersiveObservers('), end = fixture.indexOf('\ncontextBridge.executeInMainWorld(');
    assert.ok(start >= 0 && end > start, '隔离世界观测函数由本次 fixture 的精确边界读取');
    const func = fixture.slice(start, end);
    const result = await evaluate(popup, `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(item => item.id === ${main.webContents.id} && item.url === ${JSON.stringify(main.webContents.getURL())});
        if (!tab) throw new Error('隔离观测的实际 renderer tab 未找到');
        return chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', args: [true], func: ${func} });
    })()`);
    assert.ok(result.length === 1, '只观测本次技术播放器文档');
    report.observations.instrumentation = { mainWorld: '生产 Audio、歌词滚动、DOM 监听、RAF 的原生返回值观测',
        pluginWorld: '进入播放器前，通过实际插件 popup 的 chrome.scripting.executeScript 注入相同观测函数；不改业务 shader、uniforms 或音频',
        fixtureSha256: createHash('sha256').update(fixture).digest('hex') };
}
const continuity = (name, before, after, paused = false) => check(name, after.identity === before.identity && navigationCount === 1 && after.audioCount === 1 &&
    before.audio.src === after.audio.src && after.audio.paused === paused && (paused ? Math.abs(after.audio.time - before.audio.time) < 0.15 : after.audio.time >= before.audio.time), { before: before.audio, after: after.audio, audioCount: after.audioCount, navigationCount });
async function capture(name) {
    // Electron 原生输入将 renderer 指针移到空边，避免 :hover 改变歌词层级。
    main.webContents.sendInputEvent({ type: 'mouseMove', x: 8, y: 8 });
    const snapshot = () => evaluate(main, `(() => {
        const stage = document.querySelector('.mico-immersive-lyrics'), row = document.querySelector('.mico-lyric-active') || document.querySelector('.mico-lyric-focused');
        const rect = node => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };
        const css = row ? getComputedStyle(row) : null;
        return { stage: rect(stage), row: rect(row), primary: rect(row?.querySelector('.mico-lyric-primary')), scrollTop: stage?.scrollTop ?? 0,
            index: row?.getAttribute('data-mico-lyric-index') ?? null, opacity: css?.opacity ?? null, filter: css?.filter ?? null, transform: css?.transform ?? null,
            width: innerWidth, height: innerHeight, devicePixelRatio, hoveredLyric: Boolean(document.querySelector('.mico-lyric-row:hover')) };
    })()`);
    let previous, stable = 0, settled;
    await waitFor(async () => {
        const current = await snapshot();
        const numeric = ['y', 'height'];
        const quiet = previous && current.index === previous.index && current.filter === previous.filter && current.transform === previous.transform &&
            Math.abs(Number(current.opacity) - Number(previous.opacity)) < 0.001 && Math.abs(current.scrollTop - previous.scrollTop) < 0.35 &&
            ['stage', 'row', 'primary'].every(key => current[key] && previous[key] ? numeric.every(field => Math.abs(current[key][field] - previous[key][field]) < 0.35) : current[key] === previous[key]);
        stable = quiet ? stable + 1 : 0; previous = current;
        if (stable >= 5 && !current.hoveredLyric) { settled = current; return true; }
        await new Promise(resolve => setTimeout(resolve, 60)); return false;
    }, '截图前实际滚动与样式过渡稳定：' + name, 8000);
    await evaluate(main, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const filename = name + (mode === 'unthrottled' ? '-unthrottled' : '');
    const png = await main.webContents.capturePage();
    fs.writeFileSync(path.join(evidence, filename + '.png'), png.toPNG());
    const center = box => box && settled.stage ? (box.y + box.height / 2 - settled.stage.y) / settled.stage.height : null;
    report.observations.captures ??= {};
    report.observations.captures[filename] = { ...settled, rowCenterRatio: center(settled.row), primaryCenterRatio: center(settled.primary),
        capturedImageSize: png.getSize(), interpretation: '实际 CSS 视口、DPR、字形/行组框；已去除指针 hover 并等待连续5次布局稳定；插件启用时背景来自实际 WebGL 流体输出' };
}
const geometry = () => evaluate(main, `(() => { const data = { width: innerWidth, height: innerHeight }; for (const selector of ['.mico-immersive-cover', '.mico-immersive-controls', '.mico-immersive-lyrics-pane', '.mico-immersive-song-title', '.mico-immersive-progress-track']) { const node = document.querySelector(selector); const r = node?.getBoundingClientRect(); if (r) data[selector] = { x: r.x, y: r.y, width: r.width, height: r.height }; } return data; })()`);
const frames = () => evaluate(main, `new Promise(resolve => { const samples = []; let last; const frame = time => { if (last !== undefined) samples.push(time - last); last = time;
    if (samples.length === 180) { const sorted = [...samples].sort((a,b) => a-b); resolve({ frames: samples.length, medianMs: sorted[90], p95Ms: sorted[171], maxMs: sorted.at(-1), over33Ms: samples.filter(value => value > 33.4).length }); } else requestAnimationFrame(frame); }; requestAnimationFrame(frame); })`);

const glLiveResources = snapshot => (snapshot.gl || []).reduce((total, context) => total + Object.values(context.active).reduce((sum, count) => sum + count, 0), 0);
const springState = () => evaluate(main, `(() => { const node = document.querySelector('.mico-immersive-lyrics'); if (!node) return null;
    return { phase: node.getAttribute('data-mico-lyric-spring'), position: Number(node.getAttribute('data-mico-lyric-spring-position')),
        velocity: Number(node.getAttribute('data-mico-lyric-spring-velocity')), target: Number(node.getAttribute('data-mico-lyric-spring-target')),
        scrollTop: node.scrollTop, scrollBehavior: getComputedStyle(node).scrollBehavior,
        smoothCalls: window.__immersiveValidationLyricScrollCalls.filter(call => call.args[0]?.behavior === 'smooth').length }; })()`);
async function stoppedGL(name, { allowStaticControlUpdates = false } = {}) {
    await waitFor(async () => (await state()).fluid?.rafPending === false, name + '：原生 GL RAF 已停止');
    const before = await state(); await new Promise(resolve => setTimeout(resolve, 350)); const after = await state();
    check(name, (allowStaticControlUpdates || before.fluid.frameCount === after.fluid.frameCount) && before.fluid.timeSeconds === after.fluid.timeSeconds && after.fluid.rafPending === false && after.pluginObservation.pendingRAF === 0,
        { before: { frames: before.fluid.frameCount, time: before.fluid.timeSeconds }, after: { frames: after.fluid.frameCount, time: after.fluid.timeSeconds },
            staticControlUpdateFrames:after.fluid.frameCount-before.fluid.frameCount,
            interpretation:allowStaticControlUpdates?'播放进度value/max的事件可触发一次静态材质重画；流体时间冻结且无持续RAF':'已暂停或不可见时不得有新GL帧' });
}
async function readGL(regions, trigger) {
    await evaluate(main, `(() => { const root = document.documentElement;
        root.removeAttribute('data-mico-validation-gl-readback');
        root.setAttribute('data-mico-validation-gl-request', ${JSON.stringify(JSON.stringify({canvasId:'mico-liquid-glass-canvas', regions}))});
        document.dispatchEvent(new CustomEvent('mico-validation-readback-request'));
    })()`);
    if (trigger) await trigger();
    return waitFor(() => evaluate(main, `JSON.parse(document.documentElement.getAttribute('data-mico-validation-gl-readback') || 'null')`), '自然 GL draw 后真实像素读回', 3000);
}
const readOutputCanvas = (selector, regions) => evaluate(main, `(() => {
    const canvas = document.querySelector(${JSON.stringify(selector)}); if (!canvas) throw new Error('实际输出canvas未找到');
    const context = canvas.getContext('2d'), css = canvas.getBoundingClientRect();
    return { regions: ${JSON.stringify(regions)}.map(region => {
        const x=Math.round((region.x-css.x)*canvas.width/css.width), y=Math.round((region.y-css.y)*canvas.height/css.height);
        const width=Math.round(region.width*canvas.width/css.width), height=Math.round(region.height*canvas.height/css.height);
        return {name:region.name,x,y,width,height,pixels:Array.from(context.getImageData(x,y,width,height).data)};
    }) };
})()`);
function pixelSummary(sample) {
    const bytes = Buffer.from(sample.pixels), average = [0, 0, 0];
    for (let index = 0; index < bytes.length; index += 4) for (let channel = 0; channel < 3; channel++) average[channel] += bytes[index + channel];
    return { name: sample.name, width: sample.width, height: sample.height, sha256: createHash('sha256').update(bytes).digest('hex'),
        meanRGB: average.map(value => value / (bytes.length / 4)) };
}
function pixelDifference(first, second) {
    assert.equal(first.pixels.length, second.pixels.length, '比较同尺寸真实 GL 像素');
    let sum = 0, changed = 0;
    for (let index = 0; index < first.pixels.length; index += 4) {
        let delta = 0; for (let channel = 0; channel < 3; channel++) delta += Math.abs(first.pixels[index + channel] - second.pixels[index + channel]);
        sum += delta; if (delta > 6) changed++;
    }
    const pixels = first.pixels.length / 4;
    return { meanChannelDifference: sum / pixels / 3, changedPixelFraction: changed / pixels };
}
async function heroSample(action, opening) {
    const before = await state(), samples = [], started = Date.now(); await action();
    await waitFor(async () => {
        const sample = await evaluate(main, `(() => { const root = document.querySelector('.mico-immersive-player'), cover = root?.querySelector('.mico-immersive-cover');
            const r = cover?.getBoundingClientRect(); return { phase: root?.getAttribute('data-mico-hero-phase') || null,
                cover: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
                fadeOpacities: root ? [...root.querySelectorAll('.mico-immersive-song-row, .mico-immersive-progress, .mico-immersive-controls, .mico-immersive-lyrics-pane, .mico-immersive-footer, .mico-immersive-close')].map(node => Number(getComputedStyle(node).opacity)) : [],
                animations: cover ? cover.getAnimations().map(animation => ({ currentTime: animation.currentTime, playState: animation.playState,
                    duration: animation.effect?.getTiming().duration, progress: animation.effect?.getComputedTiming().progress })) : [] }; })()`);
        samples.push({ elapsedMs: Date.now() - started, ...sample });
        if (opening ? sample.phase === 'open' : !sample.phase) return true;
        await new Promise(resolve => setTimeout(resolve, 18)); return false;
    }, opening ? '真实 Hero 入场结束' : '真实 Hero 退场结束', 2500);
    const moving = samples.filter(sample => sample.phase === (opening ? 'opening' : 'closing'));
    check(opening ? 'Hero 入场具备真实 WAAPI 与多帧封面几何' : 'Hero 退场结束前保留真实封面与音频', moving.length >= 2 &&
        moving.some(sample => sample.animations.some(animation => animation.duration === 450 && animation.playState === 'running')),
        { samples, before: before.audio, after: (await state()).audio });
    if (!opening) {
        const hiddenControls = moving.filter(sample => sample.elapsedMs >= 220 && sample.elapsedMs <= 400);
        check('Hero 退场时已消失的控制和歌词保持透明至封面退出完成', hiddenControls.length > 0 && hiddenControls.every(sample => sample.fadeOpacities.every(value => value <= .05)), hiddenControls);
    }
    const after = await state(); continuity(opening ? 'Hero 入场复用现有 Audio' : 'Hero 退场复用现有 Audio', before, after, before.audio.paused);
    return samples;
}
async function heroReversal() {
    const before = await state();
    await click('.player-bar .album-art');
    await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-player')?.getAttribute('data-mico-hero-phase') === 'opening'`), '中途退出前正在 Hero 入场');
    await new Promise(resolve => setTimeout(resolve, 110));
    const reversal = await evaluate(main, `(() => {
        const root = document.querySelector('.mico-immersive-player'), cover = root.querySelector('.mico-immersive-cover');
        const snapshot = () => { const r = cover.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height,
            transform:getComputedStyle(cover).transform, animations:cover.getAnimations().filter(a=>a.playState==='running').length }; };
        const before = snapshot(); root.querySelector('.mico-immersive-close').click(); const after = snapshot();
        return { before, after, phase:root.getAttribute('data-mico-hero-phase') };
    })()`);
    const discontinuity = Math.max(...['x','y','width','height'].map(key => Math.abs(reversal.before[key]-reversal.after[key])));
    check('Hero 入场中途退出从当前真实封面几何连续反转', discontinuity < 2 && reversal.before.animations === 1 && reversal.after.animations === 1,
        { ...reversal, maxGeometryJumpPx: discontinuity });
    await waitFor(async () => (await state()).immersive === 0 && (await state()).legacy === 0, '中途反转退出完成');
    continuity('Hero 中途反转不刷新文档、不重建或暂停 Audio', before, await state(), before.audio.paused);
}
async function menuReversal() {
    await click('.mico-immersive-more');
    await new Promise(resolve => setTimeout(resolve, 80));
    await click('.mico-immersive-more');
    await new Promise(resolve => setTimeout(resolve, 50));
    await click('.mico-immersive-more');
    await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-menu-anchor')?.getAttribute('data-mico-menu-phase') === 'open'`), '菜单两次中途反转后打开');
    check('菜单中途反转后唯一菜单正常交互且不遗留运行动画', await evaluate(main, `(() => {
        const menus = document.querySelectorAll('#mico-immersive-options'); return menus.length === 1 && !menus[0].inert &&
            menus[0].getAnimations().filter(a=>a.playState==='running').length === 0;
    })()`));
    await click('.mico-immersive-more');
    await waitFor(() => evaluate(main, `!document.querySelector('#mico-immersive-options')`), '菜单退场后实际移除');
}
async function fluidAndGlassEvidence() {
    await waitFor(async () => { const now = await state(); return now.fluid?.phase === 'ready' && now.fluid.paletteStatus === 'loaded' && now.fluid.paletteSource === 'cover' && now.gl.some(record => record.draws > 0); }, '插件隔离世界真实 WebGL、封面提色与自然 draw');
    await new Promise(resolve => setTimeout(resolve, 1700));
    const start = await state(), records = start.gl.filter(record => record.canvasId === 'mico-liquid-glass-canvas' && Object.values(record.active).some(Boolean));
    check('真实 WebGL shader 编译和程序链接均成功', records.length === 1 && records[0].compiles.length >= 8 && records[0].links.length === 4 &&
        records[0].compiles.every(item => item.success) && records[0].links.every(item => item.success), records);
    const palette = records[0].paletteUniform;
    check('背景颜色来自真实暖色封面像素并传入 GL uniform', palette?.length === 12 && palette[0] > palette[2] + .15 && start.fluid.paletteSource === 'cover',
        { paletteUniform:palette, source:start.fluid.paletteSource, status:start.fluid.paletteStatus });
    const regions = [{ name:'fluid', x:30,y:90,width:96,height:96 }];
    const first = await readOutputCanvas('.mico-immersive-background-canvas', regions); await new Promise(resolve => setTimeout(resolve, 1200)); const second = await readOutputCanvas('.mico-immersive-background-canvas', regions);
    const difference = pixelDifference(first.regions[0], second.regions[0]);
    check('真实噪声流体随播放时钟产生连续像素变化', difference.meanChannelDifference > .15 && difference.changedPixelFraction > .015 &&
        (await state()).fluid.timeSeconds > start.fluid.timeSeconds, difference);
    report.observations.fluidPixelReadback = { first:pixelSummary(first.regions[0]), second:pixelSummary(second.regions[0]), difference,
        interpretation:'真实GL流体绘制后复制到可见2d背景输出，读取实际像素；不调用额外draw，不以CSS animation状态代替像素运动' };
    check('实际封面安全上传并自然绘入单 GL 场景纹理供玻璃折射', (await state()).fluid.coverSceneStatus === 'ready' && (await state()).fluid.coverSceneDraws > 0 && !(await state()).fluid.coverSceneError && (await state()).ownedCanvases === 3, (await state()).fluid);
    await click('.mico-immersive-play'); await waitFor(async () => (await state()).audio.paused, '玻璃差分前暂停同一真实 Audio');
    await stoppedGL('暂停并完成有限过渡后 GL 帧与时间停止');
    await evaluate(main, `document.querySelector('.mico-immersive-close').focus()`);
    for (const modifier of ['meta','control']) {
        const count=(await state()).clipboardWrites.length;
        await pressedKey('C',[modifier]);
        await waitFor(async () => (await state()).clipboardWrites.length===count+1, '按钮焦点 '+modifier+'+C 调用真实生产复制函数');
        check('按钮焦点 '+modifier+'+C 保留原歌词复制内容', (await state()).clipboardWrites.at(-1).includes('You must be talking crazy') && (await state()).clipboardWrites.at(-1).includes('技术歌词翻译'),
            {modifier,writeCount:(await state()).clipboardWrites.length,interpretation:'fixture截取navigator.clipboard.writeText文本；不改用户系统剪贴板，不覆盖原生写入验收'});
    }
    await pressedKey('Tab');
    await waitFor(() => evaluate(main, `document.activeElement===document.querySelector('.mico-immersive-more')`), '真实Tab焦点从close到more');
    const beforeSeekFocus=await state();
    await pressedKey('Tab');
    await waitFor(() => evaluate(main, `document.activeElement===document.querySelector('.mico-immersive-seek')`), '真实Tab聚焦进度条');
    const seekBox=await evaluate(main, `(() => {const n=document.querySelector('.mico-immersive-seek'),r=n.getBoundingClientRect();
        const ratio=(Number(n.value)-Number(n.min))/(Number(n.max)-Number(n.min));return {x:r.x+5.5+ratio*(r.width-11)-8,y:r.y+r.height/2-8,width:16,height:16};})()`);
    await waitFor(async () => {const s=await state();return s.fluid?.rafPending===false&&s.fluid.frameCount>beforeSeekFocus.fluid.frameCount&&s.fluid.shapes>beforeSeekFocus.fluid.shapes;}, '键盘聚焦后单帧滑块材质绘制完成');
    const focused=await readOutputCanvas('.mico-immersive-glass-overlay',[{name:'seek-focus',...seekBox}]), focusShapes=(await state()).fluid.shapes;
    await pressedKey('Tab');
    await waitFor(() => evaluate(main, `document.activeElement!==document.querySelector('.mico-immersive-seek')`), '真实Tab移出进度条');
    await waitFor(async () => {const s=await state();return s.fluid?.rafPending===false&&s.fluid.shapes<focusShapes;}, '失焦后单帧滑块材质绘制完成');
    const unfocused=await readOutputCanvas('.mico-immersive-glass-overlay',[{name:'seek-focus',...seekBox}]), differenceFocus=pixelDifference(focused.regions[0],unfocused.regions[0]);
    check('暂停时键盘focus/blur刷新真实玻璃滑块且保持音频暂停', differenceFocus.changedPixelFraction>.01 && focusShapes>(await state()).fluid.shapes && (await state()).audio.paused,
        {focused:pixelSummary(focused.regions[0]),unfocused:pixelSummary(unfocused.regions[0]),difference:differenceFocus,focusShapes,blurShapes:(await state()).fluid.shapes});
    await click('.mico-immersive-more');
    await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-menu-anchor')?.getAttribute('data-mico-menu-phase') === 'open'`), '光学材质菜单打开');
    const box = await evaluate(main, `(() => { const r = document.querySelector('#mico-immersive-options').getBoundingClientRect(); return {x:r.x+10,y:r.y+10,width:60,height:60}; })()`);
    const pointerFrame = () => { main.webContents.sendInputEvent({ type:'mouseMove', x:8, y:10 }); };
    const open = await readGL([{name:'menu',...box}], pointerFrame);
    const overlap = await evaluate(main, `(() => { const menu=document.querySelector('#mico-immersive-options'), cover=document.querySelector('.mico-immersive-cover');
        const a=menu.getBoundingClientRect(), b=cover.getBoundingClientRect();
        const left=Math.max(a.left,b.left), right=Math.min(a.right,b.right), top=Math.max(a.top,b.top), bottom=Math.min(a.bottom,b.bottom);
        const action=menu.querySelector('.mico-immersive-menu-action'), r=action.getBoundingClientRect();
        return {intersection:{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},
            controlAboveGlass:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.mico-immersive-menu-action')===action,
            overlayZ:getComputedStyle(document.querySelector('.mico-immersive-glass-overlay')).zIndex};
    })()`);
    check('玻璃菜单覆盖封面区域且 DOM 文本与按钮仍可交互', overlap.intersection.width > 20 && overlap.intersection.height > 20 && overlap.controlAboveGlass, overlap);
    const overlay = await readOutputCanvas('.mico-immersive-glass-overlay', [{name:'cover-menu-intersection', x:overlap.intersection.x+4,y:overlap.intersection.y+4,width:16,height:16}]);
    check('封面交叠区域实际透明玻璃输出含折射颜色与alpha', overlay.regions[0].pixels.some((value,index)=>index%4===3&&value>0) && overlay.regions[0].pixels.some((value,index)=>index%4!==3&&value>0), pixelSummary(overlay.regions[0]));
    await capture('13-glass-cover-overlap');
    await click('.mico-immersive-more'); await waitFor(() => evaluate(main, `!document.querySelector('#mico-immersive-options')`), '光学材质菜单关闭');
    const closed = await readGL([{name:'menu',...box}], () => { main.webContents.sendInputEvent({ type:'mouseMove',x:8,y:9 }); });
    const materialDifference = pixelDifference(open.regions[0], closed.regions[0]);
    check('暂停流体时菜单玻璃改变真实 framebuffer 内折射与高光像素', materialDifference.meanChannelDifference > .1 && materialDifference.changedPixelFraction > .01, materialDifference);
    report.observations.glassPixelReadback = { menuRegion:box, open:pixelSummary(open.regions[0]), closed:pixelSummary(closed.regions[0]), difference:materialDifference,
        interpretation:'暂停背景后比较菜单有无时同区域GL像素；排除HTML字形与CSS层，仅证明光学shader真实输出，视觉等效仍由用户评审' };
    await menuReversal();
    await click('.mico-immersive-play'); await waitFor(async () => !(await state()).audio.paused, '光学材质比较后恢复原 Audio');
    await recordMotionVideo();
    const beforeLoss = await state();
    const lossSupported = await evaluate(main, `(() => {
        const gl=document.querySelector('#mico-liquid-glass-canvas').getContext('webgl');
        window.__immersiveValidationContextLoss=gl.getExtension('WEBGL_lose_context');
        if (!window.__immersiveValidationContextLoss) return false;
        window.__immersiveValidationContextLoss.loseContext(); return true;
    })()`);
    check('实际上下文提供可验证的 WEBGL_lose_context 扩展', lossSupported);
    await waitFor(async () => (await state()).fluid?.phase === 'context-lost', '真实 contextlost 进入生产静态回退');
    check('真实 contextlost 释放 GL 对象、隐藏旧输出并保留 DOM 播放控制', glLiveResources(await state()) === 0 && await evaluate(main, `(() => {
        return document.documentElement.getAttribute('data-mico-fluid-renderer')==='css' &&
            [...document.querySelectorAll('.mico-immersive-background-canvas,.mico-immersive-glass-overlay')].every(node=>getComputedStyle(node).display==='none') &&
            getComputedStyle(document.querySelector('.mico-immersive-play')).display!=='none';
    })()`), (await state()).fluid);
    await stoppedGL('真实上下文丢失后不继续 GL RAF');
    await capture('14-context-loss-fallback');
    await evaluate(main, `window.__immersiveValidationContextLoss.restoreContext()`);
    await waitFor(async () => { const now=await state(); return now.fluid?.phase==='ready' && now.fluid.coverSceneStatus==='ready' && now.gl.some(record=>record.losses>0&&record.restores>0); }, '真实 contextrestored 重建纹理并恢复');
    continuity('上下文 loss/restore 保留原 Audio、歌曲和文档', beforeLoss, await state());
}
async function recordMotionVideo() {
    const encoder = '/opt/homebrew/bin/ffmpeg';
    assert.ok(fs.statSync(encoder, { throwIfNoEntry: false })?.isFile(), '已读取现有 ffmpeg 编码器，未安装新依赖');
    const filename = '11-webgl-motion' + (mode === 'unthrottled' ? '-unthrottled' : '') + '.mp4';
    const destination = path.join(evidence, filename), timestamps = [];
    const child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', '10', '-i', 'pipe:0',
        '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
    const completion = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('真实帧 MP4 编码失败：' + errors))); });
    const started = performance.now();
    try {
        for (let index = 0; index < 80; index++) {
            if (index === 10) await click('.mico-immersive-more');
            if (index === 32) await click('.mico-immersive-more');
            if (index === 48) await click('.mico-immersive-more');
            if (index === 68) await click('.mico-immersive-more');
            const elapsed = performance.now() - started;
            if (elapsed < index * 100) await new Promise(resolve => setTimeout(resolve, index * 100 - elapsed));
            const frame = await main.webContents.capturePage();
            timestamps.push(performance.now() - started);
            const videoFrame=frame.resize({width:1470,height:848});
            if (!child.stdin.write(videoFrame.toJPEG(90))) await new Promise(resolve => child.stdin.once('drain', resolve));
        }
        child.stdin.end(); await completion;
    } catch (error) { child.kill(); throw error; }
    const elapsedMs = timestamps.at(-1) - timestamps[0];
    report.observations.motionVideo = { file: filename, capturedFrames: timestamps.length, elapsedMs, frameTimestampsMs: timestamps,
        encoder, outputSize:{width:1470,height:848}, jpegQuality:90,
        interpretation: 'Electron capturePage 连续真实帧由Retina尺寸缩至实际CSS视口尺寸并JPEG90编码后生成10fps约8秒视频；采样时间逐帧记录，没有合成或伪造场景' };
    check('动态证据由连续实际帧生成至少5秒视频', timestamps.length === 80 && elapsedMs >= 5000 && fs.statSync(destination).size > 1000, report.observations.motionVideo);
}

async function audit() {
    try {
        const baseUrl = await serveFixtures();
        ipcMain.on('get-api-base-url', event => { event.returnValue = baseUrl; });
        ipcMain.handle('get-api-endpoints', () => ({ apiBaseUrl: baseUrl, websocketUrl: '' }));
        ({ default: manager } = await import('../electron/extensions/extensionManager.js'));
        extensions = await import('../electron/extensions/extensions.js');
        const initialized = await extensions.initializeExtensions();
        check('正式插件及生产生命周期初始化成功', initialized.success, initialized);
        check('生产插件目录属于本次隔离 profile', manager.getExtensionsDirectory() === path.join(profile, 'extensions'));
        const onboarding = await import('../src/config/onboardingGuide.js');
        const songs = [{ id: 1, hash: 'immersive-a', playHash: 'immersive-a', name: '隔离验收 · Warm Canvas', author: 'MicoMusic 技术音频', img: baseUrl + '/fixture-cover.svg', url: baseUrl + '/fixture-a.wav', timeLength: duration },
            { id: 2, hash: 'immersive-b', playHash: 'immersive-b', name: '隔离验收 · 无歌词 / 坏封面', author: 'MicoMusic 技术音频', img: baseUrl + '/fixture-cover-missing.svg', url: baseUrl + '/fixture-b.wav', timeLength: duration }];
        const initialStorage = [[onboarding.ONBOARDING_GUIDE_INTRO_STORAGE_KEY, onboarding.ONBOARDING_GUIDE_VERSION],
            ...onboarding.onboardingGuideGroups.map(guide => [guide.storageKey || `${onboarding.ONBOARDING_GUIDE_STORAGE_PREFIX}${guide.key}:version`, guide.version]),
            ['settings', JSON.stringify({ navigationMode: 'top', playerBarLayout: 'full', lyricsTranslation: 'on', loudnessNormalization: 'off' })],
            ['MoeData', JSON.stringify({ UserInfo: null, Config: null, Device: { dfid: 'isolated-technical-fixture' } })],
            ['current_song', JSON.stringify(songs[0])], ['MusicQueue', JSON.stringify({ queue: songs })],
            ['player_progress', '0'], ['player_volume', '20'], ['player_speed', '1'], ['player_playback_mode', '1']];
        ipcMain.on('immersive-initial-storage', event => { event.returnValue = initialStorage; });
        main = new BrowserWindow({ width: 1470, height: 924, useContentSize: true, frame: false, title: 'MicoMusic 沉浸播放器隔离验收', show: true,
            webPreferences: { preload: path.join(root, 'tests/fixtures/immersive-preload.cjs'), contextIsolation: true, nodeIntegration: false,
                sandbox: false, webSecurity: false, backgroundThrottling: mode !== 'unthrottled' } });
        const { attachVisualWindowVisibility } = await import('../electron/services/visualWindowVisibility.js');
        attachVisualWindowVisibility(main);
        main.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) navigationCount++; });
        main.webContents.on('console-message', (_event, level, message) => { rendererConsole.push({level,message}); if (level >= 2) rendererErrors.push(message); });
        main.webContents.on('preload-error', (_event, filename, error) => rendererErrors.push(`preload ${filename}: ${error.message}`));
        main.webContents.session.webRequest.onBeforeRequest((details, callback) => {
            const external = /^https?:/.test(details.url) && !details.url.startsWith(baseUrl + '/');
            if (external) blockedExternal.push(details.url); callback({ cancel: external });
        });
        await main.loadFile(path.join(root, 'dist/index.html'), { hash: '/settings' });
        await waitFor(async () => { const now = await state(); return now.ready?.success && now.audioCount === 1 && now.audio?.duration === duration && now.nativeVisible === 'true'; }, '生产 Vue/AudioController/WAV 元数据与原生可见性');
        check('真实宿主 helper 经生产 preload 提供可见状态', main.webContents.getBackgroundThrottling() === (mode !== 'unthrottled') && (await state()).nativeVisible === 'true');
        check('真实生产播放器恢复两歌曲 fixture 队列', await evaluate(main, `JSON.parse(localStorage.getItem('MusicQueue')).queue.length === 2 && Boolean(document.querySelector('.player-bar .album-art'))`));
        await installPluginObservers();
        await capture('01-base-entry');
        await heroReversal();
        report.observations.heroOpening = await heroSample(() => click('.player-bar .album-art'), true);
        await waitFor(async () => (await state()).immersive === 1, '真实封面 click 进入沉浸视图');
        await waitFor(() => evaluate(main, `document.querySelectorAll('.mico-lyric-row').length > 0`), '生产 LyricsHandler 解析 KRC');
        check('沉浸界面只有一个关闭入口，旧界面未挂载', (await state()).closeButtons === 1 && (await state()).legacy === 0);
        check('进入后键盘焦点落到退出按钮', await evaluate(main, `document.activeElement === document.querySelector('.mico-immersive-close')`));
        await evaluate(main, `document.querySelector('.mico-immersive-tools button:last-child').focus()`);
        await pressedKey('Tab');
        check('Tab 从末尾回到唯一退出按钮', await evaluate(main, `document.activeElement === document.querySelector('.mico-immersive-close')`));
        await pressedKey('Tab', ['shift']);
        check('Shift+Tab 从退出按钮回到末尾工具', await evaluate(main, `document.activeElement === document.querySelector('.mico-immersive-tools button:last-child')`));
        main.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: 8, y: 8, clickCount: 1 });
        main.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: 8, y: 8, clickCount: 1 });
        await click('.mico-immersive-play');
        await waitFor(async () => !(await state()).audio.paused && (await state()).audio.time > 0.1, '真实 Audio 开始技术播放');
        await waitFor(async () => (await state()).background.motion === 'flow', '播放背景流动');
        check('播放状态使插件 WebGL 流体运行', (await state()).fluid?.rafPending === true);
        check('真实 KRC word 标记产生逐词填充，翻译来自 language 数据', await evaluate(main, `document.querySelector('.mico-lyric-active')?.getAttribute('data-mico-lyric-timing') === 'word' && document.querySelectorAll('.mico-lyric-active .mico-lyric-token').length === 5 && document.querySelector('.mico-lyric-secondary')?.textContent.includes('技术歌词翻译')`));
        const wordFrames = [];
        for (let index = 0; index < 8; index++) {
            wordFrames.push(await evaluate(main, `({ audioTime:window.__immersiveValidationAudios[0].currentTime,
                clock:document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-clock'),
                fill:[...document.querySelectorAll('.mico-lyric-active .mico-lyric-token')].map(n=>n.style.getPropertyValue('--mico-word-fill')) })`));
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        check('逐词填充由原生 Audio 时钟连续更新', wordFrames.some(frame => frame.clock === 'running') && new Set(wordFrames.map(frame => JSON.stringify(frame.fill))).size >= 3,
            wordFrames);
        await capture('02-wide-word-lyrics');
        const wide = await geometry(); report.observations.wideGeometry = wide;
        const coverRect = wide['.mico-immersive-cover'], lyricsRect = wide['.mico-immersive-lyrics-pane'];
        check('宽屏封面与歌词起点匹配附图比例', Math.abs(coverRect.x / wide.width - 0.118) < 0.015 && Math.abs(coverRect.width / wide.width - 0.264) < 0.015 &&
            Math.abs(coverRect.height - coverRect.width) < 1 && Math.abs(lyricsRect.x / wide.width - 0.513) < 0.02, wide);
        await fluidAndGlassEvidence();
        await setInput('.mico-immersive-seek', 25, 'input'); await setInput('.mico-immersive-seek', 25);
        await waitFor(async () => Math.abs((await state()).audio.time - 25) < 1.5, '真实 seek');
        check('进度控件调整生产 Audio 当前时间', true, (await state()).audio);
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-active') === '2'`), 'seek 后实际当前行');
        const springFrames = [];
        await waitFor(async () => { const sample = await springState(); springFrames.push(sample); return sample?.phase === 'idle' && Math.abs(sample.target-sample.scrollTop) < 2; }, '真实 ODE 弹簧跟随稳定', 4000);
        check('歌词通过 ODE 弹簧逐帧滚动并稳定到目标，不使用浏览器smooth滚动', springFrames.length >= 2 && springFrames.some(sample => sample.phase === 'running' && Math.abs(sample.velocity) > 1) && springFrames.every(sample => sample.smoothCalls === 0 && sample.scrollBehavior === 'auto'), springFrames);
        check('长句按原歌词结构换行且不越出歌词行', await evaluate(main, `(() => { const row = document.querySelector('.mico-lyric-active'); const text = row?.querySelector('.mico-lyric-primary'); if (!row || !text) return false; const r = text.getBoundingClientRect(), box = row.getBoundingClientRect(); return r.width <= box.width + 1 && text.scrollWidth <= text.clientWidth + 1; })()`));
        await capture('03-long-line-and-translation');
        await click('.mico-immersive-more');
        await waitFor(() => evaluate(main, `Boolean(document.querySelector('#mico-immersive-options'))`), '更多菜单');
        await setInput('.mico-immersive-volume-range', 40, 'input');
        await waitFor(async () => Math.abs((await state()).audio.volume - 0.16) < 0.001, '音量平方映射');
        check('音量控件使用生产 AudioController 平方曲线', true, (await state()).audio.volume);
        await setInput('select[aria-label="播放速度"]', 1.25);
        await waitFor(async () => (await state()).audio.speed === 1.25, '真实播放速度');
        check('速度控件修改原音频 playbackRate 并持久化', await evaluate(main, `localStorage.getItem('player_speed') === '1.25'`));
        await setInput('select[aria-label="播放模式"]', 2);
        await waitFor(async () => (await state()).audio.loop, '单曲循环');
        check('播放模式控件修改实际 loop 与原持久化键', await evaluate(main, `localStorage.getItem('player_playback_mode') === '2'`));
        await setInput('select[aria-label="播放模式"]', 1);
        await setInput('select[aria-label="播放速度"]', 1);
        await click('#mico-immersive-options input[type="checkbox"]');
        await waitFor(() => evaluate(main, `document.querySelectorAll('.mico-lyric-secondary').length === 0`), '关闭翻译');
        check('翻译开关只控制真实副文本', true);
        await click('#mico-immersive-options input[type="checkbox"]');
        await waitFor(() => evaluate(main, `document.querySelectorAll('.mico-lyric-secondary').length > 0`), '恢复翻译');
        await capture('04-options');
        await pressedKey('Escape');
        await waitFor(() => evaluate(main, `!document.querySelector('#mico-immersive-options') && document.querySelector('.mico-immersive-menu-anchor')?.getAttribute('data-mico-menu-phase')==='closed'`), 'Escape 菜单真实退场动画结束并移除DOM');
        check('菜单打开时 Escape 只关闭菜单，保留沉浸界面', await evaluate(main, `!document.querySelector('#mico-immersive-options') && Boolean(document.querySelector('.mico-immersive-player'))`));
        await click('.mico-immersive-more');
        await evaluate(main, `document.querySelectorAll('.mico-immersive-menu-action')[2].click()`);
        await waitFor(() => evaluate(main, `Boolean(document.querySelector('.queue-popup'))`), '实际播放队列');
        check('更多菜单打开现有真实队列并在沉浸层上方显示', await evaluate(main, `Number(getComputedStyle(document.querySelector('.queue-popup')).zIndex) > Number(getComputedStyle(document.querySelector('.mico-immersive-player')).zIndex)`));
        await capture('05-queue');
        await click('.mico-immersive-cover');
        await click('[aria-label="下一首"]');
        await waitFor(async () => (await state()).song?.hash === 'immersive-b' && (await state()).audio.src.endsWith('/fixture-b.wav'), '下一首实际获取 fixture URL');
        await waitFor(() => evaluate(main, `Boolean(document.querySelector('.mico-immersive-cover-fallback')) && Boolean(document.querySelector('.mico-lyric-empty')) && document.querySelectorAll('.mico-lyric-row').length === 0`), '无词 / 坏封面回退');
        check('下一首更换生产歌曲和音源但不创建 Audio', (await state()).audioCount === 1, (await state()).audio);
        await waitFor(async () => (await state()).fluid?.paletteStatus === 'error' && (await state()).fluid?.paletteSource === 'fallback', '坏封面无法提色时使用保守色板');
        check('坏封面进入 CSS 回退并保留 DOM 控件与唯一音频', (await state()).fluid.phase === 'fallback' && (await state()).audioCount === 1 && (await state()).fluid.coverSceneStatus === 'unavailable' && await evaluate(main, `document.documentElement.getAttribute('data-mico-fluid-renderer')==='css'`), (await state()).fluid);
        await capture('06-no-lyrics-bad-cover');
        await click('[aria-label="上一首"]');
        await waitFor(async () => (await state()).song?.hash === 'immersive-a' && (await state()).audio.src.endsWith('/fixture-a.wav'), '上一首生产队列回到第一首');
        await waitFor(() => evaluate(main, `document.querySelectorAll('.mico-lyric-row').length > 0 && !document.querySelector('.mico-immersive-cover-fallback')`), '歌词和封面恢复');
        check('上一首使用真实队列及请求流程', requests.filter(item => item.path === '/song/url').length >= 2);
        await click('.mico-immersive-play');
        await waitFor(async () => (await state()).audio.paused, '暂停');
        await waitFor(async () => (await state()).background.motion === 'still', '暂停背景停止');
        await stoppedGL('暂停后实际 WebGL 流体停止');
        check('暂停时歌词真实逐词 RAF 停止', await evaluate(main, `document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-clock') === 'idle'`));
        await setInput('.mico-immersive-seek', 3, 'input');
        const preview = await state();
        check('seek input 仅预览，不改变暂停音频', preview.audio.paused && preview.audio.time < 1.5, preview.audio);
        await setInput('.mico-immersive-seek', 3);
        await waitFor(async () => Math.abs((await state()).audio.time - 3) < 0.05, '暂停时真实 seek');
        check('暂停 seek 保持暂停，并由原播放器更新时间', (await state()).audio.paused);
        const pausedFill = await evaluate(main, `[...document.querySelectorAll('.mico-lyric-active .mico-lyric-token')].map(node => node.style.getPropertyValue('--mico-word-fill'))`);
        await new Promise(resolve => setTimeout(resolve, 300));
        const afterFill = await evaluate(main, `[...document.querySelectorAll('.mico-lyric-active .mico-lyric-token')].map(node => node.style.getPropertyValue('--mico-word-fill'))`);
        check('暂停歌词不使用独立计时器继续逐词推进', pausedFill.length === 5 && JSON.stringify(pausedFill) === JSON.stringify(afterFill), { before: pausedFill, after: afterFill });
        await setInput('.mico-immersive-seek', 11);
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-phase') === 'interlude' && Boolean(document.querySelector('.mico-lyric-gap'))`), 'KRC 行间空隙提示');
        check('真实歌词时间空隙显示间奏而不冒充活跃行', await evaluate(main, `document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-active') === '-1'`));
        await setInput('.mico-immersive-seek', 3);
        await evaluate(main, `(() => { const stage = document.querySelector('.mico-immersive-lyrics'); stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true })); stage.scrollTop += 180; })()`);
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-following') === 'false'`), '用户浏览暂停自动跟随');
        check('浏览歌词出现真实跟随恢复入口', await evaluate(main, `Boolean(document.querySelector('.mico-lyric-resume'))`));
        await click('.mico-lyric-resume');
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-following') === 'true'`), '恢复跟随');
        await click('.mico-lyric-row[data-mico-lyric-index="1"]');
        await waitFor(async () => Math.abs((await state()).audio.time - 12) < 0.05, '点击歌词从源 startTime 跳转');
        check('歌词点击使用真实行开始时间并保持暂停', (await state()).audio.paused);
        const pausedBefore = await state(); await settings({ enabled: false });
        await waitFor(async () => (await state()).legacy === 1 && (await state()).immersive === 0, '关闭插件恢复旧歌词界面');
        continuity('暂停时关闭主题不改原音频、进度和文档', pausedBefore, await state(), true);
        check('关闭材质移除全部三个自有 canvas 且释放已观察 GL 对象', glLiveResources(await state()) === 0 && (await state()).ownedCanvases === 0, (await state()).gl);
        await capture('07-plugin-off-legacy');
        const disabledBaseline = await state();
        await settings({ enabled: true, lowBlur: false, reduceMotion: false });
        await waitFor(async () => (await state()).immersive === 1 && (await state()).legacy === 0, '启用主题重新挂载');
        continuity('重新开启主题不创建音频或刷新文档', pausedBefore, await state(), true);
        await click('.mico-immersive-play'); await waitFor(async () => !(await state()).audio.paused, '恢复播放');
        const beforeCycles = await state();
        for (let index = 0; index < 20; index++) {
            await settings({ enabled: false }); await waitFor(async () => (await state()).immersive === 0 && (await state()).legacy === 1, '第 ' + (index + 1) + ' 次完整关闭');
            const now = await state();
            check('第 ' + (index + 1) + ' 次关闭无监听 / 观察器增长', now.activeListeners <= disabledBaseline.activeListeners && now.activeObservers <= disabledBaseline.activeObservers, { baseline: { listeners: disabledBaseline.activeListeners, observers: disabledBaseline.activeObservers }, current: { listeners: now.activeListeners, observers: now.activeObservers } });
            check('第 ' + (index + 1) + ' 次关闭无插件 GL 资源与 RAF 遗留', glLiveResources(now) === 0 && now.pluginObservation?.pendingRAF === 0 && now.pluginObservation?.listeners <= disabledBaseline.pluginObservation.listeners && now.pluginObservation?.observers <= disabledBaseline.pluginObservation.observers,
                { plugin:now.pluginObservation, liveResources:glLiveResources(now) });
            await settings({ enabled: true }); await waitFor(async () => (await state()).immersive === 1 && (await state()).legacy === 0, '第 ' + (index + 1) + ' 次重新启用');
        }
        continuity('20 次真实存储启停后实际播放连续', beforeCycles, await state());
        for (let index = 0; index < 3; index++) {
            const before = await state(); closePopup();
            const reloaded = await evaluate(main, `window.electronAPI.reloadExtensions()`);
            check('第 ' + (index + 1) + ' 次生产 IPC 重载成功', reloaded.success, reloaded);
            await waitFor(async () => (await state()).ready?.success && (await state()).immersive === 1 && (await state()).styles === 1, '正式插件重载再注入');
            continuity('第 ' + (index + 1) + ' 次重载保持当前 Audio 和文档', before, await state());
            const disposed = (await state()).fluidDisposals.at(-1);
            check('第 ' + (index + 1) + ' 次重载清理旧引擎的 GL 资源和 RAF', disposed?.phase === 'disposed' && disposed.rafPending === false && Object.values(disposed.resources).every(count => count === 0) && disposed.allocations === disposed.deletions, disposed);
            await installPluginObservers();
        }
        await settings({ lowBlur: true });
        await waitFor(async () => (await state()).background.motion === 'still', '低模糊停止背景流动');
        await stoppedGL('低模糊模式冻结流体并停止持续 GL RAF', {allowStaticControlUpdates:true});
        await capture('08-low-blur');
        await settings({ lowBlur: false, reduceMotion: true });
        await waitFor(async () => (await state()).background.motion === 'still', '减少动效停止流动');
        await stoppedGL('减少动效冻结流体并停止持续 GL RAF', {allowStaticControlUpdates:true});
        await settings({ reduceMotion: false });
        await evaluate(main, `document.querySelector('.mico-immersive-lyrics').dispatchEvent(new WheelEvent('wheel', { deltaY: 180, bubbles: true }))`);
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-following') === 'false'`), '隐藏前进入歌词浏览');
        main.hide();
        await waitFor(async () => (await state()).nativeVisible === 'false' && (await state()).background.motion === 'still', '原生窗口隐藏停止背景');
        const hidden = await state();
        check('原生 hide 状态停止插件 RAF 并保留实际音频', !hidden.audio.paused && hidden.fluid?.rafPending === false, hidden);
        await stoppedGL('原生窗口 hide 后不继续消耗 GL 帧');
        check('原生 hide 后释放 GL 对象并停止歌词逐词 RAF', glLiveResources(await state()) === 0 && await evaluate(main, `document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-clock') === 'idle'`), (await state()).fluid);
        check('节流配置对应 Chromium 可见性，原生状态独立准确', hidden.visibility === (mode === 'unthrottled' ? 'visible' : 'hidden'), { mode, documentVisibility: hidden.visibility, nativeVisible: hidden.nativeVisible });
        await new Promise(resolve => setTimeout(resolve, 4700));
        check('原生隐藏后歌词恢复计时器保持停止', await evaluate(main, `document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-following') === 'false'`));
        main.show(); await waitFor(async () => (await state()).nativeVisible === 'true' && (await state()).background.motion === 'flow', '原生显示恢复背景');
        await click('.mico-lyric-resume');
        main.minimize();
        await waitFor(async () => (await state()).nativeVisible === 'false' && (await state()).background.motion === 'still', '真实最小化停止背景');
        check('原生 minimize 停止背景而不暂停音频', !(await state()).audio.paused);
        await stoppedGL('原生 minimize 后 GL 实际停止');
        main.restore(); main.show();
        await waitFor(async () => (await state()).nativeVisible === 'true' && (await state()).background.motion === 'flow', '真实 restore 恢复背景');
        check('原生 restore 恢复流动且保留唯一音频', (await state()).audioCount === 1);
        const performance = {};
        for (const [name, patch] of [['normal', { lowBlur: false }], ['lowBlur', { lowBlur: true }]]) { await settings(patch); performance[name] = { frames: await frames(), processMetrics: app.getAppMetrics() }; }
        report.observations.performance = { ...performance, gpuFeatureStatus: app.getGPUFeatureStatus(), interpretation: '180 帧短样本；非长期性能门槛，GPU 进程 CPU 非硬件 GPU 利用率' };
        await settings({ lowBlur: false });
        main.setSize(820, 900); await new Promise(resolve => setTimeout(resolve, 350));
        const narrow = await geometry(); report.observations.narrowGeometry = narrow;
        check('窄窗口封面、控制与歌词保持视口内', Object.entries(narrow).filter(([key]) => key.startsWith('.')).every(([, box]) => box.x >= -1 && box.y >= -1 && box.x + box.width <= narrow.width + 1 && box.y + box.height <= narrow.height + 1), narrow);
        await capture('09-narrow');
        main.setContentSize(1300, 816); await new Promise(resolve => setTimeout(resolve, 250));
        await setInput('.mico-immersive-seek', 3);
        await capture('10-reference-ratio');
        const reference = report.observations.captures['10-reference-ratio' + (mode === 'unthrottled' ? '-unthrottled' : '')];
        check('参考比例截图使用实际 1300×816 内容尺寸', reference.width === 1300 && reference.height === 816, reference);
        report.observations.referenceFocus = { rowCenterRatio: reference.rowCenterRatio, primaryCenterRatio: reference.primaryCenterRatio,
            screenshotPrimaryTargetRatio: 0.417, interpretation: '附图当前正文中心约41.7%；当前行组含真实翻译，正文与行组比例分开记录，不以构建通过代替视觉审阅' };
        console.log('参考比例截图：' + path.join(evidence, '10-reference-ratio' + (mode === 'unthrottled' ? '-unthrottled' : '') + '.png'));
        main.setSize(1470, 924); await new Promise(resolve => setTimeout(resolve, 250));
        const beforeClose = await state();
        report.observations.heroClosing = await heroSample(() => click('.mico-immersive-close'), false);
        continuity('退出沉浸视图不影响实际技术音频', beforeClose, await state());
        await click('.player-bar .album-art'); await waitFor(async () => (await state()).immersive === 1, '再次进入');
        await pressedKey('Escape'); await waitFor(async () => (await state()).immersive === 0 && (await state()).legacy === 0, '原父键盘 Escape 退出');
        check('按钮与 Escape 均退出且唯一音频仍在', (await state()).audioCount === 1 && !(await state()).audio.paused);
        await click('.player-bar .album-art'); await waitFor(async () => (await state()).immersive === 1, '卸载前保留打开的新播放器');
        const uninstallBefore = await state(), extension = loadedBuiltin(); closePopup();
        const uninstalled = await evaluate(main, `window.electronAPI.uninstallExtension(${JSON.stringify(extension.id)}, ${JSON.stringify(path.basename(extension.path))})`);
        check('生产 IPC 仅卸载本次隔离 profile 中的视觉插件', uninstalled.success && uninstalled.path === path.join(profile,'extensions',path.basename(extension.path)) && !fs.existsSync(uninstalled.path), uninstalled);
        await waitFor(async () => { const now = await state(); return now.immersive === 0 && now.legacy === 1 && now.styles === 0; }, '卸载插件恢复旧界面');
        continuity('实际卸载插件不影响唯一 Audio 与当前文档', uninstallBefore, await state());
        const disposed = (await state()).fluidDisposals.at(-1);
        check('卸载后旧引擎资源全部释放且三个 canvas 移除', disposed?.phase === 'disposed' && !disposed.rafPending && Object.values(disposed.resources).every(count => count === 0) && disposed.allocations === disposed.deletions && (await state()).ownedCanvases === 0, disposed);
        await capture('12-uninstall-legacy');
        report.observations.requests = requests; report.observations.blockedExternal = blockedExternal;
        report.observations.rendererMessages = rendererErrors;
        report.observations.rendererConsole = rendererConsole;
        report.observations.testActions = testActions;
        report.finalSourceState = sourceState();
        check('运行期间生产源码与构建指纹稳定', report.sourceState.sourceFingerprintSha256 === report.finalSourceState.sourceFingerprintSha256 && report.sourceState.rendererFingerprintSha256 === report.finalSourceState.rendererFingerprintSha256);
    } catch (error) {
        report.failure = { message: error.message, stack: error.stack }; console.error(error.stack); exitCode = 1;
        report.observations.requests = requests; report.observations.blockedExternal = blockedExternal; report.observations.rendererMessages = rendererErrors;
        report.observations.rendererConsole = rendererConsole;
        report.observations.testActions = testActions;
        if (main && !main.isDestroyed()) { report.observations.failureState = await state().catch(() => null); await capture('failure').catch(() => {}); }
    } finally {
        closePopup();
        if (main && !main.isDestroyed()) await evaluate(main, `window.__immersiveValidationAudios?.forEach(audio => audio.pause())`).catch(() => {});
        if (extensions) { const cleanup = await extensions.cleanupExtensions(); report.observations.finalCleanup = cleanup; if (!cleanup.success) exitCode = 1; }
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
        if (fixtureServer) { fixtureServer.closeAllConnections(); await new Promise(resolve => fixtureServer.close(resolve)); }
        report.observations.loopbackClosed = fixtureServer ? !fixtureServer.listening : true;
        fs.writeFileSync(path.join(evidence, reportName + '.json'), JSON.stringify(report, null, 2) + '\n');
        app.exit(exitCode);
    }
}
app.whenReady().then(audit).catch(error => { console.error(error.stack); app.exit(1); });
