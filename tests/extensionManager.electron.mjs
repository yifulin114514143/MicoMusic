import { app } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));
const profile = process.argv[2];
assert.ok(typeof profile === 'string' && path.dirname(profile) === path.resolve(runtimeRoot));
for (const directory of ['logs', 'temp']) fs.mkdirSync(path.join(profile, directory));
app.setName('MicoMusic 插件管理验证');
app.setPath('userData', profile);
app.setPath('logs', path.join(profile, 'logs'));
app.setPath('temp', path.join(profile, 'temp'));

const result = { success: false, checks: [], electron: process.versions.electron };
function check(name) { result.checks.push(name); }
function packageZip(directory, version, extraEntry = '') {
    const zip = new AdmZip();
    zip.addFile(directory + '/manifest.json', Buffer.from(JSON.stringify({ manifest_version: 3, name: '同名插件', version })));
    if (extraEntry) {
        // zipEntry.entryName 是 adm-zip 的公开 setter；用原始越界路径测试读取端验证。
        const entry = zip.addFile(directory + '/file.txt', Buffer.from('outside'));
        entry.entryName = extraEntry;
    }
    const zipPath = path.join(profile, 'temp', 'test-' + version + '.zip');
    zip.writeZip(zipPath);
    return zipPath;
}

app.whenReady().then(async () => {
try {
    const manager = (await import('../electron/extensions/extensionManager.js')).default;
    const root = manager.ensureExtensionsDirectory();
    function add(directory, manifest = {}) {
        const target = path.join(root, directory);
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: '同名插件', version: '1.0.0', ...manifest }));
        return target;
    }
    const first = add('first');
    const second = add('second');
    const installed = await manager.installExtension(first);
    assert.equal(installed.success, true, installed.message);
    let scanned = manager.scanExtensions();
    assert.equal(scanned.find(item => item.directory === 'first').installed, true);
    assert.equal(scanned.find(item => item.directory === 'second').installed, false);
    assert.equal(installed.extension.path, first);
    check('真实同名插件按 Extension.path 标记安装状态');

    for (const [id, directory] of [[installed.extension.id, ''], [installed.extension.id, '..'], [installed.extension.id, 'second']]) {
        assert.equal((await manager.uninstallExtension(id, directory)).success, false);
        assert.equal(fs.existsSync(first), true);
        assert.equal(fs.existsSync(second), true);
        assert.equal(manager.getLoadedExtensions().length, 1);
    }
    check('错误卸载输入保留真实会话与所有目录');

    const events = [];
    manager.setBeforeExtensionUnloadHook(async (extension, reason) => {
        assert.equal(extension.path, first);
        assert.equal(reason, 'uninstall');
        await Promise.resolve();
        events.push('cleanup');
    });
    manager.setAfterExtensionLoadHook(async extension => {
        assert.equal(extension.path, first);
        assert.equal(JSON.parse(fs.readFileSync(path.join(first, 'manifest.json'))).version, '2.0.0');
        assert.equal(manager.getLoadedExtensions().length, 1);
        events.push('inject');
    });
    const updated = await manager.installPluginFromZip(packageZip('first-main', '2.0.0'));
    assert.equal(updated.success, true, updated.message);
    assert.deepEqual(events, ['cleanup', 'inject']);
    assert.equal(fs.existsSync(second), true);
    assert.equal(manager.getLoadedExtensions().length, 1);
    check('合法 ZIP 更新等待清理后加载注入，保留其他插件');

    manager.setBeforeExtensionUnloadHook(async () => { throw new Error('cleanup rejected'); });
    manager.setAfterExtensionLoadHook(null);
    const failedUpdate = await manager.installPluginFromZip(packageZip('first-main', '3.0.0'));
    assert.equal(failedUpdate.success, false);
    assert.match(failedUpdate.message, /cleanup rejected/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(first, 'manifest.json'))).version, '2.0.0');
    assert.equal(manager.getLoadedExtensions().length, 1);
    check('ZIP 更新清理失败时停止并保留旧版本');

    let cleanupCalled = false;
    manager.setBeforeExtensionUnloadHook(async () => { cleanupCalled = true; });
    const malicious = await manager.installPluginFromZip(packageZip('first-main', '4.0.0', 'first-main/../outside.txt'));
    assert.equal(malicious.success, false);
    assert.equal(cleanupCalled, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(first, 'manifest.json'))).version, '2.0.0');
    assert.equal(fs.existsSync(path.join(root, 'outside.txt')), false);
    check('原始越界 ZIP 在卸载旧插件前被拒绝');

    manager.setBeforeExtensionUnloadHook(null);
    add('v2', { manifest_version: 2 });
    add('native-invalid', { moekoe_native_hosts: [] });
    await manager.unloadChromeExtensions();
    const startup = await manager.loadChromeExtensions();
    assert.equal(startup.success, false);
    assert.equal(startup.results.filter(item => item.success).length, 2);
    assert.match(startup.results.find(item => item.directory === 'v2').message, /Manifest V3/);
    assert.match(startup.results.find(item => item.directory === 'native-invalid').message, /moekoe:nativeHost/);
    assert.deepEqual(manager.getLastLoadResults(), startup.results);
    check('真实启动统一拒绝旧清单和无权限 Native Host 声明');

    await manager.unloadChromeExtensions();
    assert.equal((await manager.uninstallExtension('', 'v2')).success, true);
    assert.equal((await manager.uninstallExtension('', 'native-invalid')).success, true);
    const extensions = await import('../electron/extensions/extensions.js');
    const missingBuiltinPath = path.join(process.resourcesPath, 'visual-plugins', 'mico-liquid-glass');
    assert.equal(fs.existsSync(missingBuiltinPath), false, '此隔离运行器使用依赖目录中的 Electron，内置分发资源应缺失');
    const assertOrdinaryPluginsAndMissingBuiltin = status => {
        assert.equal(status.success, false);
        assert.equal(status.builtinResult.success, false);
        assert.ok(status.builtinResult.message.includes(missingBuiltinPath), status.builtinResult.message);
        assert.equal(status.results.length, 2);
        assert.equal(status.results.every(item => item.success), true);
        assert.equal(manager.getLoadedExtensions().length, 2);
    };
    const initialized = await extensions.initializeExtensions();
    assertOrdinaryPluginsAndMissingBuiltin(initialized);
    check('内置资源缺失如实报告，统一入口仍初始化普通插件与 IPC');

    for (let index = 0; index < 3; index++) {
        const restarted = await extensions.restartExtensions();
        assertOrdinaryPluginsAndMissingBuiltin(restarted);
        scanned = manager.scanExtensions();
        assert.equal(scanned.filter(item => item.installed).length, 2);
    }
    check('连续三次 restartExtensions 恢复插件且 IPC 不重复注册');

    const cleaned = await extensions.cleanupExtensions();
    assert.equal(cleaned.success, true, cleaned.error || cleaned.message);
    assert.equal(manager.getLoadedExtensions().length, 0);
    assert.equal(fs.existsSync(first), true);
    assert.equal(fs.existsSync(second), true);
    check('清理统一入口卸载会话，插件文件保留');
    result.success = true;
} catch (error) {
    result.error = error.stack || error.message;
    console.error(error);
} finally {
    fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(result.success ? 0 : 1);
}
});
