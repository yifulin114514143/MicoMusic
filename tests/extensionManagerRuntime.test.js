import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electron from 'electron';

test('真实 Electron 插件管理器验证路径身份、ZIP 更新和重启恢复', { timeout: 60000 }, async t => {
    const runtimeRoot = fileURLToPath(new URL('../artifacts/phase3-runtime/', import.meta.url));
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const profile = fs.mkdtempSync(path.join(runtimeRoot, 'extension-electron-'));
    t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
    const env = { ...process.env, ELECTRON_IS_DEV: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [fileURLToPath(new URL('./extensionManager.electron.mjs', import.meta.url)), profile], {
        env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
    const timer = setTimeout(() => child.kill(), 55000);
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
    }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, output);
    const result = JSON.parse(fs.readFileSync(path.join(profile, 'result.json'), 'utf8'));
    assert.equal(result.success, true, output);
    assert.equal(result.checks.length, 9);
});
