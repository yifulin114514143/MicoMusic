import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const pluginUrl = new URL('../plugins/extensions/mico-liquid-glass/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, pluginUrl), 'utf8');
const key = 'micoLiquidGlassSettings';
const extensionId = 'test-liquid-glass-extension';
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

class TrackedTarget {
    listeners = new Map();
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    dispatch(name, event = {}) { for (const callback of [...(this.listeners.get(name) || [])]) callback(event); }
    get count() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

function makeHarness({ stored, resourceFailure, storageFailure, delayStyle = false, popup = false, fluidRuntime } = {}) {
    const document = new TrackedTarget();
    const window = new TrackedTarget();
    const attrs = new Map([['class', 'host-theme-class']]);
    const children = [];
    document.documentElement = {
        setAttribute: (name, value) => attrs.set(name, value),
        removeAttribute: (name) => attrs.delete(name),
        getAttribute: (name) => attrs.get(name) ?? null,
        appendChild: (node) => { children.push(node); node.remove = () => children.splice(children.indexOf(node), 1); }
    };
    document.createElement = (tag) => ({ tag, id: '', textContent: '' });
    const controls = Object.fromEntries(['glass-settings', 'status', 'enabled', 'theme', 'reduceMotion', 'lowBlur'].map((name) => [name, new TrackedTarget()]));
    document.getElementById = (name) => controls[name];
    const storageListeners = new Set();
    const store = stored === undefined ? {} : { [key]: stored };
    let runtimeError = null;
    const changed = (value) => {
        const oldValue = store[key];
        store[key] = value;
        for (const callback of [...storageListeners]) callback({ [key]: { oldValue, newValue: value } }, 'local');
    };
    const chrome = {
        runtime: { id: extensionId, getURL: (name) => `chrome-extension://${extensionId}/${name}`, get lastError() { return runtimeError; } },
        storage: {
            onChanged: { addListener: (callback) => storageListeners.add(callback), removeListener: (callback) => storageListeners.delete(callback) },
            local: {
                get: (_key, callback) => queueMicrotask(() => { runtimeError = storageFailure ? { message: storageFailure } : null; callback(store); runtimeError = null; }),
                set: (value, callback) => { changed(plain(value[key])); callback?.(); }
            }
        }
    };
    let releaseStyle;
    const pendingStyle = new Promise((resolve) => { releaseStyle = resolve; });
    const requests = [];
    const errors = [];
    const context = vm.createContext({
        document, window, chrome, AbortController, MicoFluidGlass: fluidRuntime,
        console: { error: (...args) => errors.push(args) },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (delayStyle) await pendingStyle;
            const name = new URL(url).pathname.slice(1);
            const failed = resourceFailure === true || resourceFailure === name;
            return { ok: !failed, status: failed ? 404 : 200, text: async () => read(name) };
        }
    });
    const run = (name) => vm.runInContext(read(name), context, { filename: name });
    run('settings.js');
    run(popup ? 'popup.js' : 'content.js');
    const command = (detail) => document.dispatch('mico-visual-lifecycle', { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    return { document, window, attrs, children, storageListeners, context, run, changed, command, requests, errors, releaseStyle, store, controls };
}

test('设置逐字段校验，保留关闭决定及合法模式', () => {
    const harness = makeHarness();
    const normalize = harness.context.MicoLiquidGlassSettings.normalize;
    assert.deepEqual(plain(normalize()), { version: 1, enabled: true, theme: 'auto', reduceMotion: false, lowBlur: false });
    assert.deepEqual(plain(normalize({ enabled: false, theme: 'dark', reduceMotion: true, lowBlur: true, extra: 'ignored' })), { version: 1, enabled: false, theme: 'dark', reduceMotion: true, lowBlur: true });
    assert.deepEqual(plain(normalize({ enabled: 'false', theme: 'DARK', reduceMotion: 1, lowBlur: null })), plain(normalize()));
    assert.deepEqual(plain(normalize([])), plain(normalize()));
    harness.context.__micoLiquidGlassRuntime.dispose();
});

test('已关闭设置首屏不创建材质，资源通过扩展精确URL读取', async () => {
    const harness = makeHarness({ stored: { enabled: false, theme: 'light' } });
    assert.equal(harness.children.length, 0);
    await settle();
    assert.equal(harness.children.length, 0);
    assert.equal(harness.attrs.has('data-mico-liquid-glass'), false);
    assert.deepEqual(JSON.parse(harness.attrs.get('data-mico-visual-ready')), { extensionId, enabled: false, success: true });
    assert.equal(harness.requests[0].url, `chrome-extension://${extensionId}/glass.css`);
    assert.deepEqual(harness.requests.map(request => new URL(request.url).pathname), ['/glass.css', '/immersive.css', '/lyrics.css', '/motion.css']);
    assert.deepEqual(harness.store[key], { enabled: false, theme: 'light' });
});

test('视觉开关与重注入共享GPU所有权，关闭时释放实例且不会由设置更新复活', async () => {
    const instances = [];
    const fluidRuntime = { create(settings) {
        const instance = { settings: plain(settings), disposed: false, updates: 0,
            setSettings(next) { assert.equal(this.disposed, false); this.settings = plain(next); this.updates++; },
            dispose() { assert.equal(this.disposed, false); this.disposed = true; },
            diagnostics() { return { disposed: this.disposed }; }
        };
        instances.push(instance);
        return instance;
    } };
    const harness = makeHarness({ stored: { enabled: false }, fluidRuntime });
    await settle();
    assert.equal(instances.length, 0);
    for (let index = 0; index < 20; index++) {
        harness.changed({ enabled: true });
        const current = instances.at(-1);
        harness.changed({ enabled: true, reduceMotion: true });
        assert.equal(instances.length, index + 1);
        assert.equal(current.updates, 1);
        harness.changed({ enabled: false });
        assert.equal(current.disposed, true);
        assert.equal(harness.context.__micoLiquidGlassRuntime.diagnostics, null);
    }
    harness.changed({ enabled: true });
    const previous = instances.at(-1);
    harness.run('content.js');
    await settle();
    assert.equal(previous.disposed, true);
    assert.equal(instances.filter(instance => !instance.disposed).length, 1);
    harness.context.__micoLiquidGlassRuntime.dispose();
    harness.changed({ enabled: true });
    assert.equal(instances.filter(instance => !instance.disposed).length, 0);
});

test('20 次启停撤回全部活动材质且不增长接收监听', async () => {
    const harness = makeHarness();
    await settle();
    const foreignStyle = { id: 'another-plugin-style' };
    harness.document.documentElement.appendChild(foreignStyle);
    for (let i = 0; i < 20; i++) {
        harness.changed({ enabled: false });
        assert.deepEqual(harness.children, [foreignStyle]);
        for (const name of ['data-mico-liquid-glass', 'data-mico-liquid-glass-theme', 'data-mico-liquid-glass-motion', 'data-mico-liquid-glass-blur']) assert.equal(harness.attrs.has(name), false);
        harness.changed({ enabled: true, theme: 'dark', reduceMotion: true, lowBlur: true });
        assert.equal(harness.children.length, 2);
        assert.equal(harness.attrs.get('data-mico-liquid-glass-theme'), 'dark');
        assert.equal(harness.attrs.get('data-mico-liquid-glass-motion'), 'reduced');
        assert.equal(harness.attrs.get('data-mico-liquid-glass-blur'), 'low');
        assert.equal(harness.document.count, 1);
        assert.equal(harness.window.count, 1);
        assert.equal(harness.storageListeners.size, 1);
    }
    assert.equal(harness.attrs.get('class'), 'host-theme-class');
});

test('完整 dispose 校验身份及 JSON 字符串，清理所有资源并写精确回执', async () => {
    const harness = makeHarness();
    await settle();
    for (const detail of ['not-json', { extensionId: 'other', action: 'dispose', token: 'ignored' }, { extensionId, action: 'resume', token: 'ignored' }, { extensionId, action: 'dispose', token: '' }]) harness.command(detail);
    harness.document.dispatch('mico-visual-lifecycle', { detail: { extensionId, action: 'dispose', token: 'object' } });
    assert.equal(harness.children.length, 1);
    harness.command({ extensionId, action: 'dispose', token: 'cleanup-20' });
    assert.deepEqual(JSON.parse(harness.attrs.get('data-mico-visual-ack')), { extensionId, token: 'cleanup-20', success: true });
    assert.equal(harness.children.length, 0);
    assert.equal(harness.attrs.has('data-mico-visual-ready'), false);
    assert.equal(harness.document.count + harness.window.count + harness.storageListeners.size, 0);
    assert.equal(harness.context.__micoLiquidGlassRuntime, undefined);
    harness.changed({ enabled: true });
    assert.equal(harness.children.length, 0);
    assert.equal(harness.requests[0].options.signal.aborted, true);
});

test('20 次重复注入都替换旧实例而非叠加样式或监听', async () => {
    const harness = makeHarness();
    await settle();
    for (let i = 0; i < 20; i++) {
        const oldRuntime = harness.context.__micoLiquidGlassRuntime;
        harness.run('settings.js');
        harness.run('content.js');
        await settle();
        assert.notEqual(harness.context.__micoLiquidGlassRuntime, oldRuntime);
        assert.equal(harness.children.length, 1);
        assert.equal(harness.document.count, 1);
        assert.equal(harness.window.count, 1);
        assert.equal(harness.storageListeners.size, 1);
    }
    harness.window.dispatch('pagehide');
    assert.equal(harness.children.length, 0);
    assert.equal(harness.document.count + harness.window.count + harness.storageListeners.size, 0);
});

test('资源或存储失败返回基础界面且报告错误', async () => {
    for (const options of [{ resourceFailure: true }, { resourceFailure: 'immersive.css' }, { resourceFailure: 'lyrics.css' }, { resourceFailure: 'motion.css' }, { storageFailure: 'storage unavailable' }]) {
        const harness = makeHarness(options);
        await settle();
        const ready = JSON.parse(harness.attrs.get('data-mico-visual-ready'));
        assert.equal(ready.extensionId, extensionId);
        assert.equal(ready.success, false);
        assert.ok(ready.error);
        assert.equal(harness.children.length, 0);
        assert.equal(harness.document.count + harness.window.count + harness.storageListeners.size, 0);
        assert.equal(harness.errors.length, 1);
    }
});

test('等待资源期间完成清理，迟到异步结果不会恢复样式', async () => {
    const harness = makeHarness({ delayStyle: true });
    harness.command({ extensionId, action: 'dispose', token: 'during-fetch' });
    harness.releaseStyle();
    await settle();
    assert.equal(harness.children.length, 0);
    assert.equal(harness.attrs.has('data-mico-visual-ready'), false);
    assert.equal(harness.context.__micoLiquidGlassRuntime, undefined);
});

test('资源尚未读完时的最新关闭设置不被初始读取覆盖', async () => {
    const harness = makeHarness({ stored: { enabled: true }, delayStyle: true });
    await settle();
    harness.changed({ enabled: false, theme: 'dark' });
    harness.releaseStyle();
    await settle();
    assert.equal(harness.children.length, 0);
    assert.equal(JSON.parse(harness.attrs.get('data-mico-visual-ready')).enabled, false);
});

test('设置弹窗保存规范配置并反映另一个设置窗口的变化', async () => {
    const harness = makeHarness({ stored: { enabled: false, theme: 'dark', lowBlur: true }, popup: true });
    await settle();
    const { controls } = harness;
    assert.equal(controls.enabled.checked, false);
    assert.equal(controls.theme.value, 'dark');
    assert.equal(controls.lowBlur.checked, true);
    assert.equal(controls.enabled.disabled, false);
    controls.enabled.checked = true;
    controls.theme.value = 'light';
    controls.reduceMotion.checked = true;
    controls['glass-settings'].dispatch('change');
    assert.deepEqual(harness.store[key], { version: 1, enabled: true, theme: 'light', reduceMotion: true, lowBlur: true });
    harness.changed({ enabled: false, theme: 'auto' });
    assert.equal(controls.enabled.checked, false);
    assert.equal(controls.theme.value, 'auto');
    harness.window.dispatch('pagehide');
    assert.equal(harness.storageListeners.size, 0);
});

test('正式清单仅动态注入脚本，包含重载桥页面与本地访问声明', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.plugin_id, 'mico-liquid-glass');
    assert.deepEqual(manifest.content_scripts[0].js, ['settings.js', 'fluid-palette.js', 'fluid-shaders.js', 'fluid-engine.js', 'content.js']);
    assert.equal(manifest.content_scripts[0].css, undefined);
    for (const name of manifest.content_scripts[0].js) assert.ok(fs.existsSync(new URL(name, pluginUrl)));
    assert.ok(read('host-bridge.html').includes('<body></body>'));
    assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'tabs']);
    assert.deepEqual(manifest.host_permissions, manifest.content_scripts[0].matches);
});
