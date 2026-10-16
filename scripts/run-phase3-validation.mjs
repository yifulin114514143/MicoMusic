import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'artifacts/phase3-runtime');
const evidence = path.join(root, 'docs/phase3/evidence');
fs.mkdirSync(runtime, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtime, 'validation-'));
const apiBinary = process.env.MICO_PHASE3_API_BINARY;
if (!apiBinary || !fs.statSync(apiBinary, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('请用 MICO_PHASE3_API_BINARY 指定现有内置 API 二进制的准确路径');
}
if (process.platform !== 'darwin') throw new Error('当前阶段三原生验证运行器只实现 macOS；其他平台仍需单独验收');

// 复制已有运行时，再放入正式内置资源；不修改 node_modules 内的原始 Electron.app。
const originalBundle = path.resolve(path.dirname(electron), '../..');
if (path.basename(originalBundle) !== 'Electron.app') throw new Error('当前 Electron 可执行文件不在预期的 macOS bundle 结构中');
const copiedBundle = path.join(runtime, 'validation-runtime/Electron.app');
fs.mkdirSync(path.dirname(copiedBundle), { recursive: true });
if (!fs.existsSync(copiedBundle)) fs.cpSync(originalBundle, copiedBundle, { recursive: true, verbatimSymlinks: true });
const resourceRoot = path.join(copiedBundle, 'Contents/Resources/visual-plugins');
const copiedPlugin = path.join(resourceRoot, 'mico-liquid-glass');
fs.mkdirSync(resourceRoot, { recursive: true });
if (fs.existsSync(copiedPlugin)) fs.rmSync(copiedPlugin, { recursive: true });
fs.cpSync(path.join(root, 'plugins/extensions/mico-liquid-glass'), copiedPlugin, { recursive: true });
const executable = path.join(copiedBundle, 'Contents/MacOS/Electron');

const modes = ['capabilities', 'persistence', 'uninstall-persistence', 'restored', 'startup-resource-failure', 'startup-manifest-failure', 'startup-timeout'];
for (const mode of modes) {
    const modeProfile = mode.startsWith('startup-') ? fs.mkdtempSync(path.join(runtime, mode + '-')) : profile;
    if (mode.startsWith('startup-')) {
        fs.rmSync(copiedPlugin, { recursive: true });
        fs.cpSync(path.join(root, 'plugins/extensions/mico-liquid-glass'), copiedPlugin, { recursive: true });
        if (mode === 'startup-resource-failure') fs.unlinkSync(path.join(copiedPlugin, 'glass.css'));
        if (mode === 'startup-manifest-failure') fs.writeFileSync(path.join(copiedPlugin, 'manifest.json'), '{"manifest_version":3,');
    }
    await new Promise((resolve, reject) => {
        const env = { ...process.env, ELECTRON_IS_DEV: '0' };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(executable, [path.join(root, 'scripts/validate-phase3.mjs'), modeProfile, mode, apiBinary], {
            cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']
        });
        let log = '';
        child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk); });
        child.stderr.on('data', chunk => { log += chunk; });
        const timer = setTimeout(() => {
            child.kill(); reject(new Error(`阶段三 ${mode} 验证超过 180 秒`));
        }, 180000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', code => {
            clearTimeout(timer);
            fs.writeFileSync(path.join(evidence, `${mode}.log`), log);
            if (code !== 0) { reject(new Error(`${mode} 验证失败，退出码 ${code}；详见 docs/phase3/evidence/${mode}.json`)); return; }
            const result = JSON.parse(fs.readFileSync(path.join(evidence, `${mode}.json`), 'utf8'));
            if (result.failure) reject(new Error(result.failure.message)); else resolve();
        });
    });
}
const reports = modes.map(mode =>
    JSON.parse(fs.readFileSync(path.join(evidence, `${mode}.json`), 'utf8')));
if (reports.some(report => report.failure || !report.checks.length)) throw new Error('阶段三验证结果不完整');
const summary = {
    baseline: reports[0].baseline, electron: reports[0].electron, chromium: reports[0].chromium,
    timestamp: new Date().toISOString(), sourceState: reports[0].sourceState,
    sourceFingerprintConsistent: reports.every(report => report.sourceState.sourceFingerprintSha256 === reports[0].sourceState.sourceFingerprintSha256),
    rendererFingerprintConsistent: reports.every(report => report.sourceState.rendererFingerprintSha256 === reports[0].sourceState.rendererFingerprintSha256),
    checks: reports.flatMap(report => report.checks),
    limitations: ['使用真实生产 Vue、插件管理器及内置 API 的隔离宿主，不是完整播放器主进程',
        '连续性使用自生成 PCM 技术音频，不代替真实酷狗账号与歌曲播放验收',
        '视觉与性能结果仅覆盖当前 macOS Apple Silicon 设备'],
    reports: reports.map(report => `${report.mode}.json`)
};
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (!summary.sourceFingerprintConsistent) throw new Error('运行期间源码指纹发生变化，不能将混合源码的结果作为最终验收；请在源码稳定后重新运行');
if (!summary.rendererFingerprintConsistent) throw new Error('运行期间生产页面构建指纹发生变化，请在构建稳定后重新运行');
console.log(`阶段三原生验证通过 ${summary.checks.length} 项，结果：${path.join(evidence, 'summary.json')}`);
