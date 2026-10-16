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
const evidence = path.join(root, 'docs/immersive/evidence/2026-10-16-upstream-sync');
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
    platform: process.platform, validationRevision: 'upstream-sync-2026-10-16', sourceState: sourceState(), checks: [], observations: {},
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
const fixtureStartsMs = [0, 12000, 24000, 40000, 52000, 64000, 76000, 88000, 100000];
const krc = `[language:${language}]\n` + fixtureLines.map((words, index) => {
    const step = 10000 / words.length;
    return `[${fixtureStartsMs[index]},10000]` + words.map((word, token) => `<${Math.round(token * step)},${Math.round(step)},0>${word}`).join('');
}).join('\n');
const preludeFixtureStartsMs = fixtureStartsMs.map(time => time + 4000);
const preludeKrc = `[language:${language}]\n` + fixtureLines.map((words, index) => {
    const step = 10000 / words.length;
    return `[${preludeFixtureStartsMs[index]},10000]` + words.map((word, token) => `<${Math.round(token * step)},${Math.round(step)},0>${word}`).join('');
}).join('\n');
const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="warm" x2="1" y2="1"><stop stop-color="#ffaf36"/><stop offset=".48" stop-color="#ee5a21"/><stop offset="1" stop-color="#653552"/></linearGradient></defs><rect width="800" height="800" fill="url(#warm)"/><circle cx="560" cy="240" r="260" fill="#fbe698" opacity=".4"/><path d="M-100 690L440 120L970 830" fill="none" stroke="#f5c747" stroke-width="110" opacity=".6"/><text x="60" y="140" fill="white" font-family="sans-serif" font-size="80" font-weight="700">MICO</text><text x="62" y="208" fill="white" font-family="sans-serif" font-size="36">IMMERSIVE VALIDATION</text></svg>`;
const brightCover = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#fff"/><path d="M90 730L260 270L360 360L500 680" fill="#182132"/><path d="M170 620C210 460 460 620 630 340" fill="none" stroke="#de801d" stroke-width="40"/><circle cx="550" cy="270" r="74" fill="#f2b63d"/><circle cx="550" cy="270" r="28" fill="#243443"/><circle cx="660" cy="460" r="60" fill="#e09827"/><circle cx="660" cy="460" r="24" fill="#243443"/><text x="60" y="120" fill="#172132" font-family="sans-serif" font-size="68" font-weight="700">WHITE CANVAS</text><text x="60" y="184" fill="#b36814" font-family="sans-serif" font-size="26">ORIGINAL HIGH CONTRAST FIXTURE</text></svg>`;
async function serveFixtures() {
    const waves = [makeWav(220), makeWav(330)];
    let base;
    fixtureServer = http.createServer((req, res) => {
        const url = new URL(req.url, base); requests.push({ path: url.pathname, query: url.search });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (url.pathname === '/fixture-cover.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(cover); return; }
        if (url.pathname === '/fixture-cover-bright.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(brightCover); return; }
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
        if (url.pathname === '/search/lyric') data = { status: 200, candidates: ['immersive-a', 'immersive-c', 'immersive-d'].includes(url.searchParams.get('hash')) ? [{ id: url.searchParams.get('hash') === 'immersive-d' ? 'fixture-krc-prelude' : 'fixture-krc-a', accesskey: 'fixture-access-key' }] : [] };
        else if (url.pathname === '/lyric') data = { status: 200, decodeContent: url.searchParams.get('id') === 'fixture-krc-prelude' ? preludeKrc : krc };
        else if (url.pathname === '/song/url') data = { status: 1, url: [base + (url.searchParams.get('hash') === 'immersive-b' ? '/fixture-b.wav' : '/fixture-a.wav')], timeLength: duration, extName: 'wav' };
        else if (url.pathname === '/register/dev') data = { status: 1, data: { dfid: 'isolated-technical-fixture' } };
        else if (url.pathname === '/user/grade/info') data = { status: 1, data: { d_sec: 0 } };
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
async function measuredFlowCadence() {
    const began = await evaluate(main, 'performance.now()');
    const hostRAF = frames();
    await new Promise(resolve => setTimeout(resolve, 3000));
    const finished = await evaluate(main, 'performance.now()'), snapshot = await state();
    const record = snapshot.gl.find(item => item.canvasId === 'mico-liquid-glass-canvas' && Object.values(item.active).some(Boolean));
    assert.ok(record, '流畅度采样使用当前仍活动的真实 GL 上下文');
    const times = record.frameTimesMs.filter(value => value >= began && value <= finished);
    const intervals = times.slice(1).map((value, index) => value - times[index]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const measured = { elapsedMs: finished - began, actualFrames: times.length,
        actualFps: (times.length - 1) * 1000 / (times.at(-1) - times[0]),
        medianMs: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)],
        maxMs: sorted.at(-1), over33Ms: intervals.filter(value => value > 33.4).length, frameTimestampsMs: times,
        hostRAF: await hostRAF, audio: snapshot.audio,
        interpretation: '插件隔离世界实际自然默认 framebuffer 绘制任务，每任务多个玻璃 draw 只计一帧；host RAF 另记，未人为调用 draw；3秒短样本仅覆盖本机可见播放' };
    report.observations.actualFluidCadence = measured;
    check('可见播放流体实际绘制达到至少50fps且帧间隔稳定', !snapshot.audio.paused && measured.actualFrames >= 140 &&
        measured.actualFps >= 50 && measured.medianMs <= 22 && measured.p95Ms <= 34, measured);
}
async function nativePointer(selector, { xRatio = .75, yRatio = .45, type = 'mouseMove' } = {}) {
    const point = await evaluate(main, `(() => {
        const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('缺少实际指针控件：'+${JSON.stringify(selector)});
        const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width*${xRatio}),y:Math.round(r.y+r.height*${yRatio})};
    })()`);
    testActions.push({ action: 'native pointer', selector, type, ...point, time: Date.now() });
    main.webContents.sendInputEvent({ type, ...point, ...(type === 'mouseDown' || type === 'mouseUp' ? {button:'left',clickCount:1} : {}) });
    return point;
}
async function nativePointerLeave() {
    testActions.push({action:'native pointer leave',time:Date.now()});
    // Electron 39 的实际 MouseInputEvent 类型允许 mouseLeave；不是 JS 合成 pointerleave。
    main.webContents.sendInputEvent({ type:'mouseLeave',x:8,y:8 });
}
async function nativeVisibleLyricPointer() {
    const visibleRow=await evaluate(main,`(() => {
        const stage=document.querySelector('.mico-immersive-lyrics');if(!stage)throw new Error('录屏缺少真实歌词视口');
        const viewport=stage.getBoundingClientRect(),rows=[];
        for(const node of stage.querySelectorAll('button.mico-lyric-row')){
            const r=node.getBoundingClientRect(),style=getComputedStyle(node);
            if(node.disabled||node.closest('[inert]')||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<=0)continue;
            const left=Math.max(r.left,viewport.left,0),right=Math.min(r.right,viewport.right,innerWidth);
            const top=Math.max(r.top,viewport.top+viewport.height*.15,0),bottom=Math.min(r.bottom,viewport.top+viewport.height*.85,innerHeight);
            if(right-left<2||bottom-top<2)continue;
            const x=left+(right-left)*.65,y=(top+bottom)/2;
            if(document.elementFromPoint(x,y)?.closest('button.mico-lyric-row')!==node)continue;
            const index=node.getAttribute('data-mico-lyric-stage-index');
            if(index===null)throw new Error('实际可见歌词行缺少源码规定的stage-index');
            rows.push({selector:'button.mico-lyric-row[data-mico-lyric-stage-index="'+CSS.escape(index)+'"]',index,
                active:node.classList.contains('mico-lyric-active'),xRatio:(x-r.left)/r.width,yRatio:(y-r.top)/r.height,
                rect:{x:r.x,y:r.y,width:r.width,height:r.height},visibleHeight:bottom-top,
                focusDistance:Math.abs(y-(viewport.top+viewport.height*.43))});
        }
        rows.sort((a,b)=>Number(b.active)-Number(a.active)||a.focusDistance-b.focusDistance||b.visibleHeight-a.visibleHeight);
        if(!rows.length)throw new Error('录屏没有实际可见、可seek且未被遮挡的歌词行');
        return rows[0];
    })()`);
    testActions.push({action:'observed visible lyric row',...visibleRow,time:Date.now()});
    await nativePointer(visibleRow.selector,{xRatio:visibleRow.xRatio,yRatio:visibleRow.yRatio});
}
const pointerFrames = (selector, elapsedMs = 420) => evaluate(main, `new Promise(resolve=>{
    const samples=[],started=performance.now();
    function sample(timestamp){
        const node=document.querySelector(${JSON.stringify(selector)}),style=node?getComputedStyle(node):null;
        const background=document.querySelector('.mico-immersive-background'),fluid=JSON.parse(background?.getAttribute('data-mico-fluid-state')||'null');
        samples.push({timestamp,elapsedMs:timestamp-started,audioTime:window.__immersiveValidationAudios[0].currentTime,
            hover:Number(style?.getPropertyValue('--mico-pointer-hover')||0),press:Number(style?.getPropertyValue('--mico-pointer-press')||0),
            x:parseFloat(style?.getPropertyValue('--mico-pointer-x')||'0'),y:parseFloat(style?.getPropertyValue('--mico-pointer-y')||'0'),
            transform:style?.transform,feedback:node?.getAttribute('data-mico-pointer-feedback'),
            pointer:fluid?.pointer,presence:fluid?.pointerPresence,feedbackControls:fluid?.pointerFeedbackControls,
            interactionMoving:fluid?.interactionMoving,glFrames:fluid?.frameCount,fluidTime:fluid?.timeSeconds,rafPending:fluid?.rafPending});
        if(timestamp-started>=${elapsedMs})resolve(samples);else requestAnimationFrame(sample);
    }requestAnimationFrame(sample);
})`);
async function lyricHighlightMode(highlightMode) {
    assert.ok(['char','line'].includes(highlightMode));
    const before=await state();
    if(!before.audio.paused){await click('.mico-immersive-play');await waitFor(async()=>(await state()).audio.paused,'切换歌词展示模式前暂停真实Audio');}
    await settings({enabled:false});
    await waitFor(async()=>(await state()).legacy===1,'生产歌词设置在原界面挂载');
    // 此结构来自 FullscreenLyricsSettings.vue 的第4个 settings-row 和精确选项次序。
    await click('.fullscreen-lyrics-settings .settings-row:nth-child(4) .setting-options button:nth-child('+(highlightMode==='char'?1:2)+')');
    await waitFor(()=>evaluate(main,`JSON.parse(localStorage.getItem('fullscreen-lyrics-settings')).highlightMode===${JSON.stringify(highlightMode)}`),'生产设置保存真实高亮模式');
    await settings({enabled:true});
    await waitFor(async()=>(await state()).immersive===1&&(await state()).legacy===0,'插件界面接收原歌词展示模式');
    check(highlightMode+'高亮模式通过生产设置控件生效且未重建Audio',await evaluate(main,`document.querySelectorAll('.mico-lyric-token').length${highlightMode==='char'?'>0':'===0'}&&window.__immersiveValidationAudios.length===1`));
}
async function lyricBoundaryFrames(highlightMode, {name,boundarySeconds,fromSeconds,activeIndex,phaseBefore}) {
    await setInput('.mico-immersive-seek',fromSeconds);
    await waitFor(async()=>Math.abs((await state()).audio.time-fromSeconds)<.05,'边界观察前生产seek到真实时间');
    const sampled=await evaluate(main,`(() => {
        const frames=[],started=performance.now();
        const promise=new Promise((resolve,reject)=>{
            function sample(timestamp){
                const audio=window.__immersiveValidationAudios[0],stage=document.querySelector('.mico-immersive-lyrics'),row=stage.querySelector('.mico-lyric-active');
                const style=row?getComputedStyle(row):null;
                frames.push({timestamp,elapsedMs:timestamp-started,audioTime:audio.currentTime,paused:audio.paused,visualTime:Number(stage.getAttribute('data-mico-lyric-time')),
                    phase:stage.getAttribute('data-mico-lyric-phase'),activeIndex:Number(stage.getAttribute('data-mico-lyric-active')),
                    clock:stage.getAttribute('data-mico-lyric-clock'),opacity:style?Number(style.opacity):null,filter:style?.filter,
                    transitionDuration:style?.transitionDuration,transitionDelay:style?.transitionDelay,
                    tokens:row?[...row.querySelectorAll('.mico-lyric-token')].map(token=>({fill:parseFloat(token.style.getPropertyValue('--mico-word-fill')),
                        lift:parseFloat(token.style.getPropertyValue('--mico-word-lift')),scale:Number(token.style.getPropertyValue('--mico-word-scale')),
                        transform:getComputedStyle(token).transform,fillTransition:getComputedStyle(token.querySelector('.mico-lyric-token-fill')).transitionDuration})):[]});
                if(audio.currentTime>=${boundarySeconds+.25})resolve(frames);
                else if(timestamp-started>6000)reject(new Error('真实Audio未通过所测歌词边界'));
                else requestAnimationFrame(sample);
            }requestAnimationFrame(sample);
        });
        document.querySelector('.mico-immersive-play').click();return promise;
    })()`);
    await click('.mico-immersive-play');await waitFor(async()=>(await state()).audio.paused,'边界采样后暂停同一真实Audio');
    const intervals=sampled.slice(1).map((frame,index)=>frame.timestamp-sampled[index].timestamp);
    // The production clock deliberately stops after 160ms of unchanged Audio time.
    // Keep initial decoding/buffering and its timeupdate wake-up as evidence, but
    // qualify steady sampling only after Audio advances 50ms and the clock runs,
    // followed by two real frames. Never remove idle/error frames after that point.
    const qualifiedIndex=sampled.findIndex(frame=>!frame.paused&&frame.audioTime>fromSeconds+.05&&frame.clock==='running');
    const steadyStartIndex=qualifiedIndex>=0&&qualifiedIndex+2<sampled.length?qualifiedIndex+2:null;
    const startup=sampled.slice(0,steadyStartIndex??sampled.length);
    const steady=steadyStartIndex===null?[]:sampled.slice(steadyStartIndex);
    const errorMs=frame=>Math.abs(frame.audioTime-frame.visualTime)*1000;
    const intervalAt=index=>index>0?sampled[index].timestamp-sampled[index-1].timestamp:null;
    const largest=values=>values.length?Math.max(...values):null;
    // 50fps and p95<=34ms are the existing native cadence requirements. A frame
    // over this ceiling invalidates this precision sample; it never grants more
    // clock, boundary or clarity tolerance elsewhere in the observation.
    const frameBudgetLimitMs=34;
    const steadyIntervals=steady.slice(1).map((frame,index)=>frame.timestamp-steady[index].timestamp);
    const sortedSteadyIntervals=[...steadyIntervals].sort((a,b)=>a-b);
    const steadyCadence={actualFps:steady.length>1?(steady.length-1)*1000/(steady.at(-1).timestamp-steady[0].timestamp):null,
        p95Ms:sortedSteadyIntervals.length?sortedSteadyIntervals[Math.floor(sortedSteadyIntervals.length*.95)]:null,
        maxMs:largest(steadyIntervals),frameBudgetLimitMs,
        longFrames:steady.map((frame,index)=>({frameIndex:steadyStartIndex+index,intervalMs:intervalAt(steadyStartIndex+index)}))
            .filter(frame=>!Number.isFinite(frame.intervalMs)||frame.intervalMs<=0||frame.intervalMs>frameBudgetLimitMs)};
    const steadyErrors=steady.map((frame,index)=>({frameIndex:steadyStartIndex+index,audioTime:frame.audioTime,
        visualTime:frame.visualTime,errorMs:errorMs(frame),intervalMs:intervalAt(steadyStartIndex+index),
        budgetMs:Math.min(frameBudgetLimitMs,intervalAt(steadyStartIndex+index))+8}));
    const beforeBoundary=steady.filter(frame=>!frame.paused&&frame.audioTime<boundarySeconds-.04);
    const firstAdvanceIndex=sampled.findIndex(frame=>frame.audioTime>fromSeconds+.000001);
    const resumeAfterIdleIndex=sampled.findIndex((frame,index)=>frame.clock==='running'&&frame.audioTime>fromSeconds&&
        sampled.slice(0,index).some(previous=>previous.clock==='idle'));
    const firstActiveIndex=sampled.findIndex(frame=>!frame.paused&&frame.activeIndex===activeIndex);
    const firstActive=firstActiveIndex>=0?sampled[firstActiveIndex]:null;
    const crossingIndex=sampled.findIndex(frame=>!frame.paused&&frame.audioTime>=boundarySeconds);
    const boundaryIntervals=[crossingIndex,firstActiveIndex].map(intervalAt);
    // Audio may cross between samples; Vue's queued render is visible in the next
    // RAF observation. Bound those two distinct local intervals, not a global max.
    const boundaryBudgetMs=boundaryIntervals.every(value=>Number.isFinite(value)&&value>0&&value<=frameBudgetLimitMs)?boundaryIntervals.reduce((total,value)=>total+value,0)+8:null;
    const clearIndex=sampled.findIndex((frame,index)=>firstActiveIndex>=0&&index>=firstActiveIndex&&frame.activeIndex===activeIndex&&
        frame.opacity>=.99&&parseFloat(frame.filter.match(/blur\(([^)]+)\)/)?.[1]||'0')<.05);
    const clearFrame=clearIndex>=0?sampled[clearIndex]:null;
    const clarityIntervals=[firstActiveIndex,clearIndex].map(intervalAt);
    const clarityBudgetMs=clarityIntervals.every(value=>Number.isFinite(value)&&value>0&&value<=frameBudgetLimitMs)?100+clarityIntervals.reduce((total,value)=>total+value,0):null;
    const observed={highlightMode,name,boundarySeconds,fromSeconds,maxFrameMs:largest(intervals),
        maxStartupClockErrorMs:largest(startup.map(errorMs)),maxSteadyClockErrorMs:largest(steady.map(errorMs)),
        startup:{sampleCount:startup.length,firstAudioAdvanceFrameIndex:firstAdvanceIndex>=0?firstAdvanceIndex:null,
            clockIdleFrameIndexes:startup.map((frame,index)=>frame.clock==='idle'?index:null).filter(index=>index!==null),
            resumeAfterIdleFrameIndex:resumeAfterIdleIndex>=0?resumeAfterIdleIndex:null,
            qualifiedFrameIndex:qualifiedIndex>=0?qualifiedIndex:null,settleFrames:2,productionClockStallMs:160,
            interpretation:'保留原始启动帧；Audio尚未推进时的clock idle符合既有160ms缓冲停止合同，恢复证据由真实Audio和clock状态分别记录'},
        steadyStartFrameIndex:steadyStartIndex,steadySampleCount:steady.length,steadyCadence,steadyErrors,
        steadyBeforeBoundarySampleCount:beforeBoundary.length,boundaryIntervalsMs:boundaryIntervals,boundaryBudgetMs,
        crossingFrameIndex:crossingIndex,activeObservationFramesAfterCrossing:firstActiveIndex-crossingIndex,
        firstActiveAudioTime:firstActive?.audioTime,visualBoundaryDelayMs:firstActive?(firstActive.audioTime-boundarySeconds)*1000:null,
        clarityDelayMs:clearFrame&&firstActive?clearFrame.timestamp-firstActive.timestamp:null,clarityIntervalsMs:clarityIntervals,clarityBudgetMs,frames:sampled,
        interpretation:'每个真实宿主RAF独立读取Audio、Vue时钟、computed CSS和词组变量；启动缓冲全部保留，稳态误差使用对应帧间隔+8ms；跨句仅允许Audio首次越界采样量化及下一帧Vue渲染观测，预算为这两个实际邻帧之和+8ms；100ms清晰度仅加起止采样帧，单帧上限34ms，不修改源时间、不用全段最长帧放宽断言'};
    report.observations.lyricBoundaryFrames??=[];report.observations.lyricBoundaryFrames.push(observed);
    check(highlightMode+'模式'+name+'稳态采样至少50fps且长帧不放宽同步预算',steady.length>=20&&
        steadyCadence.actualFps>=50&&steadyCadence.p95Ms<=frameBudgetLimitMs&&steadyCadence.longFrames.length===0,observed);
    check(highlightMode+'模式'+name+'稳态读取真实Audio时钟且空档不休眠',Boolean(steady[0])&&
        steady[0].audioTime<=boundarySeconds-3*frameBudgetLimitMs/1000&&beforeBoundary.length>=3&&
        beforeBoundary.every(frame=>frame.phase===phaseBefore)&&steady.every(frame=>!frame.paused&&frame.clock==='running')&&
        steadyErrors.every(frame=>Number.isFinite(frame.errorMs)&&frame.errorMs<=frame.budgetMs),observed);
    check(highlightMode+'模式'+name+'跨句更新不等节流timeupdate',Boolean(firstActive)&&boundaryBudgetMs!==null&&
        firstActiveIndex>=steadyStartIndex&&firstActiveIndex>=crossingIndex&&firstActiveIndex<=crossingIndex+1&&
        observed.visualBoundaryDelayMs>=-1&&observed.visualBoundaryDelayMs<=boundaryBudgetMs,observed);
    check(highlightMode+'模式'+name+'当前句零延迟且100ms清晰度过渡快速完成',Boolean(clearFrame)&&Boolean(firstActive)&&
        firstActive.transitionDelay.split(',').every(value=>parseFloat(value)===0)&&
        firstActive.transitionDuration.split(',').slice(0,2).every(value=>Number.parseFloat(value)*1000<=100.01)&&
        clarityBudgetMs!==null&&observed.clarityDelayMs>=0&&observed.clarityDelayMs<=clarityBudgetMs,observed);
    return observed;
}
async function syncAndPointerEvidence() {
    const entry=await state();
    assert.equal(entry.song?.hash,'immersive-a','前奏场景从正式恢复的Warm Canvas开始');
    await click('[aria-label="上一首"]');
    await waitFor(async()=>(await state()).song?.hash==='immersive-d','真实队列切换前奏技术fixture');
    await waitFor(()=>evaluate(main,`Boolean(document.querySelector('.mico-lyric-gap-row[data-mico-lyric-gap-start="0"][data-mico-lyric-gap-end="4000"]'))`),'生产LyricsHandler解析四秒前奏KRC');
    if(!(await state()).audio.paused){await click('.mico-immersive-play');await waitFor(async()=>(await state()).audio.paused,'边界验收前暂停');}
    let wordBoundary;
    for(const highlightMode of ['char','line']){
        await lyricHighlightMode(highlightMode);
        const prelude=await lyricBoundaryFrames(highlightMode,{name:'四秒前奏到第一句',boundarySeconds:4,fromSeconds:3.6,activeIndex:0,phaseBefore:'prelude'});
        await lyricBoundaryFrames(highlightMode,{name:'两秒空档到下一句',boundarySeconds:16,fromSeconds:14.1,activeIndex:1,phaseBefore:'interlude'});
        if(highlightMode==='char')wordBoundary=prelude;
    }
    const wordFrames=wordBoundary.frames.filter(frame=>frame.activeIndex===0&&frame.visualTime>4&&frame.visualTime<6);
    const progressMatches=wordFrames.every(frame=>frame.tokens.length===5&&frame.tokens.every((token,index)=>{
        const start=4+index*2,progress=Math.max(0,Math.min(1,(frame.visualTime-start)/2));
        const lift=progress>0&&progress<1?Math.sin(Math.PI*progress):0;
        return Math.abs(token.fill-progress*100)<.001&&Math.abs(token.lift+3.2*lift)<.001&&Math.abs(token.scale-(1+.025*lift))<.001;
    }));
    check('逐词填充与抬升共用真实词组时间且没有二次CSS填充延迟',wordFrames.length>=5&&progressMatches&&
        wordFrames.every(frame=>frame.tokens.every(token=>parseFloat(token.fillTransition)===0)),{frames:wordFrames,interpretation:'只核对fixture真实KRC词组，不补造逐字时间'});
    await lyricHighlightMode('char');
    await setInput('.mico-immersive-seek',4.8);
    await waitFor(()=>evaluate(main,`Math.abs(Number(document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-time'))-window.__immersiveValidationAudios[0].currentTime)<.01`),'暂停seek后视觉时钟读取Audio原值');
    const pausedTokens=()=>evaluate(main,`(() => {const stage=document.querySelector('.mico-immersive-lyrics');return {audioTime:window.__immersiveValidationAudios[0].currentTime,
        visualTime:Number(stage.getAttribute('data-mico-lyric-time')),clock:stage.getAttribute('data-mico-lyric-clock'),
        tokens:[...stage.querySelectorAll('.mico-lyric-active .mico-lyric-token')].map(node=>({fill:node.style.getPropertyValue('--mico-word-fill'),lift:node.style.getPropertyValue('--mico-word-lift'),scale:node.style.getPropertyValue('--mico-word-scale'),transform:getComputedStyle(node).transform}))};})()`);
    const tokensBefore=await pausedTokens();await new Promise(resolve=>setTimeout(resolve,350));const tokensAfter=await pausedTokens();
    check('暂停seek精确使用Audio时间且不引入统一歌词偏移',Math.abs(tokensBefore.visualTime-4.8)<.01&&Math.abs(tokensBefore.visualTime-tokensBefore.audioTime)<.01,tokensBefore);
    check('暂停后词组填充和抬升保持同一真实进度',tokensBefore.clock==='idle'&&tokensAfter.clock==='idle'&&
        JSON.stringify(tokensBefore.tokens)===JSON.stringify(tokensAfter.tokens)&&tokensBefore.audioTime===tokensAfter.audioTime,{before:tokensBefore,after:tokensAfter});
    await waitFor(async()=>{const value=await springState();return value.phase==='idle'&&Math.abs(value.target-value.scrollTop)<2;},'指针验收前真实歌词弹簧稳定');
    await nativePointerLeave();await stoppedGL('指针验收前暂停流体静止');
    const pointerBefore=await state(),selector='.mico-immersive-play';
    const box=await evaluate(main,`(() => {const r=document.querySelector('.mico-immersive-play').getBoundingClientRect();return {x:r.x+8,y:r.y+8,width:16,height:16};})()`);
    const unhovered=await readOutputCanvas('.mico-immersive-glass-overlay',[{name:'pointer-material',...box}]);
    const point=await nativePointer(selector);const hover=await pointerFrames(selector);
    report.observations.pointerHoverFrames=hover;
    check('原生悬停使控件局部spring逐帧放大并吸附指针',new Set(hover.map(frame=>frame.transform)).size>=3&&
        hover.some(frame=>frame.hover>.9&&frame.x>.5)&&hover.some(frame=>frame.interactionMoving)&&new Set(hover.map(frame=>frame.glFrames)).size>=3,hover);
    const hovered=await readOutputCanvas('.mico-immersive-glass-overlay',[{name:'pointer-material',...box}]),difference=pixelDifference(unhovered.regions[0],hovered.regions[0]);
    check('原生悬停改变真实玻璃高光折射输出',difference.meanChannelDifference>.1&&difference.changedPixelFraction>.01,
        {before:pixelSummary(unhovered.regions[0]),after:pixelSummary(hovered.regions[0]),difference});
    const pointerOrigin=await evaluate(main,`(() => {const r=document.querySelector('.mico-immersive-background').getBoundingClientRect();return {x:r.x,y:r.y};})()`),lastHover=hover.at(-1);
    check('光学指针平滑追到实际原生坐标',Math.abs(lastHover.pointer[0]-(point.x-pointerOrigin.x))<1&&Math.abs(lastHover.pointer[1]-(point.y-pointerOrigin.y))<1&&lastHover.presence>.99,{point,pointerOrigin,lastHover});
    const pressedSelector='.mico-immersive-tool[aria-label="复制歌词"]';
    await nativePointer(pressedSelector);const transfer=await pointerFrames(pressedSelector);
    check('切到另一控件时反馈局部转移且旧控件恢复',transfer.at(-1).hover>.9&&await evaluate(main,`Number(getComputedStyle(document.querySelector('.mico-immersive-play')).getPropertyValue('--mico-pointer-hover')||0)<.05`),transfer);
    const clipboardBefore=(await state()).clipboardWrites.length;
    await nativePointer(pressedSelector,{type:'mouseDown'});const press=await pointerFrames(pressedSelector,220);
    check('真实mouseDown压缩控件并增加局部材质反馈',press.some(frame=>frame.press>.9)&&new Set(press.map(frame=>frame.transform)).size>=3,press);
    main.webContents.sendInputEvent({type:'mouseMove',x:8,y:8});main.webContents.sendInputEvent({type:'mouseUp',button:'left',x:8,y:8,clickCount:1});
    await nativePointerLeave();const release=await pointerFrames(pressedSelector,1000);
    check('移出后释放平滑复原并撤回自有指针变量',new Set(release.map(frame=>frame.transform)).size>=3&&release.at(-1).feedback===null&&
        release.at(-1).feedbackControls===0&&release.at(-1).presence<.01&&release.at(-1).interactionMoving===false,release);
    check('按压移出取消点击，复制与实际Audio保持原状态',(await state()).clipboardWrites.length===clipboardBefore&&(await state()).audio.paused,
        {clipboardBefore,clipboardAfter:(await state()).clipboardWrites.length});
    await stoppedGL('暂停悬停及按压退场后GL有限RAF停止');
    check('暂停交互只改变光学指针不推进流体或音频时钟',hover.concat(transfer,press,release).every(frame=>frame.fluidTime===pointerBefore.fluid.timeSeconds&&frame.audioTime===pointerBefore.audio.time));
    const rowSelector='.mico-lyric-row[data-mico-lyric-index="0"]';await nativePointer(rowSelector,{xRatio:.65,yRatio:.5});
    const rowHover=await evaluate(main,`new Promise(resolve=>{const frames=[];let start;function sample(time){
        if(start===undefined)start=time;
        const n=document.querySelector(${JSON.stringify(rowSelector)}),s=getComputedStyle(n),before=getComputedStyle(n,'::before');
        frames.push({time,hover:n.matches(':hover'),x:n.style.getPropertyValue('--mico-line-hover-x'),pointerX:n.style.getPropertyValue('--mico-line-pointer-x'),
            opacity:Number(s.opacity),filter:s.filter,highlightOpacity:Number(before.opacity),transform:s.transform});
        if(time-start>180)resolve(frames);else requestAnimationFrame(sample);}requestAnimationFrame(sample);})`);
    check('真实歌词悬停产生跟随指针的局部亮区和轻微位移',rowHover.at(-1).hover&&parseFloat(rowHover.at(-1).pointerX)>0&&
        Math.abs(parseFloat(rowHover.at(-1).x))>.1&&rowHover.at(-1).highlightOpacity>.99&&rowHover.at(-1).filter==='blur(0px)',rowHover);
    main.webContents.sendInputEvent({type:'mouseMove',x:8,y:8});await nativePointerLeave();
    await waitFor(()=>evaluate(main,`!document.querySelector(${JSON.stringify(rowSelector)}).style.getPropertyValue('--mico-line-hover-x')&&!document.querySelector(${JSON.stringify(rowSelector)}).style.getPropertyValue('--mico-line-pointer-x')`),'歌词移出撤回局部变量');
    check('歌词移出撤回反馈而词组真实时间保持暂停',JSON.stringify((await pausedTokens()).tokens)===JSON.stringify(tokensAfter.tokens));
    await capture('22-paused-word-lift');
    for(const [label,patch] of [['低模糊',{lowBlur:true,reduceMotion:false}],['减少动效',{lowBlur:false,reduceMotion:true}]]){
        await settings(patch);await nativePointer(selector);const limited=await pointerFrames(selector,180);
        await nativePointerLeave();
        // sendInputEvent queues native delivery. Observe the completed leave draw
        // before starting the strict frozen-frame window; do not count that one
        // required static redraw as a persistent animation.
        await waitFor(async()=>{const value=(await state()).fluid;return value.pointerPresence===0&&
            value.pointerFeedbackControls===0&&value.rafPending===false;},label+'原生移出事件及静态重绘已完成');
        await stoppedGL(label+'指针静态反馈及移出无长活RAF');
        check(label+'指针反馈不推进流体时间且不残留控件状态',limited.every(frame=>frame.fluidTime===pointerBefore.fluid.timeSeconds)&&
            (await state()).fluid.pointerFeedbackControls===0&&(await state()).fluid.pointerPresence===0,{frames:limited,after:(await state()).fluid});
    }
    await settings({lowBlur:false,reduceMotion:false});
    await nativePointer(selector);await pointerFrames(selector,120);main.hide();
    await waitFor(async()=>(await state()).nativeVisible==='false'&&(await state()).fluid.phase==='suspended','隐藏时释放指针及GL');
    check('指针spring运行中原生hide撤回全部局部反馈和资源',glLiveResources(await state())===0&&(await state()).fluid.pointerFeedbackControls===0&&
        (await state()).fluid.pointerPresence===0&&(await state()).fluid.rafPending===false, (await state()).fluid);
    main.show();await waitFor(async()=>(await state()).nativeVisible==='true'&&(await state()).fluid.phase==='ready','原生显示恢复静态播放器');
    check('全部同步和指针检查保持原Audio对象与文档',navigationCount===1&&(await state()).audioCount===1&&(await state()).identity===entry.identity);
    await click('[aria-label="下一首"]');await waitFor(async()=>(await state()).song?.hash==='immersive-a','同步验收后生产队列回到第一首');
    await waitFor(()=>evaluate(main,`document.querySelector('.mico-lyric-row[data-mico-lyric-index="0"] .mico-lyric-token')&& !document.querySelector('.mico-lyric-gap-row[data-mico-lyric-gap-start="0"]')`),'恢复原始技术KRC');
    if((await state()).audio.paused){await click('.mico-immersive-play');await waitFor(async()=>!(await state()).audio.paused,'继续原Audio播放');}
}
async function naturalMenuGeometry(label) {
    const measured = await evaluate(main, `(() => {
        const menu=document.querySelector('#mico-immersive-options'), cover=document.querySelector('.mico-immersive-cover');
        const a=menu.getBoundingClientRect(), b=cover.getBoundingClientRect();
        const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
        const action=menu.querySelector('.mico-immersive-menu-action'), r=action.getBoundingClientRect();
        return {menu:rect(a),cover:rect(b),viewport:{width:innerWidth,height:innerHeight},
            intersection:{width:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),height:Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))},
            controlAboveGlass:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.mico-immersive-menu-action')===action,
            contentOpacity:Number(getComputedStyle(menu.querySelector('.mico-immersive-menu-content')).opacity),
            placement:document.querySelector('.mico-immersive-player').getAttribute('data-mico-menu-placement')};
    })()`);
    check(label + '菜单自然布局与封面无交叠且文字控件可交互', measured.intersection.width * measured.intersection.height < 1 &&
        measured.controlAboveGlass && measured.contentOpacity >= .99 && measured.menu.x >= 0 && measured.menu.y >= 0 &&
        measured.menu.x + measured.menu.width <= measured.viewport.width + 1 && measured.menu.y + measured.menu.height <= measured.viewport.height + 1, measured);
    return measured;
}
async function naturalMenuOpening(label) {
    const samples=await evaluate(main,`new Promise((resolve,reject)=>{
        const samples=[],started=performance.now();
        const sampleFrame=()=>{
            if(performance.now()-started>2500){reject(new Error('菜单自然液体展开超时'));return;}
            const menu=document.querySelector('#mico-immersive-options'),cover=document.querySelector('.mico-immersive-cover');
            if(!menu){requestAnimationFrame(sampleFrame);return;}
            const a=menu.getBoundingClientRect(),b=cover.getBoundingClientRect(),style=getComputedStyle(menu),content=getComputedStyle(menu.querySelector('.mico-immersive-menu-content'));
            document.dispatchEvent(new CustomEvent('mico-validation-observation-request'));
            const gl=JSON.parse(document.documentElement.getAttribute('data-mico-validation-plugin-observation')).gl.find(record=>record.canvasId==='mico-liquid-glass-canvas'&&Object.values(record.active).some(Boolean));
            const fluid=JSON.parse(document.querySelector('.mico-immersive-background').getAttribute('data-mico-fluid-state'));
            const sample={elapsedMs:performance.now()-started,anchorPhase:document.querySelector('.mico-immersive-menu-anchor').getAttribute('data-mico-menu-phase'),
                rect:{x:a.x,y:a.y,width:a.width,height:a.height},viewport:{width:innerWidth,height:innerHeight},borderRadius:style.borderRadius,transform:style.transform,
                contentOpacity:Number(content.opacity),inert:menu.inert,
                glFrames:fluid.frameCount,glTime:fluid.timeSeconds,rectUniforms:gl?.rectUniforms||[],
                intersectionArea:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),
                animations:menu.getAnimations().map(animation=>({playState:animation.playState,duration:animation.effect?.getTiming().duration}))};
            samples.push(sample);
            if(sample.anchorPhase==='open'){resolve(samples);return;}
            requestAnimationFrame(sampleFrame);
        };
        const button=document.querySelector('.mico-immersive-more');button.focus();button.click();requestAnimationFrame(sampleFrame);
    })`);
    const moving=samples.filter(sample=>sample.anchorPhase==='opening');
    const final=samples.at(-1),early=moving.filter(sample=>sample.elapsedMs<=120),revealed=moving.filter(sample=>sample.contentOpacity>.05);
    check(label+'菜单液体展开中实际轮廓持续变形且不穿过封面',moving.length>=3&&new Set(moving.map(sample=>sample.transform)).size>=3&&
        moving.every(sample=>sample.intersectionArea<1&&sample.inert)&&early.every(sample=>sample.contentOpacity<=.01)&&
        revealed.every(sample=>sample.rect.width/final.rect.width>=.6&&sample.rect.height/final.rect.height>=.6)&&final.contentOpacity>=.99,
        {samples,interpretation:'读取原生WAAPI期间真实DOMRect/transform/圆角/文本opacity；未人工translate菜单，也未跳过中间帧'});
    report.observations.menuOpeningFrames??={};report.observations.menuOpeningFrames[label]=samples;
}
async function nativeMenuPointer() {
    const target=await evaluate(main,`(() => {const node=document.querySelector('.mico-immersive-menu-field > span'),r=node.getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)===node||node.contains(document.elementFromPoint(x,y))};})()`);
    check('菜单原生点击坐标来自当前实测标签且命中自身',target.hit,target);
    testActions.push({action:'native menu label pointer',...target,time:Date.now()});
    main.webContents.sendInputEvent({type:'mouseMove',x:Math.round(target.x),y:Math.round(target.y)});
    main.webContents.sendInputEvent({type:'mouseDown',button:'left',x:Math.round(target.x),y:Math.round(target.y),clickCount:1});
    main.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(target.x),y:Math.round(target.y),clickCount:1});
    await new Promise(resolve=>setTimeout(resolve,80));
    check('原生pointerdown点击菜单内部不被根层菜单误判为外部并关闭',await evaluate(main,`document.querySelector('.mico-immersive-menu-anchor')?.getAttribute('data-mico-menu-phase')==='open'&&Boolean(document.querySelector('#mico-immersive-options'))`));
}
async function menuContrastEvidence(label) {
    const samples = await evaluate(main, `(() => {
        const menu=document.querySelector('#mico-immersive-options');
        const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');
        return [...menu.querySelectorAll('.mico-immersive-menu-action, .mico-immersive-menu-field > span')].map((node,index)=>{
            const r=node.getBoundingClientRect();ctx.clearRect(0,0,1,1);ctx.fillStyle=getComputedStyle(node).color;ctx.fillRect(0,0,1,1);
            return {name:'menu-text-'+index,x:r.x+Math.min(r.width/2,60),y:r.y+r.height/2,width:3,height:3,color:Array.from(ctx.getImageData(0,0,1,1).data)};
        });
    })()`);
    const background=await readOutputCanvas('.mico-immersive-background-canvas',samples), overlay=await readOutputCanvas('.mico-immersive-glass-overlay',samples);
    const luminance=rgb=>rgb.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const contrasts=samples.map((sample,index)=>{
        const under=background.regions[index].pixels, glass=overlay.regions[index].pixels, ratios=[];
        for(let pixel=0;pixel<under.length;pixel+=4){
            const alpha=glass[pixel+3]/255, material=[0,1,2].map(channel=>glass[pixel+channel]*alpha+under[pixel+channel]*(1-alpha));
            const ink=[0,1,2].map(channel=>sample.color[channel]*(sample.color[3]/255)+material[channel]*(1-sample.color[3]/255));
            const light=luminance(ink),dark=luminance(material);ratios.push((Math.max(light,dark)+.05)/(Math.min(light,dark)+.05));
        }
        return {name:sample.name,minContrast:Math.min(...ratios),maxContrast:Math.max(...ratios),color:sample.color};
    });
    report.observations.menuContrasts??={};report.observations.menuContrasts[label]={contrasts,
        interpretation:'实际 GL 玻璃 RGBA 与实际背景 RGB 逐像素合成，再与 DOM computed color 计算 WCAG 对比度；不以 CSS tint 字符串代替实际材质，主操作与字段标签要求4.5:1'};
    check(label+'菜单主操作及字段标签实际背景对比度至少4.5:1',contrasts.length>=8&&contrasts.every(value=>value.minContrast>=4.5),contrasts);
}
async function darkModeEvidence() {
    const before=await state();
    await evaluate(main, `document.documentElement.classList.add('dark')`);
    await evaluate(main, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const styles=await evaluate(main, `(() => {
        const html=getComputedStyle(document.documentElement),seek=getComputedStyle(document.querySelector('.mico-immersive-seek'));
        const volume=getComputedStyle(document.querySelector('.mico-immersive-volume-range'));
        return {rootFilter:html.filter,rootBlend:html.mixBlendMode,seekBackground:seek.backgroundColor,seekBorder:seek.borderWidth,
            volumeBackground:volume.backgroundColor,volumeBorder:volume.borderWidth,menuColor:getComputedStyle(document.querySelector('#mico-immersive-options')).color};
    })()`);
    check('深色模式撤回整页调暗multiply且seek/音量输入无黑色背景',styles.rootFilter==='none'&&styles.rootBlend==='normal'&&
        styles.seekBackground==='rgba(0, 0, 0, 0)'&&styles.volumeBackground==='rgba(0, 0, 0, 0)'&&styles.seekBorder==='0px'&&styles.volumeBorder==='0px',styles);
    await naturalMenuGeometry('深色白亮封面');await menuContrastEvidence('dark-bright');
    await capture('16-dark-bright-menu');
    await click('.mico-immersive-more');await waitFor(()=>evaluate(main,`!document.querySelector('#mico-immersive-options')`),'深色菜单关闭');
    await capture('17-dark-bright-player');
    await evaluate(main,`document.documentElement.classList.remove('dark')`);
    continuity('深色模式切换保持原歌曲音频与进度',before,await state(),before.audio.paused);
}
async function heroSample(action, opening) {
    const before = await state(), samples = [], started = Date.now();
    if(!opening)await evaluate(main,`(() => {
        window.__immersiveValidationHeroEnd=null;
        const observer=new MutationObserver(()=>{
            const root=document.querySelector('.mico-immersive-player'),cover=root?.querySelector('.mico-immersive-cover');
            if(root?.getAttribute('data-mico-hero-phase')!=='closing'||!cover)return;
            const animation=cover.getAnimations().find(item=>item.effect?.getTiming().duration===450&&item.playState==='running');
            if(!animation)return;observer.disconnect();
            animation.finished.then(()=>{const compact=document.querySelector('.player-bar .album-art'),rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
                window.__immersiveValidationHeroEnd={cover:rect(cover),origin:rect(compact),coverConnected:cover.isConnected};},error=>{window.__immersiveValidationHeroEnd={error:error.message};});
        });
        observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-mico-hero-phase']});
    })()`);
    await action();
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
        const final=await evaluate(main,'window.__immersiveValidationHeroEnd');
        assert.ok(final?.cover&&final?.origin,'实际Hero完成末帧在DOM移除前可观察');
        const errorPx=Math.max(...['x','y','width','height'].map(key=>Math.abs(final.cover[key]-final.origin[key])));
        check('Hero自然完成末帧准确落到真实小封面位置',final.coverConnected&&errorPx<2,{...final,maxGeometryErrorPx:errorPx,
            interpretation:'监听当前真实450ms WAAPI的finished；在Vue卸载前直接读取封面和生产compactCover同一DOMRect；未强制finish或猜测小封面坐标'});
        report.observations.heroClosingFinalFrames??=[];report.observations.heroClosingFinalFrames.push({...final,maxGeometryErrorPx:errorPx});
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
async function menuHeroInterruption() {
    const before=await state();
    await click('.mico-immersive-more');
    await waitFor(()=>evaluate(main,`document.querySelector('.mico-immersive-menu-anchor')?.getAttribute('data-mico-menu-phase')==='opening'`),'退出组合前菜单正在展开');
    await new Promise(resolve=>setTimeout(resolve,100));
    await heroSample(()=>click('.mico-immersive-close'),false);
    await waitFor(async()=>{const s=await state();return s.immersive===0&&s.legacy===0;},'菜单展开途中Hero退出结束');
    check('菜单展开中退出完整撤回菜单与全部自有canvas/GL',await evaluate(main,`!document.querySelector('#mico-immersive-options')`)&&
        (await state()).ownedCanvases===0&&glLiveResources(await state())===0);
    continuity('菜单展开中直接退出保留唯一Audio及暂停状态',before,await state(),before.audio.paused);
    await heroSample(()=>click('.player-bar .album-art'),true);
    check('组合动画退出后重入没有遗留打开菜单',await evaluate(main,`!document.querySelector('#mico-immersive-options')&&document.querySelector('.mico-immersive-more').getAttribute('aria-expanded')==='false'`));
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
    await measuredFlowCadence();
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
    await naturalMenuOpening('暖色');
    const box = await evaluate(main, `(() => { const r = document.querySelector('#mico-immersive-options').getBoundingClientRect(); return {x:r.x+10,y:r.y+10,width:60,height:60}; })()`);
    const pointerFrame = () => { main.webContents.sendInputEvent({ type:'mouseMove', x:8, y:10 }); };
    const open = await readGL([{name:'menu',...box}], pointerFrame);
    await naturalMenuGeometry('暖色封面');
    await nativeMenuPointer();
    const overlay = await readOutputCanvas('.mico-immersive-glass-overlay', [{name:'natural-menu-glass', ...box,width:16,height:16}]);
    check('自然菜单区域实际玻璃输出含折射颜色与alpha', overlay.regions[0].pixels.some((value,index)=>index%4===3&&value>0) && overlay.regions[0].pixels.some((value,index)=>index%4!==3&&value>0), pixelSummary(overlay.regions[0]));
    await menuContrastEvidence('warm');
    await capture('13-glass-natural-menu');
    await click('.mico-immersive-more'); await waitFor(() => evaluate(main, `!document.querySelector('#mico-immersive-options')`), '光学材质菜单关闭');
    const closed = await readGL([{name:'menu',...box}], () => { main.webContents.sendInputEvent({ type:'mouseMove',x:8,y:9 }); });
    const materialDifference = pixelDifference(open.regions[0], closed.regions[0]);
    check('暂停流体时菜单玻璃改变真实 framebuffer 内折射与高光像素', materialDifference.meanChannelDifference > .1 && materialDifference.changedPixelFraction > .01, materialDifference);
    report.observations.glassPixelReadback = { menuRegion:box, open:pixelSummary(open.regions[0]), closed:pixelSummary(closed.regions[0]), difference:materialDifference,
        interpretation:'暂停背景后比较菜单有无时同区域GL像素；排除HTML字形与CSS层，仅证明光学shader真实输出，视觉等效仍由用户评审' };
    await menuReversal();
    await menuHeroInterruption();
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
async function recordMotionVideo(captureMethod='capturePage') {
    const encoder = '/opt/homebrew/bin/ffmpeg';
    assert.ok(fs.statSync(encoder, { throwIfNoEntry: false })?.isFile(), '已读取现有 ffmpeg 编码器，未安装新依赖');
    const filename = '11-webgl-motion' + (captureMethod==='capturePage'?'-capturePage':'') + (mode === 'unthrottled' ? '-unthrottled' : '') + '.mp4';
    const destination = path.join(evidence, filename), timestamps = [], encodingTimes = [], presentationTimes = [];
    const intermediate = path.join(profile, filename + '.ffv1.mkv');
    let child = null, completion = null;
    const started = performance.now();let accepting=true,backpressure=false,throttleDrops=0,backpressureDrops=0,emptyFrames=0,frameError=null,outputSize=null,nativeImageSize=null;
    let captureTimer=null,lastHash=null,duplicateFrames=0,captureRequests=0,inFlightDrops=0;
    const captures=new Set(),captureLatenciesMs=[];
    const startEncoder = () => {
        child = spawn(encoder, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'bgra',
            '-video_size', `${outputSize.width}x${outputSize.height}`, '-framerate', '60', '-i', 'pipe:0', '-an',
            '-c:v', 'ffv1', '-level', '3', '-slices', '16', '-slicecrc', '0', '-threads', '4', intermediate],
            { stdio: ['pipe', 'ignore', 'pipe'] });
        let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
        completion = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code =>
            code === 0 ? resolve() : reject(new Error('原生 bitmap 无损中间编码失败：' + errors))); });
        completion.catch(()=>{});
        child.stdin.on('drain',()=>{backpressure=false;});
        child.stdin.on('error',error=>{frameError=error;accepting=false;});
    };
    const processFrame=(frame)=>{
        if(!accepting)return;
        const time=performance.now()-started;presentationTimes.push(time);
        if(frame.isEmpty()){emptyFrames++;return;}
        if(captureMethod==='subscription'&&timestamps.length&&time-timestamps.at(-1)<15){throttleDrops++;return;}
        if(backpressure){backpressureDrops++;return;}
        try{
            if(!outputSize){nativeImageSize=frame.getSize();outputSize={width:1470,height:Math.round(1470*nativeImageSize.height/nativeImageSize.width/2)*2};}
            const began=performance.now(),videoFrame=frame.resize({...outputSize,quality:'good'});
            const encoded=videoFrame.toBitmap();
            assert.equal(encoded.length, outputSize.width * outputSize.height * 4, '原生 bitmap 精确尺寸');
            const hash=createHash('sha256').update(encoded).digest('hex');encodingTimes.push(performance.now()-began);
            if(hash===lastHash){duplicateFrames++;return;}lastHash=hash;
            if(!child)startEncoder();
            timestamps.push(time);backpressure=!child.stdin.write(encoded);
        }catch(error){frameError=error;accepting=false;}
    };
    if(captureMethod==='subscription'){
        // 本机Electron39.2.4官方实现把beginFrameSubscription固定限制在30Hz；不用重复帧伪造60fps。
        main.webContents.beginFrameSubscription(false,processFrame);
    }else{
        // 直接采集同一隔离webContents，最多两个readback；按实际bitmap去重，编码移至子进程。
        captureTimer=setInterval(()=>{
            if(!accepting)return;
            if(captures.size>=2){inFlightDrops++;return;}
            const began=performance.now();captureRequests++;
            const task=main.webContents.capturePage().then(frame=>{captureLatenciesMs.push(performance.now()-began);processFrame(frame);})
                .catch(error=>{frameError=error;accepting=false;}).finally(()=>captures.delete(task));
            captures.add(task);
        },16);
    }
    const stopCapture=async()=>{accepting=false;if(captureTimer!==null)clearInterval(captureTimer);if(captureMethod==='subscription')main.webContents.endFrameSubscription();await Promise.all([...captures]);};
    try {
        const choreography=[
            [350,'hover-play'],[1000,'toggle-menu'],[1700,'hover-menu'],[2400,'hover-lyric'],[3000,'toggle-menu'],
            [3600,'hover-next'],[4300,'hover-lyric'],[5000,'toggle-menu'],[5700,'hover-menu'],[6400,'leave'],[7000,'toggle-menu']
        ];
        for(const [targetMs,action] of choreography){
            const wait=targetMs-(performance.now()-started);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
            if(action==='toggle-menu')await click('.mico-immersive-more');
            else if(action==='hover-play')await nativePointer('.mico-immersive-play');
            else if(action==='hover-next')await nativePointer('[aria-label="下一首"]');
            else if(action==='hover-menu')await nativePointer('.mico-immersive-menu-action');
            else if(action==='hover-lyric')await nativeVisibleLyricPointer();
            else await nativePointerLeave();
        }
        const wait=8000-(performance.now()-started);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
        await stopCapture();
        if(frameError)throw frameError;
        assert.ok(child && timestamps.length > 1, '已采到真实 bitmap 帧');
        child.stdin.end(); await completion;
    } catch (error) {
        try { await stopCapture(); }
        finally {
            child?.stdin.destroy();
            if(child && child.exitCode===null&&child.signalCode===null)child.kill();
            await completion?.catch(()=>{});
        }
        throw error;
    }
    const elapsedMs = timestamps.at(-1) - timestamps[0];
    // 用平衡表达式逐帧映射真实采集时间；不使用编码排队或管道到达时间。
    const pts = timestamps.map(time => Math.round(time - timestamps[0]));
    function timestampExpression(first, last) {
        if(first === last)return String(pts[first]);
        const middle = Math.floor((first + last) / 2);
        return `if(lte(N,${middle}),${timestampExpression(first,middle)},${timestampExpression(middle+1,last)})`;
    }
    const filters = path.join(profile, filename + '.pts-filter.txt');
    fs.writeFileSync(filters, `settb=1/1000,setpts='${timestampExpression(0,pts.length-1)}'`);
    await new Promise((resolve,reject)=>{
        const finalEncoder=spawn(encoder,['-hide_banner','-loglevel','error','-y','-i',intermediate,'-/filter:v',filters,
            '-an','-c:v','libx264','-preset','fast','-crf','20','-bf','0','-enc_time_base','1:1000','-fps_mode','vfr',
            '-pix_fmt','yuv420p','-movflags','+faststart',destination],{stdio:['ignore','ignore','pipe']});
        let errors='';finalEncoder.stderr.on('data',chunk=>{errors+=chunk;});
        finalEncoder.on('error',reject);finalEncoder.on('exit',code=>code===0?resolve():reject(new Error('真实采集时间VFR编码失败：'+errors)));
    });
    const probe=path.join(path.dirname(encoder),'ffprobe');assert.ok(fs.statSync(probe,{throwIfNoEntry:false})?.isFile(),'现有ffprobe可读取成片真实元数据');
    const metadata=JSON.parse(execFileSync(probe,['-v','error','-select_streams','v:0','-show_entries','stream=nb_frames,r_frame_rate,avg_frame_rate,duration:format=duration','-of','json',destination],{encoding:'utf8'}));
    const actualCapturedFps=(timestamps.length-1)*1000/elapsedMs,stream=metadata.streams[0],videoSeconds=Number(metadata.format.duration);
    const presentation=JSON.parse(execFileSync(probe,['-v','error','-select_streams','v:0','-show_frames',
        '-show_entries','frame=best_effort_timestamp_time','-of','json',destination],{encoding:'utf8',maxBuffer:16*1024*1024}));
    assert.equal(presentation.frames.length, timestamps.length, 'VFR逐帧保留每张独立原生bitmap');
    const maxEncodedTimestampErrorMs=Math.max(...presentation.frames.map((frame,index)=>
        Math.abs(Number(frame.best_effort_timestamp_time)*1000-(timestamps[index]-timestamps[0]))));
    assert.ok(maxEncodedTimestampErrorMs<=1.01,'成片每帧PTS与真实采集时间误差不超过1ms');
    fs.rmSync(intermediate);
    const encodingSorted=[...encodingTimes].sort((a,b)=>a-b);
    const result = { file: filename,captureMethod,capturedFrames: timestamps.length, elapsedMs, actualCapturedFps, frameTimestampsMs: timestamps,
        presentationFrames:presentationTimes.length,presentationTimestampsMs:presentationTimes,throttleDrops,backpressureDrops,emptyFrames,
        captureRequests,inFlightDrops,duplicateFrames,captureLatenciesMs,
        encodingMedianMs:encodingSorted[Math.floor(encodingSorted.length*.5)],encodingP95Ms:encodingSorted[Math.floor(encodingSorted.length*.95)],
        encoder,outputSize,nativeImageSize,resizeQuality:'good',capturePixelFormat:'bgra',intermediateCodec:'ffv1',
        maxEncodedTimestampErrorMs,ffprobe:metadata,
        pointerChoreography:'0.35秒播放悬停、1秒菜单展开、1.7秒菜单项悬停、2.4秒悬停当时真实可见的可seek歌词行、3秒关闭、3.6秒下一首悬停、4.3秒悬停当时真实可见的可seek歌词行、5秒展开、5.7秒菜单项悬停、6.4秒原生指针离开、7秒关闭；有可见当前行时优先，实际stage-index、DOMRect和原生输入位置另记testActions；系统指针不合成到帧中',
        interpretation: '采集同一隔离宿主的真实bitmap；按原始像素去重，记录背压与readback跳过。主进程只缩放/复制bitmap，子进程FFV1无损暂存；采集后按每帧真实时间生成VFR并逐帧核对PTS，不使用编码排队时间，不重复帧。独立GL cadence在录制前另测' };
    report.observations.motionVideoAttempts??=[];report.observations.motionVideoAttempts.push(result);
    check(captureMethod+'实际视频保留至少5秒真实采样时长',elapsedMs>=5000&&Number(stream.nb_frames)>=timestamps.length*.95&&
        videoSeconds>=5&&Math.abs(videoSeconds-elapsedMs/1000)<.5&&fs.statSync(destination).size>1000,result);
    if(captureMethod==='capturePage'&&actualCapturedFps<50){
        console.log('直接capturePage实际采样 '+actualCapturedFps.toFixed(2)+'fps，保留本次成片；改用官方固定30Hz订阅记录，不把证据API采样率当运行GLfps。');
        await recordMotionVideo('subscription');return;
    }
    if(captureMethod==='subscription'){
        result.captureApiCap={electronVersion:'39.2.4',maximumFps:30,
            source:'https://github.com/electron/electron/blob/v39.2.4/shell/browser/api/frame_subscriber.cc',blobSha:'b3171c433991b87d0a010ff83c3bbce2fa7ff2f1',
            evidence:'constexpr static int kMaxFrameRate = 30; SetMinCapturePeriod(base::Seconds(1) / kMaxFrameRate)'};
        check('官方固定30Hz订阅保留至少25fps独立真实帧，运行60Hz另测',process.versions.electron==='39.2.4'&&timestamps.length>=175&&actualCapturedFps>=25,result);
    }else{
        check('直接capturePage取得至少50fps独立真实帧',timestamps.length>=350&&actualCapturedFps>=50,result);
        const canonical='11-webgl-motion'+(mode==='unthrottled'?'-unthrottled':'')+'.mp4';fs.copyFileSync(destination,path.join(evidence,canonical));result.file=canonical;
    }
    report.observations.motionVideo=result;
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
            { id: 2, hash: 'immersive-b', playHash: 'immersive-b', name: '隔离验收 · 无歌词 / 坏封面', author: 'MicoMusic 技术音频', img: baseUrl + '/fixture-cover-missing.svg', url: baseUrl + '/fixture-b.wav', timeLength: duration },
            { id: 3, hash: 'immersive-c', playHash: 'immersive-c', name: '隔离验收 · White Canvas', author: 'MicoMusic 技术音频', img: baseUrl + '/fixture-cover-bright.svg', url: baseUrl + '/fixture-a.wav', timeLength: duration },
            { id: 4, hash: 'immersive-d', playHash: 'immersive-d', name: '隔离验收 · Prelude Source Clock', author: 'MicoMusic 技术音频', img: baseUrl + '/fixture-cover.svg', url: baseUrl + '/fixture-a.wav', timeLength: duration }];
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
        // 技术WAV的扬声器输出静音；保留原Audio元素、时钟、volume和所有媒体控制处理。
        // 本次测量不验收系统媒体键或扬声器听感，不改动用户开发版的任何设置。
        main.webContents.setAudioMuted(true);
        report.isolation.hostAudioMuted = main.webContents.isAudioMuted();
        assert.equal(report.isolation.hostAudioMuted, true);
        report.limitations.push('隔离宿主通过Electron setAudioMuted静音扬声器输出；原Audio时间与控制照常运行，未禁用MediaSession处理，但本测量不代表系统媒体控制和人声听感验收');
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
        const restoredQueue=await evaluate(main,`JSON.parse(localStorage.getItem('MusicQueue')).queue.map(song=>({id:song.id,hash:song.hash,playHash:song.playHash}))`);
        const expectedQueue=songs.map(song=>({id:song.id,hash:song.hash,playHash:song.playHash}));
        check('真实生产播放器按顺序恢复四歌曲 fixture 队列',JSON.stringify(restoredQueue)===JSON.stringify(expectedQueue)&&
            await evaluate(main,`Boolean(document.querySelector('.player-bar .album-art'))`),{expected:expectedQueue,restored:restoredQueue});
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
        await syncAndPointerEvidence();
        // 录像长度取决于实际捕获路径；先回到确定的另一句再验证滚动，
        // 避免当前已经到25秒所在句时把正确的静止误判为缺少弹簧动画。
        await setInput('.mico-immersive-seek',0);
        await waitFor(async()=>{
            const spring=await springState();
            return spring?.phase==='idle'&&await evaluate(main,`document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-active')==='0'`);
        },'弹簧验证从实际第一句静止位置开始');
        await setInput('.mico-immersive-seek', 25, 'input'); await setInput('.mico-immersive-seek', 25);
        await waitFor(async () => Math.abs((await state()).audio.time - 25) < 1.5, '真实 seek');
        check('进度控件调整生产 Audio 当前时间', true, (await state()).audio);
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-active') === '2'`), 'seek 后实际当前行');
        const springFrames = [];
        await waitFor(async () => { const sample = await springState(); springFrames.push(sample); return sample?.phase === 'idle' && Math.abs(sample.target-sample.scrollTop) < 2; }, '真实 ODE 弹簧跟随稳定', 4000);
        check('歌词通过 ODE 弹簧逐帧滚动并稳定到目标，不使用浏览器smooth滚动', springFrames.length >= 2 && springFrames.some(sample => sample.phase === 'running' && Math.abs(sample.velocity) > 1) && springFrames.every(sample => sample.smoothCalls === 0 && sample.scrollBehavior === 'auto'), springFrames);
        const longLineWrap=await evaluate(main, `(() => { const row=document.querySelector('.mico-lyric-active'),text=row?.querySelector('.mico-lyric-primary');
            if(!row||!text)return null;return {primary:text.getBoundingClientRect().toJSON(),row:row.getBoundingClientRect().toJSON(),
                scrollWidth:text.scrollWidth,clientWidth:text.clientWidth,paddingInlineEnd:getComputedStyle(text).paddingInlineEnd};})()`);
        report.observations.longLineWrap=longLineWrap;
        check('长句按原歌词结构换行且不越出歌词行',Boolean(longLineWrap)&&longLineWrap.primary.width<=longLineWrap.row.width+1&&
            longLineWrap.scrollWidth<=longLineWrap.clientWidth+1,longLineWrap);
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
        await click('[aria-label="下一首"]');
        await waitFor(async ()=>(await state()).song?.hash==='immersive-c'&&(await state()).audio.src.endsWith('/fixture-a.wav'),'真实队列切换原创白亮封面歌曲');
        await waitFor(async ()=>(await state()).fluid?.coverSceneStatus==='ready'&&(await state()).fluid?.phase==='ready'&&Boolean(await evaluate(main,`document.querySelectorAll('.mico-lyric-row').length>0`)),'白亮封面自然上传与歌词解析');
        await click('.mico-immersive-play');await waitFor(async ()=>(await state()).audio.paused,'白亮菜单视觉检查前暂停真实音频');
        await naturalMenuOpening('白亮高对比');
        await naturalMenuGeometry('白亮高对比封面');await menuContrastEvidence('bright');
        await capture('15-bright-natural-menu');
        await darkModeEvidence();
        await click('[aria-label="上一首"]');
        await waitFor(async ()=>(await state()).song?.hash==='immersive-b','真实队列先返回无歌词歌曲');
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
        await waitFor(() => evaluate(main, `document.querySelector('.mico-immersive-lyrics')?.getAttribute('data-mico-lyric-phase') === 'interlude'`), 'KRC 两秒真实换气间隙');
        check('两秒行间换气不产生悬浮间奏点', await evaluate(main, `!document.querySelector('.mico-lyric-gap')&&document.querySelector('.mico-immersive-lyrics').getAttribute('data-mico-lyric-gap-key')==='none'`));
        await capture('18-short-gap-no-dots');
        await setInput('.mico-immersive-seek', 37);
        await waitFor(()=>evaluate(main,`Boolean(document.querySelector('.mico-lyric-gap-active[data-mico-lyric-gap-start="34000"][data-mico-lyric-gap-end="40000"] .mico-lyric-gap'))`),'真实六秒间奏布局行显示');
        await waitFor(async()=>{const s=await springState();return s?.phase==='idle'&&Math.abs(s.target-s.scrollTop)<2;},'真实间奏自身布局行跟随结束',4000);
        const gap=await evaluate(main,`(() => {const stage=document.querySelector('.mico-immersive-lyrics'),row=document.querySelector('.mico-lyric-gap-active'),dots=row.querySelector('.mico-lyric-gap'),r=row.getBoundingClientRect(),v=stage.getBoundingClientRect(),d=dots.getBoundingClientRect();
            return {active:stage.getAttribute('data-mico-lyric-active'),focus:stage.getAttribute('data-mico-lyric-stage-focus'),rowIndex:row.getAttribute('data-mico-lyric-stage-index'),
                progress:dots.getAttribute('data-mico-lyric-gap-progress'),centerRatio:(r.y+r.height/2-v.y)/v.height,
                rowPosition:getComputedStyle(row).position,dotPosition:getComputedStyle(dots).position,dotsInsideRow:d.y>=r.y&&d.bottom<=r.bottom,
                scrollTop:stage.scrollTop,fills:[...row.querySelectorAll('.mico-lyric-gap-dot')].map(n=>n.style.getPropertyValue('--mico-gap-dot-fill'))};})()`);
        check('长间奏点位于歌词布局流并跟随自己的行索引',gap.active==='-1'&&gap.focus===gap.rowIndex&&gap.dotsInsideRow&&
            !['absolute','fixed'].includes(gap.rowPosition)&&!['absolute','fixed'].includes(gap.dotPosition)&&Math.abs(gap.centerRatio-.43)<.02,gap);
        await new Promise(resolve=>setTimeout(resolve,350));
        const stableGap=await evaluate(main,`(() => {const s=document.querySelector('.mico-immersive-lyrics'),g=document.querySelector('.mico-lyric-gap');return {progress:g.getAttribute('data-mico-lyric-gap-progress'),scrollTop:s.scrollTop,fills:[...g.querySelectorAll('.mico-lyric-gap-dot')].map(n=>n.style.getPropertyValue('--mico-gap-dot-fill'))};})()`);
        check('暂停时真实间奏进度与布局稳定无独立计时推进',gap.progress===stableGap.progress&&JSON.stringify(gap.fills)===JSON.stringify(stableGap.fills)&&Math.abs(gap.scrollTop-stableGap.scrollTop)<.5&& (await state()).audio.paused,stableGap);
        await capture('19-long-gap-in-lyric-flow');
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
        // IPC重载会替换扩展隔离世界；观察器注入时现有GL对象已经创建。
        // 正常关闭再进入播放器，使后续检查观测真实的新对象创建，而非空记录冒充已释放。
        await heroSample(()=>click('.mico-immersive-close'),false);
        await heroSample(()=>click('.player-bar .album-art'),true);
        check('重载后重新进入的GL对象由当前隔离观察器实际记录',glLiveResources(await state())>0);
        await settings({ lowBlur: true });
        await waitFor(async () => (await state()).background.motion === 'still', '低模糊停止背景流动');
        await stoppedGL('低模糊模式冻结流体并停止持续 GL RAF', {allowStaticControlUpdates:true});
        await capture('08-low-blur');
        await click('.mico-immersive-play');await waitFor(async()=>(await state()).audio.paused,'低模糊有限菜单动画前暂停同一Audio');
        // pause/最终timeupdate可使Vue同步最后一个seek value，允许这次有限静态材质更新先完成再取严格停止基线。
        await new Promise(resolve=>setTimeout(resolve,400));
        await stoppedGL('低模糊暂停后背景循环完全停止');
        await naturalMenuOpening('低模糊暂停');
        const lowBlurFrames=report.observations.menuOpeningFrames['低模糊暂停'].filter(sample=>sample.anchorPhase==='opening'&&sample.elapsedMs>=100&&sample.elapsedMs<=300);
        const outline=lowBlurFrames.map(sample=>{
            const menuDraw=sample.rectUniforms.filter(uniform=>uniform.menuErrorPx!==null).sort((a,b)=>a.menuErrorPx-b.menuErrorPx)[0];
            return {elapsedMs:sample.elapsedMs,frames:sample.glFrames,time:sample.glTime,maxGeometryErrorPx:menuDraw?.menuErrorPx??null,
                interpretation:'每次真实u_rect上传时与同一时刻菜单DOMRect对照；不把最后绘制的工具按钮当菜单'};
        });
        check('低模糊暂停时100至300ms玻璃轮廓随真实DOM变形且流体时间冻结',outline.length>=3&&new Set(outline.map(sample=>sample.frames)).size>=3&&
            outline.every(sample=>sample.maxGeometryErrorPx!==null&&sample.maxGeometryErrorPx<.5)&&new Set(outline.map(sample=>sample.time)).size===1,outline);
        await stoppedGL('低模糊暂停菜单展开后无持续GL循环');await capture('21-low-blur-paused-menu');
        await click('.mico-immersive-more');await waitFor(()=>evaluate(main,`!document.querySelector('#mico-immersive-options')`),'低模糊菜单关闭');
        await stoppedGL('低模糊暂停菜单关闭后无持续GL循环');
        await click('.mico-immersive-play');await waitFor(async()=>!(await state()).audio.paused,'低模糊有限动画后恢复同一Audio');
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
        await naturalMenuOpening('窄窗口');await naturalMenuGeometry('窄窗口');await menuContrastEvidence('narrow');
        await capture('20-narrow-natural-menu');
        await pressedKey('Escape');await waitFor(()=>evaluate(main,`!document.querySelector('#mico-immersive-options')`),'窄窗口菜单关闭');
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
