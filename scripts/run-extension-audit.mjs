import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = path.join(root, 'artifacts/phase2-runtime');
const evidence = path.join(root, 'docs/phase2/evidence');
fs.mkdirSync(runtimeRoot, { recursive: true });
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(runtimeRoot, 'run-'));
const executable = process.env.MICO_PHASE2_API_BINARY;
if (!executable || !fs.existsSync(executable)) {
    throw new Error('请以 MICO_PHASE2_API_BINARY 指定现有内置 API 二进制的准确路径');
}
for (const mode of ['capabilities', 'persistence']) {
    await new Promise((resolve, reject) => {
        const env = { ...process.env, ELECTRON_IS_DEV: '0' };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(electron, [path.join(root, 'scripts/audit-extension-capabilities.mjs'), profile, mode, executable], {
            cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']
        });
        let log = '';
        child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk); });
        child.stderr.on('data', chunk => { log += chunk; });
        const timer = setTimeout(() => { child.kill(); reject(new Error(`阶段二 ${mode} 验证超过 180 秒`)); }, 180000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', code => {
            clearTimeout(timer);
            fs.writeFileSync(path.join(evidence, `${mode}.log`), log);
            if (code === 0) {
                const result = JSON.parse(fs.readFileSync(path.join(evidence, `${mode}.json`)));
                if (result.failure) reject(new Error(result.failure.message));
                else resolve();
            } else reject(new Error(`${mode} 验证失败，退出码 ${code}；详见 docs/phase2/evidence/${mode}.log`));
        });
    });
}
const reports = ['capabilities', 'persistence'].map(mode => JSON.parse(fs.readFileSync(path.join(evidence, `${mode}.json`))));
if (reports.some(report => report.failure || report.checks.length === 0)) throw new Error('审计结果不完整，不能生成通过摘要');
const summary = {
    baseline: reports[0].baseline,
    electron: reports[0].electron,
    checks: reports.flatMap(report => report.checks),
    limitations: ['无真实账号验收', '验证样式并非正式液态玻璃设计', '性能样本只覆盖探针和当前机器'],
    reports: ['capabilities.json', 'persistence.json']
};
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`阶段二审计断言通过 ${summary.checks.length} 项，结果：${path.join(evidence, 'summary.json')}`);
