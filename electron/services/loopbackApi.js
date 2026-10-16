import net from 'node:net';
import { spawn } from 'node:child_process';

export function allocateLoopbackPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

export async function startLoopbackApi(executable, args, { cwd, onOutput = () => {}, timeoutMs = 30000 } = {}) {
    // 端口由系统分配。关闭临时监听到子进程接管之间如有竞争，重新分配再启动。
    for (let attempt = 0; attempt < 3; attempt++) {
        const port = await allocateLoopbackPort();
        try {
            return await new Promise((resolve, reject) => {
                const child = spawn(executable, [...args, `--port=${port}`], {
                    cwd, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1' }
                });
                let stdout = '';
                let stderr = '';
                let settled = false;
                const timer = setTimeout(() => fail(new Error('内置 API 启动超时')), timeoutMs);
                function fail(error) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    child.kill();
                    reject(error);
                }
                child.stdout.on('data', data => {
                    onOutput(data.toString(), false);
                    stdout += data.toString();
                    if (!settled && stdout.includes(`server running @ http://127.0.0.1:${port}`)) {
                        settled = true;
                        clearTimeout(timer);
                        resolve({ child, baseUrl: `http://127.0.0.1:${port}` });
                    }
                });
                child.stderr.on('data', data => {
                    stderr += data.toString();
                    onOutput(data.toString(), true);
                    if (stderr.includes('EADDRINUSE')) fail(new Error(stderr));
                });
                child.once('error', fail);
                child.once('close', code => fail(new Error(stderr || `内置 API 在就绪前退出，退出码 ${code}`)));
            });
        } catch (error) {
            if (!error.message.includes('EADDRINUSE') || attempt === 2) throw error;
        }
    }
}
