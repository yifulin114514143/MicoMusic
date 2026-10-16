import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { computed, ref, nextTick } from 'vue';
import { createPinia, defineStore } from 'pinia';
import { parseKrcLine } from '../src/components/player/parseKrcLine.js';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const quiet = { log() {}, warn() {}, error() {} };
function between(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, '测试只读取已核对的源码边界');
    return source.slice(from, to);
}

function windowHarness(settings) {
    const ready = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    class Window extends EventEmitter {
        constructor(options) {
            super(); this.options = options; this.shows = 0;
            this.webContents = new EventEmitter();
            this.webContents.insertCSS = () => {};
            this.webContents.send = () => {};
        }
        setMenuBarVisibility() {}
        loadFile() {}
        isDestroyed() { return Boolean(this.destroyed); }
        show() { this.shows++; }
    }
    const context = vm.createContext({
        BrowserWindow: Window, path, console: quiet,
        __dirname: fileURLToPath(new URL('../electron/', import.meta.url)),
        store: { get: key => key === 'settings' ? settings : undefined },
        screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 1000 } }) },
        isDev: false, process: { platform: 'darwin' },
        bindExternalLinkHandler() {}, attachVisualWindowVisibility() {},
        getIconPath: name => name,
        extensionManager: { getLoadedExtensions: () => [{ id: 'test-visual' }] },
        isBuiltinVisualPlugin: () => true,
        waitForVisualPluginReady: (...args) => { ready.push(args); return pending; },
        log: quiet, mainWindow: null
    });
    const source = between(read('electron/appServices.js'), 'export function createWindow() {', '\nlet lyricsWindow;');
    vm.runInContext(source.replace('export function', 'function') + '\nglobalThis.windowUnderTest = createWindow();', context);
    return { window: context.windowUnderTest, ready, release };
}

test('普通启动保留插件首屏等待，主题就绪后才显示 MicoMusic', async () => {
    const h = windowHarness({ startMinimized: 'off' });
    assert.equal(h.window.options.paintWhenInitiallyHidden, true);
    assert.equal(h.window.options.show, false);
    assert.equal(h.window.options.title, 'MicoMusic');
    h.window.emit('ready-to-show');
    assert.equal(h.ready.length, 1);
    assert.equal(h.window.shows, 0);
    h.release(); await new Promise(setImmediate);
    assert.equal(h.window.shows, 1);
});

test('最小化启动关闭隐藏绘制且不会自动弹出窗口', async () => {
    const h = windowHarness({ startMinimized: 'on' });
    assert.equal(h.window.options.paintWhenInitiallyHidden, false);
    assert.equal(h.window.options.show, false);
    assert.equal(h.window.shows, 0);
    h.window.emit('ready-to-show'); h.release();
    await new Promise(setImmediate);
    assert.equal(h.window.shows, 0);
});

test('主题等待期间窗口被关闭时不再显示已销毁窗口', async () => {
    const h = windowHarness({});
    h.window.emit('ready-to-show'); h.window.destroyed = true; h.release();
    await new Promise(setImmediate);
    assert.equal(h.window.shows, 0);
});

test('音乐库听歌分钟数跟随 Pinia 时长更新', () => {
    const store = defineStore('library-listen-test', () => ({ listenTime: ref(0) }))(createPinia());
    const source = read('src/views/Library.vue');
    const context = vm.createContext({ computed, useListenTimeStore: () => store });
    vm.runInContext(between(source, 'const listenTimeStore = useListenTimeStore();', '\nconst user = ref({});') + '\nglobalThis.minutes = listenTimeMins;', context);
    assert.equal(context.minutes.value, 0);
    store.listenTime = 7200;
    assert.equal(context.minutes.value, 120);
    store.listenTime = 10800;
    assert.equal(context.minutes.value, 180);
});

test('听歌上报区分开始、完整与中断，并使用服务端同步值', async () => {
    const requests = [];
    const context = vm.createContext({
        defineStore, computed, ref, Date, console: quiet,
        get: async url => { requests.push({ method: 'GET', url }); return { data: { d_sec: 120 } }; },
        post: async (url, body) => {
            requests.push({ method: 'POST', url, body: plain(body) });
            return body.event === 'start' ? { status: 1, errcode: 0 } : {
                status: 1, data: { playback_accepted: true, grade_synced: true, grade: { data: { d_sec: 125 } } }
            };
        }
    });
    const source = read('src/stores/listenTime.js')
        .replace("import { defineStore } from 'pinia';\n", '')
        .replace("import { computed, ref } from 'vue';\n", '')
        .replace("import { get, post } from '@/utils/request';\n", '')
        .replace('export const useListenTimeStore =', 'globalThis.useListenTimeStore =');
    vm.runInContext(source, context);
    const store = context.useListenTimeStore(createPinia());
    await new Promise(setImmediate);
    await store.reportCsccEvent('start', { mixsongid: 123 });
    let last = requests.at(-1);
    assert.ok(last.url.startsWith('/user/listen/report?timestamp='));
    assert.deepEqual(last.body, { event: 'start', mixsongid: 123 });
    for (const [type, state] of [['end', '完整播放'], ['switch', '中断播放']]) {
        await store.reportCsccEvent(type, { mixsongid: 123, duration: 5000, diff_sec: 5 });
        assert.equal(requests.at(-2).method, 'GET');
        assert.ok(requests.at(-2).url.startsWith('/user/grade/info?t='));
        assert.deepEqual(requests.at(-1).body, { event: 'end', mixsongid: 123, duration: 5000, state, d_sec: 120, diff_sec: 5 });
        assert.equal(store.listenTime, 125);
    }
});

test('歌词翻译缺省开启且显式关闭生效，保留真实 KRC 词时序', async () => {
    const language = Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: [['测试翻译']] }] })).toString('base64');
    const lyric = `[language:${language}]\n[1000,2000]<0,1000,0>Test`;
    for (const [settings, expected] of [[{}, '测试翻译'], [{ lyricsTranslation: 'on' }, '测试翻译'], [{ lyricsTranslation: 'off' }, undefined]]) {
        const context = vm.createContext({
            ref, nextTick, parseKrcLine, TextDecoder, Uint8Array, atob, console: quiet,
            localStorage: { getItem: () => JSON.stringify(settings) },
            document: { getElementById: () => null },
            get: async url => url.startsWith('/search/lyric?')
                ? { status: 200, candidates: [{ id: 'test-krc', accesskey: 'test-key' }] }
                : { status: 200, decodeContent: lyric }
        });
        const source = read('src/components/player/LyricsHandler.js')
            .replace("import { ref, nextTick } from 'vue';\n", '')
            .replace("import { get } from '../../utils/request';\n", '')
            .replace("import { parseKrcLine } from './parseKrcLine.js';\n", '')
            .replace('export default function useLyricsHandler', 'function useLyricsHandler');
        vm.runInContext(source + '\nglobalThis.handler = useLyricsHandler(text => text);', context);
        context.handler.showLyrics.value = true;
        assert.equal(await context.handler.getLyrics('test-song'), true);
        assert.equal(context.handler.lyricsData.value[0].translated, expected);
        assert.equal(context.handler.lyricsData.value[0].timingSource, 'word');
        assert.equal(context.handler.lyricsData.value[0].characters[0].startTime, 1000);
    }
});
