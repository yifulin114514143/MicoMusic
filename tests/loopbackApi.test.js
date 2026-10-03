import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startLoopbackApi } from '../electron/services/loopbackApi.js';

const fixture = fileURLToPath(new URL('./fixtures/api-process.cjs', import.meta.url));
test('两个内置 API 使用不同端口且不接管已有服务，兼容分段启动日志', async () => {
    const occupied = net.createServer();
    occupied.listen(0, '127.0.0.1');
    await once(occupied, 'listening');
    const children = [];
    try {
        const results = await Promise.all([
            startLoopbackApi(process.execPath, [fixture]),
            startLoopbackApi(process.execPath, [fixture])
        ]);
        children.push(...results.map(result => result.child));
        assert.notEqual(results[0].baseUrl, results[1].baseUrl);
        for (const result of results) {
            assert.notEqual(new URL(result.baseUrl).port, String(occupied.address().port));
            assert.equal(await (await fetch(result.baseUrl)).text(), 'MicoMusic isolated API');
        }
        assert.equal(occupied.listening, true);
    } finally {
        await Promise.all(children.map(async child => { child.kill(); await once(child, 'close'); }));
        await new Promise(resolve => occupied.close(resolve));
    }
});

test('API 就绪前退出时明确报错，不永久等待', async () => {
    await assert.rejects(startLoopbackApi(process.execPath, [fixture, '--fail']), /API fixture startup failed/);
});
