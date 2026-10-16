import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';

test('真实延迟子进程验证并发停止共享等待及 SIGKILL 退出确认', { timeout: 30000 }, async t => {
    const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const profile = fs.mkdtempSync(path.join(runtimeRoot, 'native-shutdown-'));
    t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
    const env = { ...process.env, ELECTRON_IS_DEV: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [fileURLToPath(new URL('./nativeHostShutdown.electron.mjs', import.meta.url)), profile], {
        env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
    }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, output);
    const report = JSON.parse(fs.readFileSync(path.join(profile, 'result.json'), 'utf8'));
    assert.equal(report.success, true, output);
    assert.equal(report.checks.length, 4);
});
