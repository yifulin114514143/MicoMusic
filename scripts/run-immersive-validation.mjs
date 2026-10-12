import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'artifacts/immersive-runtime');
const evidence = path.join(root, 'docs/immersive/evidence/2026-10-12-sync-pointer-regression');
fs.mkdirSync(runtime, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
if (process.platform !== 'darwin') throw new Error('本运行器仅覆盖当前 macOS 原生 Electron；其他平台需另行验收');
const originalBundle = path.resolve(path.dirname(electron), '../..');
if (path.basename(originalBundle) !== 'Electron.app') throw new Error('Electron 可执行文件未处于已验证的 macOS bundle 结构');
const copiedBundle = path.join(runtime, 'validation-runtime/Electron.app');
fs.mkdirSync(path.dirname(copiedBundle), { recursive: true });
if (!fs.existsSync(copiedBundle)) fs.cpSync(originalBundle, copiedBundle, { recursive: true, verbatimSymlinks: true });
const copiedPlugin = path.join(copiedBundle, 'Contents/Resources/visual-plugins/mico-liquid-glass');
fs.mkdirSync(path.dirname(copiedPlugin), { recursive: true });
if (fs.existsSync(copiedPlugin)) fs.rmSync(copiedPlugin, { recursive: true });
fs.cpSync(path.join(root, 'plugins/extensions/mico-liquid-glass'), copiedPlugin, { recursive: true });
const executable = path.join(copiedBundle, 'Contents/MacOS/Electron');
const env = { ...process.env, ELECTRON_IS_DEV: '0' };
delete env.ELECTRON_RUN_AS_NODE;
for (const mode of ['default', 'unthrottled']) {
const profile = fs.mkdtempSync(path.join(runtime, mode === 'default' ? 'validation-' : 'validation-unthrottled-'));
const reportName = mode === 'default' ? 'validation' : 'validation-unthrottled';
await new Promise((resolve, reject) => {
    const child = spawn(executable, [path.join(root, 'scripts/validate-immersive.mjs'), profile, mode], {
        cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { log += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('WebGL 沉浸隔离验收超过 300 秒，已停止本次进程')); }, 300000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
        clearTimeout(timer);
        fs.writeFileSync(path.join(runtime, reportName + '.log'), log);
        if (code !== 0) {
            const failedAttempt = path.join(evidence, 'failed-attempts', new Date().toISOString().replace(/[:.]/g, '-') + '-' + mode);
            fs.mkdirSync(failedAttempt, { recursive: true });
            fs.writeFileSync(path.join(failedAttempt, reportName + '.log'), log);
            for (const filename of fs.readdirSync(evidence).filter(name=>fs.statSync(path.join(evidence,name)).isFile()&&/\.(json|png|mp4)$/.test(name))) {
                const source = path.join(evidence, filename);
                if (fs.existsSync(source)) fs.copyFileSync(source, path.join(failedAttempt, filename));
            }
            reject(new Error(`隔离验收 ${mode} 失败，退出码 ${code}；本次失败证据已保留于 ${failedAttempt}`)); return;
        }
        const result = JSON.parse(fs.readFileSync(path.join(evidence, reportName + '.json'), 'utf8'));
        if (result.failure) reject(new Error(result.failure.message)); else resolve();
    });
});
console.log(`沉浸播放器 ${mode} 隔离验收通过，报告：${path.join(evidence, reportName + '.json')}`);
}
