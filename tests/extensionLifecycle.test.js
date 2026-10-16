import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createExtensionLifecycle, getManagedExtensionPath, getExtensionPackagePath, pathsMatch
} from '../electron/extensions/extensionLifecycle.js';

const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));
const logger = { info() {}, error() {} };

function createFixture(t) {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(runtimeRoot, 'extension-boundary-'));
    const extensionsDirectory = path.join(root, 'extensions');
    fs.mkdirSync(extensionsDirectory);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let loaded = [];
    const events = [];
    const session = {
        getAllExtensions: () => loaded.slice(),
        async loadExtension(extensionPath) {
            events.push('load:' + path.basename(extensionPath));
            const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
            if (manifest.failLoad) throw new Error('fixture load failed');
            const extension = { id: path.basename(extensionPath) + '-id', path: extensionPath, name: manifest.name, manifest };
            loaded.push(extension);
            return extension;
        },
        removeExtension(id) {
            events.push('remove:' + id);
            loaded = loaded.filter(extension => extension.id !== id);
        }
    };
    const validateManifest = manifestPath => {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest.manifest_version !== 3) return { valid: false, error: 'Manifest V3 required' };
            if (manifest.invalidNativeHost) return { valid: false, error: 'Native Host declaration rejected' };
            return { valid: true, manifest };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    };
    const lifecycle = createExtensionLifecycle({ extensionsDirectory, getSession: () => session, validateManifest, logger });
    function addDirectory(directory, manifest = {}) {
        const extensionPath = path.join(extensionsDirectory, directory);
        fs.mkdirSync(extensionPath);
        fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'same name', version: '1.0.0', ...manifest }));
        return extensionPath;
    }
    return { root, extensionsDirectory, lifecycle, session, events, addDirectory };
}

test('空目录、根目录、越界目录与错误 ID 不会移除会话或目录', async t => {
    const fixture = createFixture(t);
    const first = fixture.addDirectory('first');
    const second = fixture.addDirectory('second');
    assert.equal((await fixture.lifecycle.loadChromeExtensions()).success, true);
    for (const directory of ['', ' ', '.', '..', '../first', fixture.extensionsDirectory, first, 'first/nested', 'first\\nested']) {
        const result = await fixture.lifecycle.uninstallExtension('first-id', directory);
        assert.equal(result.success, false, directory);
        assert.equal(fs.existsSync(first), true);
        assert.equal(fs.existsSync(second), true);
        assert.equal(fixture.session.getAllExtensions().length, 2);
    }
    assert.equal((await fixture.lifecycle.uninstallExtension('first-id', 'second')).success, false);
    assert.equal((await fixture.lifecycle.uninstallExtension('', 'first')).success, false);
    assert.equal((await fixture.lifecycle.uninstallExtension('unknown-id', 'first')).success, false);
    assert.equal(fixture.events.some(event => event.startsWith('remove:')), false);
});

test('按真实路径区分同名插件，合法卸载只删除该目录，并等待异步清理', async t => {
    const fixture = createFixture(t);
    const first = fixture.addDirectory('first');
    const second = fixture.addDirectory('second');
    await fixture.lifecycle.loadChromeExtensions();
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const cleanup = new Promise(resolve => { release = resolve; });
    fixture.lifecycle.setBeforeExtensionUnloadHook(async (extension, reason) => {
        assert.equal(extension.path, first);
        assert.equal(reason, 'uninstall');
        entered();
        await cleanup;
        fixture.events.push('cleaned:' + extension.id);
    });
    const pending = fixture.lifecycle.uninstallExtension('first-id', 'first');
    await started;
    assert.equal(fs.existsSync(first), true);
    assert.equal(fixture.session.getAllExtensions().length, 2);
    assert.equal(fixture.events.some(event => event.startsWith('remove:')), false);
    release();
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.removedFromSession, true);
    assert.equal(result.removedFiles, true);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), true);
    assert.deepEqual(fixture.session.getAllExtensions().map(extension => extension.id), ['second-id']);
    assert.ok(fixture.events.indexOf('cleaned:first-id') < fixture.events.indexOf('remove:first-id'));
    assert.equal(pathsMatch(first, second), false);
    assert.equal(pathsMatch(first, path.join(fixture.extensionsDirectory, 'First')), false);
    assert.equal(pathsMatch('', first), false);
});

test('未加载目录可以精确删除；符号链接和包含符号链接的目录被拒绝', async t => {
    const fixture = createFixture(t);
    const uninstalled = fixture.addDirectory('unloaded');
    assert.equal((await fixture.lifecycle.uninstallExtension('', 'unloaded')).success, true);
    assert.equal(fs.existsSync(uninstalled), false);
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    fs.symlinkSync(outside, path.join(fixture.extensionsDirectory, 'linked'));
    fs.symlinkSync(path.join(fixture.root, 'missing'), path.join(fixture.extensionsDirectory, 'broken'));
    const containing = fixture.addDirectory('containing');
    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(containing, 'linked-file'));
    for (const directory of ['linked', 'broken', 'containing']) {
        assert.equal((await fixture.lifecycle.uninstallExtension('', directory)).success, false);
    }
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(containing), true);
    const linkedRoot = path.join(fixture.root, 'linked-root');
    fs.symlinkSync(fixture.extensionsDirectory, linkedRoot);
    assert.throws(() => getManagedExtensionPath(linkedRoot, 'containing'), /符号链接/);
});

test('启动扫描统一验证清单，逐项返回拒绝和加载失败，重新加载保留真实失败状态', async t => {
    const fixture = createFixture(t);
    fixture.addDirectory('valid');
    fixture.addDirectory('v2', { manifest_version: 2 });
    fixture.addDirectory('native-invalid', { invalidNativeHost: true });
    fixture.addDirectory('load-failure', { failLoad: true });
    fs.mkdirSync(path.join(fixture.extensionsDirectory, 'missing-manifest'));
    const result = await fixture.lifecycle.loadChromeExtensions();
    assert.equal(result.success, false);
    assert.equal(result.results.length, 5);
    assert.equal(result.results.filter(item => item.success).length, 1);
    assert.match(result.results.find(item => item.directory === 'native-invalid').message, /Native Host/);
    assert.match(result.results.find(item => item.directory === 'load-failure').message, /fixture load failed/);
    assert.deepEqual(fixture.lifecycle.getLastLoadResults(), result.results);
    const snapshot = fixture.lifecycle.getLastLoadResults();
    snapshot[0].success = 'changed';
    assert.notEqual(fixture.lifecycle.getLastLoadResults()[0].success, 'changed');
    assert.deepEqual(fixture.session.getAllExtensions().map(extension => extension.id), ['valid-id']);
    const reloaded = await fixture.lifecycle.reloadExtensions();
    assert.equal(reloaded.success, false);
    assert.equal(reloaded.unloadResults.length, 1);
    assert.equal(reloaded.results.filter(item => item.success).length, 1);
});

test('清理失败保留插件会话与文件，并阻止 reload 重新加载', async t => {
    const fixture = createFixture(t);
    const extensionPath = fixture.addDirectory('first');
    await fixture.lifecycle.loadChromeExtensions();
    fixture.lifecycle.setBeforeExtensionUnloadHook(async () => { throw new Error('cleanup failed'); });
    const uninstalled = await fixture.lifecycle.uninstallExtension('first-id', 'first');
    assert.equal(uninstalled.success, false);
    assert.match(uninstalled.message, /cleanup failed/);
    assert.equal(fs.existsSync(extensionPath), true);
    assert.equal(fixture.session.getAllExtensions().length, 1);
    const reload = await fixture.lifecycle.reloadExtensions();
    assert.equal(reload.success, false);
    assert.deepEqual(reload.results, []);
    assert.equal(fixture.events.filter(event => event === 'load:first').length, 1);
    assert.equal(fixture.events.some(event => event.startsWith('remove:')), false);
});

test('加载后注入失败经过异步清理回退，返回失败且会话没有残留', async t => {
    const fixture = createFixture(t);
    fixture.addDirectory('first');
    fixture.lifecycle.setAfterExtensionLoadHook(async extension => {
        fixture.events.push('inject:' + extension.id);
        throw new Error('injection failed');
    });
    fixture.lifecycle.setBeforeExtensionUnloadHook(async (extension, reason) => {
        assert.equal(reason, 'unload');
        await Promise.resolve();
        fixture.events.push('cleanup:' + extension.id);
    });
    const result = await fixture.lifecycle.loadChromeExtensions();
    assert.equal(result.success, false);
    assert.match(result.results[0].message, /injection failed/);
    assert.deepEqual(fixture.session.getAllExtensions(), []);
    assert.deepEqual(fixture.events, ['load:first', 'inject:first-id', 'cleanup:first-id', 'remove:first-id']);
});

test('重载先清理卸载，再加载注入；返回状态全部通过', async t => {
    const fixture = createFixture(t);
    fixture.addDirectory('first');
    fixture.lifecycle.setBeforeExtensionUnloadHook(async extension => {
        await Promise.resolve();
        fixture.events.push('cleanup:' + extension.id);
    });
    fixture.lifecycle.setAfterExtensionLoadHook(async extension => {
        await Promise.resolve();
        fixture.events.push('inject:' + extension.id);
    });
    await fixture.lifecycle.loadChromeExtensions();
    fixture.events.length = 0;
    const reloaded = await fixture.lifecycle.reloadExtensions();
    assert.equal(reloaded.success, true);
    assert.deepEqual(fixture.events, ['cleanup:first-id', 'remove:first-id', 'load:first', 'inject:first-id']);
});

test('清理期间目标被替换为符号链接后停止删除', async t => {
    const fixture = createFixture(t);
    const extensionPath = fixture.addDirectory('first');
    const outside = path.join(fixture.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    await fixture.lifecycle.loadChromeExtensions();
    fixture.lifecycle.setBeforeExtensionUnloadHook(async () => {
        fs.rmSync(extensionPath, { recursive: true });
        fs.symlinkSync(outside, extensionPath);
    });
    const result = await fixture.lifecycle.uninstallExtension('first-id', 'first');
    assert.equal(result.success, false);
    assert.equal(fixture.session.getAllExtensions().length, 1);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('ZIP 写入路径拒绝根目录、绝对路径、父目录和反斜杠', () => {
    const extensionPath = path.join(runtimeRoot, 'package-root');
    assert.equal(getExtensionPackagePath(extensionPath, 'styles/material.css'), path.join(extensionPath, 'styles/material.css'));
    for (const relativePath of ['', '/', '..', '../outside', 'styles/../../outside', '/absolute', 'styles\\outside', './manifest.json']) {
        assert.throws(() => getExtensionPackagePath(extensionPath, relativePath), /插件包/);
    }
});
