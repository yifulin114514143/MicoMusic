import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));
const profile = process.argv[2];
assert.ok(typeof profile === 'string' && path.dirname(profile) === path.resolve(runtimeRoot));
for (const directory of ['logs', 'temp']) fs.mkdirSync(path.join(profile, directory));
app.setName('MicoMusic 本地程序停止验证');
app.setPath('userData', profile);
app.setPath('logs', path.join(profile, 'logs'));
app.setPath('temp', path.join(profile, 'temp'));

const executablePath = path.join(profile, 'delay-host.cjs');
fs.writeFileSync(executablePath, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const [exitPath, mode] = process.argv.slice(2);
let shutdowns = 0;
process.on('SIGTERM', () => {});
readline.createInterface({ input: process.stdin }).on('line', line => {
    const message = JSON.parse(line);
    if (message.type !== 'shutdown') return;
    shutdowns++;
    if (mode === 'delay' && shutdowns === 1) setTimeout(() => {
        fs.writeFileSync(exitPath, JSON.stringify({ shutdowns }));
        process.exit(0);
    }, 300);
});
setInterval(() => {}, 1000);
process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
`);
fs.chmodSync(executablePath, 0o755);
const report = { success: false, checks: [], electron: process.versions.electron };
const children = [];

app.whenReady().then(async () => {
    try {
        const manager = (await import('../electron/extensions/nativeHostManager.js')).default;
        async function start(id, mode = 'delay') {
            const exitPath = path.join(profile, id + '.json');
            const record = { extensionId: 'shutdown-test', pluginId: 'shutdown-test' };
            const host = { id, executablePath, args: [exitPath, mode] };
            const info = manager.startHost(record, host);
            assert.ok(info?.process);
            const child = info.process;
            children.push(child);
            let exited = false;
            child.once('exit', () => { exited = true; });
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('测试进程未就绪')), 5000);
                const ready = data => {
                    if (data.toString().includes('"type":"ready"')) {
                        clearTimeout(timer);
                        child.stdout.removeListener('data', ready);
                        resolve();
                    }
                };
                child.stdout.on('data', ready);
                child.once('error', error => { clearTimeout(timer); reject(error); });
            });
            return { child, exitPath, key: manager.getKey(record.extensionId, id), exited: () => exited };
        }

        const delayed = await start('concurrent');
        const first = manager.stopAll();
        const second = manager.stopAll();
        assert.equal(first, second);
        assert.equal(delayed.exited(), false);
        delayed.child.emit('error', new Error('fixture transport issue'));
        assert.equal(manager.processes.has(delayed.key), true);
        const confirmations = [];
        await Promise.all([first.then(() => {
            assert.equal(delayed.exited(), true);
            confirmations.push('first');
        }), second.then(() => {
            assert.equal(delayed.exited(), true);
            confirmations.push('second');
        })]);
        assert.deepEqual(confirmations, ['first', 'second']);
        assert.equal(delayed.child.exitCode, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(delayed.exitPath)), { shutdowns: 1 });
        assert.equal(manager.processes.size, 0);
        assert.equal(manager.stoppingProcesses.size, 0);
        report.checks.push('两个 stopAll 返回同一等待，两者都在实际 exit 后完成且只发送一次 shutdown');

        const previouslyStopping = await start('already-stopping');
        const stoppingHost = manager.stopHostByKey(previouslyStopping.key, true);
        const stoppingAll = manager.stopAll();
        assert.equal(manager.processes.has(previouslyStopping.key), true);
        assert.equal(manager.startHost({ extensionId: 'shutdown-test', pluginId: 'shutdown-test' }, {
            id: 'blocked', executablePath, args: [path.join(profile, 'blocked.json'), 'delay']
        }), null);
        await Promise.all([stoppingHost, stoppingAll]);
        assert.equal(previouslyStopping.exited(), true);
        assert.equal(previouslyStopping.child.exitCode, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(previouslyStopping.exitPath)), { shutdowns: 1 });
        assert.equal(manager.processes.size, 0);
        report.checks.push('stopAll 等待此前单插件停止，停止期间阻止新进程启动');

        const viaExtension = await start('via-extension');
        manager.extensions.set('shutdown-test', {
            extensionId: 'shutdown-test', pluginId: 'shutdown-test', extensionPath: profile,
            manifest: {
                moekoe_permissions: ['moekoe:nativeHost'],
                moekoe_native_hosts: [{ id: 'via-extension', platforms: { [process.platform]: { path: 'delay-host.cjs', args: [viaExtension.exitPath, 'delay'] } } }]
            }
        });
        const permissionKey = manager.getPermissionKey('shutdown-test', 'via-extension');
        manager.store.set(permissionKey, true);
        const stoppedExtension = manager.stopExtension('shutdown-test', true);
        assert.equal(manager.store.has(permissionKey), false);
        assert.equal(manager.processes.has(viaExtension.key), true);
        assert.equal(viaExtension.exited(), false);
        await Promise.all([stoppedExtension, manager.stopAll()]);
        assert.equal(viaExtension.exited(), true);
        assert.equal(viaExtension.child.exitCode, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(viaExtension.exitPath)), { shutdowns: 1 });
        manager.extensions.clear();
        report.checks.push('stopExtension 返回实际退出等待，授权删除保持原行为并与 stopAll 共用进程停止');

        const ignoresShutdown = await start('force-confirmation', 'ignore');
        assert.equal(ignoresShutdown.child.kill('SIGTERM'), true);
        assert.equal(ignoresShutdown.child.killed, true);
        assert.equal(ignoresShutdown.exited(), false);
        const forcedFirst = manager.stopAll();
        const forcedSecond = manager.stopAll();
        assert.equal(forcedFirst, forcedSecond);
        await Promise.all([forcedFirst, forcedSecond]);
        assert.equal(ignoresShutdown.exited(), true);
        assert.equal(ignoresShutdown.child.signalCode, 'SIGKILL');
        assert.equal(fs.existsSync(ignoresShutdown.exitPath), false);
        assert.equal(manager.processes.size, 0);
        assert.equal(manager.stoppingProcesses.size, 0);
        report.checks.push('已发送信号的 killed 状态不被当成退出，强杀等待实际 SIGKILL exit');
        report.success = true;
    } catch (error) {
        report.error = error.stack || error.message;
        console.error(error);
    } finally {
        for (const child of children) {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        fs.writeFileSync(path.join(profile, 'result.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
        app.exit(report.success ? 0 : 1);
    }
});
