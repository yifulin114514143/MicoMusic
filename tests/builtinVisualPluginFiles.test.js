import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createBuiltinVisualPluginFiles, BUILTIN_VISUAL_ID, BUILTIN_VISUAL_DIRECTORY
} from '../electron/extensions/builtinVisualPluginFiles.js';

const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));

function fixture(t) {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const root = fs.mkdtempSync(path.join(runtimeRoot, 'builtin-files-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourceDirectory = path.join(root, 'resources');
    const extensionsDirectory = path.join(root, 'extensions');
    const installedPath = path.join(extensionsDirectory, BUILTIN_VISUAL_DIRECTORY);
    fs.mkdirSync(sourceDirectory);
    const manifest = { manifest_version: 3, name: 'MicoMusic 液态玻璃', plugin_id: BUILTIN_VISUAL_ID, version: '1.0.0' };
    const writeManifest = overrides => fs.writeFileSync(path.join(sourceDirectory, 'manifest.json'), JSON.stringify({ ...manifest, ...overrides }));
    writeManifest();
    fs.mkdirSync(path.join(sourceDirectory, 'styles'));
    fs.writeFileSync(path.join(sourceDirectory, 'styles', 'material.css'), 'body { color: white; }');
    let state = {};
    let writes = 0;
    let failWrite = null;
    let failRead = null;
    const getState = () => {
        if (failRead) throw failRead;
        return state;
    };
    const setState = value => {
        writes++;
        state = { ...value };
        if (failWrite) {
            const error = failWrite;
            failWrite = null;
            throw error;
        }
    };
    const installer = createBuiltinVisualPluginFiles({ sourceDirectory, extensionsDirectory, getState, setState });
    return {
        root, sourceDirectory, extensionsDirectory, installedPath, installer, writeManifest,
        getState, setState, getWrites: () => writes,
        failNextWrite: () => { failWrite = new Error('metadata write failed'); },
        failNextRead: () => { failRead = new Error('metadata read failed'); },
        clearReadFailure: () => { failRead = null; }
    };
}

function assertNoTemporaryDirectories(f) {
    assert.deepEqual(fs.readdirSync(f.extensionsDirectory).filter(name => name.startsWith('.mico-visual-')), []);
    assert.deepEqual(fs.readdirSync(f.root).filter(name => name.startsWith('.mico-visual-')), []);
}

test('首次安装复制完整资源并持久化版本及 fingerprint', t => {
    const f = fixture(t);
    const result = f.installer.prepare();
    assert.equal(result.success, true, result.message);
    assert.equal(result.updated, true);
    assert.equal(result.path, f.installedPath);
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(f.installedPath, 'styles/material.css'), 'utf8'), 'body { color: white; }');
    assert.deepEqual(f.getState(), { removed: false, fingerprint: result.fingerprint, version: '1.0.0' });
    assertNoTemporaryDirectories(f);
});

test('内容相同时不替换目录或文件，不重复写已正确的元数据', t => {
    const f = fixture(t);
    const first = f.installer.prepare();
    const before = fs.statSync(path.join(f.installedPath, 'styles/material.css'));
    const writes = f.getWrites();
    const second = f.installer.prepare();
    const after = fs.statSync(path.join(f.installedPath, 'styles/material.css'));
    assert.equal(second.success, true);
    assert.equal(second.updated, false);
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(before.ino, after.ino);
    assert.equal(before.mtimeMs, after.mtimeMs);
    assert.equal(f.getWrites(), writes);
    assertNoTemporaryDirectories(f);
});

test('资源内容改变即使版本相同也更新，保持安装路径与其他目录', t => {
    const f = fixture(t);
    const first = f.installer.prepare();
    const other = path.join(f.extensionsDirectory, 'other-plugin');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'keep.txt'), 'other content');
    fs.writeFileSync(path.join(f.sourceDirectory, 'styles/material.css'), 'body { color: black; }');
    const updated = f.installer.prepare();
    assert.equal(updated.success, true, updated.message);
    assert.equal(updated.updated, true);
    assert.equal(updated.path, first.path);
    assert.notEqual(updated.fingerprint, first.fingerprint);
    assert.equal(updated.version, '1.0.0');
    assert.equal(fs.readFileSync(path.join(f.installedPath, 'styles/material.css'), 'utf8'), 'body { color: black; }');
    assert.equal(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8'), 'other content');
    assertNoTemporaryDirectories(f);
});

test('文件名与内容使用明确 hash 边界，不将不同资源拼接成同一身份', t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.sourceDirectory, 'a'), 'bc');
    const first = f.installer.prepare();
    fs.rmSync(path.join(f.sourceDirectory, 'a'));
    fs.writeFileSync(path.join(f.sourceDirectory, 'ab'), 'c');
    const updated = f.installer.prepare();
    assert.equal(updated.success, true);
    assert.equal(updated.updated, true);
    assert.notEqual(first.fingerprint, updated.fingerprint);
    assert.equal(fs.existsSync(path.join(f.installedPath, 'a')), false);
    assert.equal(fs.readFileSync(path.join(f.installedPath, 'ab'), 'utf8'), 'c');
});

test('卸载记录保留既有状态，缺少分发资源时仍跳过并保持卸载选择', t => {
    const f = fixture(t);
    const first = f.installer.prepare();
    f.setState({ ...f.getState(), extraPreference: 'keep' });
    f.installer.markUninstalled();
    assert.equal(f.getState().removed, true);
    assert.equal(f.getState().fingerprint, first.fingerprint);
    assert.equal(f.getState().extraPreference, 'keep');
    fs.rmSync(f.installedPath, { recursive: true });
    fs.rmSync(f.sourceDirectory, { recursive: true });
    const writes = f.getWrites();
    assert.deepEqual(f.installer.prepare(), { success: true, skipped: true, removed: true });
    assert.equal(fs.existsSync(f.installedPath), false);
    assert.equal(f.getWrites(), writes);
});

test('显式 restore 重装并清除 removed，保留既有其他状态字段', t => {
    const f = fixture(t);
    f.installer.prepare();
    f.setState({ ...f.getState(), extraPreference: 'keep' });
    f.installer.markUninstalled();
    fs.rmSync(f.installedPath, { recursive: true });
    f.writeManifest({ version: '2.0.0' });
    const result = f.installer.prepare({ restore: true });
    assert.equal(result.success, true, result.message);
    assert.equal(result.updated, true);
    assert.equal(f.getState().removed, false);
    assert.equal(f.getState().version, '2.0.0');
    assert.equal(f.getState().extraPreference, 'keep');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.installedPath, 'manifest.json'))).version, '2.0.0');
});

test('资源缺失、坏清单与错误身份返回真实失败，保留已安装旧版', async t => {
    for (const mode of ['missing', 'json', 'v2', 'identity', 'name', 'version']) {
        await t.test(mode, child => {
            const f = fixture(child);
            f.installer.prepare();
            const state = { ...f.getState() };
            if (mode === 'missing') fs.rmSync(f.sourceDirectory, { recursive: true });
            if (mode === 'json') fs.writeFileSync(path.join(f.sourceDirectory, 'manifest.json'), '{');
            if (mode === 'v2') f.writeManifest({ manifest_version: 2 });
            if (mode === 'identity') f.writeManifest({ plugin_id: 'different-plugin' });
            if (mode === 'name') f.writeManifest({ name: '' });
            if (mode === 'version') f.writeManifest({ version: '' });
            const result = f.installer.prepare();
            assert.equal(result.success, false);
            assert.ok(result.message);
            assert.deepEqual(f.getState(), state);
            assert.equal(JSON.parse(fs.readFileSync(path.join(f.installedPath, 'manifest.json'))).version, '1.0.0');
            assertNoTemporaryDirectories(f);
        });
    }
});

test('源目录、内部文件、安装目标的符号链接均拒绝，外部目录保留', async t => {
    for (const mode of ['source-root', 'source-file', 'target', 'target-child', 'extensions-root']) {
        await t.test(mode, child => {
            const f = fixture(child);
            const outside = path.join(f.root, 'outside');
            fs.mkdirSync(outside);
            fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
            if (mode === 'source-root') {
                fs.renameSync(f.sourceDirectory, path.join(f.root, 'actual-source'));
                fs.symlinkSync(path.join(f.root, 'actual-source'), f.sourceDirectory);
            } else if (mode === 'source-file') {
                fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(f.sourceDirectory, 'linked.txt'));
            } else if (mode === 'extensions-root') {
                fs.symlinkSync(outside, f.extensionsDirectory);
            } else {
                fs.mkdirSync(f.extensionsDirectory);
                if (mode === 'target') fs.symlinkSync(outside, f.installedPath);
                else {
                    fs.mkdirSync(f.installedPath);
                    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(f.installedPath, 'linked.txt'));
                }
            }
            const result = f.installer.prepare();
            assert.equal(result.success, false);
            assert.match(result.message, /符号链接/);
            assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
            assert.deepEqual(f.getState(), {});
        });
    }
});

test('无已有元数据时拒绝覆盖占用目录，即使其清单也是同一插件', t => {
    const f = fixture(t);
    fs.mkdirSync(f.extensionsDirectory);
    fs.cpSync(f.sourceDirectory, f.installedPath, { recursive: true });
    fs.writeFileSync(path.join(f.installedPath, 'user.txt'), 'preserve');
    const result = f.installer.prepare();
    assert.equal(result.success, false);
    assert.match(result.message, /已被其他安装占用/);
    assert.equal(fs.readFileSync(path.join(f.installedPath, 'user.txt'), 'utf8'), 'preserve');
    assert.deepEqual(f.getState(), {});
    assertNoTemporaryDirectories(f);
});

test('首次元数据保存失败时回滚新目录与已写入的状态', t => {
    const f = fixture(t);
    f.failNextWrite();
    const result = f.installer.prepare();
    assert.equal(result.success, false);
    assert.match(result.message, /metadata write failed/);
    assert.equal(fs.existsSync(f.installedPath), false);
    assert.deepEqual(f.getState(), {});
    assertNoTemporaryDirectories(f);
});

test('升级元数据保存失败时恢复旧目录、旧内容、旧版本和状态', t => {
    const f = fixture(t);
    f.installer.prepare();
    const previousState = { ...f.getState() };
    f.writeManifest({ version: '2.0.0' });
    fs.writeFileSync(path.join(f.sourceDirectory, 'styles/material.css'), 'updated');
    f.failNextWrite();
    const result = f.installer.prepare();
    assert.equal(result.success, false);
    assert.match(result.message, /metadata write failed/);
    assert.deepEqual(f.getState(), previousState);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.installedPath, 'manifest.json'))).version, '1.0.0');
    assert.equal(fs.readFileSync(path.join(f.installedPath, 'styles/material.css'), 'utf8'), 'body { color: white; }');
    assertNoTemporaryDirectories(f);
});

test('升级回滚无法恢复目录时保留完整旧版备份并返回准确位置', t => {
    const f = fixture(t);
    f.installer.prepare();
    f.writeManifest({ version: '2.0.0' });
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (path.basename(from).startsWith('.mico-visual-backup-')) throw new Error('rollback rename failed');
        return rename(from, to);
    });
    f.failNextWrite();
    const result = f.installer.prepare();
    assert.equal(result.success, false);
    assert.match(result.message, /旧版恢复失败/);
    const backups = fs.readdirSync(f.root).filter(name => name.startsWith('.mico-visual-backup-'));
    assert.equal(backups.length, 1);
    const backup = path.join(f.root, backups[0]);
    assert.deepEqual(fs.readdirSync(f.extensionsDirectory).filter(name => name.startsWith('.mico-visual-')), []);
    assert.ok(result.message.includes(backup));
    assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'))).version, '1.0.0');
    assert.equal(fs.readFileSync(path.join(backup, 'styles/material.css'), 'utf8'), 'body { color: white; }');
});

test('读取元数据失败返回结构化错误，不进行文件写入', t => {
    const f = fixture(t);
    f.failNextRead();
    const result = f.installer.prepare();
    assert.equal(result.success, false);
    assert.equal(result.message, 'metadata read failed');
    assert.equal(fs.existsSync(f.extensionsDirectory), false);
    assert.equal(f.getWrites(), 0);
    f.clearReadFailure();
    assert.deepEqual(f.getState(), {});
});
