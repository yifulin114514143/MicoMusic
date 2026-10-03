import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_ID, APP_NAME, APP_PROTOCOL } from '../electron/services/identityConfig.js';

test('安装包、运行时和依赖锁文件使用同一独立身份', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
    const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
    assert.equal(pkg.build.appId, APP_ID);
    assert.equal(pkg.desktopName, APP_ID);
    assert.equal(pkg.productName, APP_NAME);
    assert.equal(pkg.build.productName, APP_NAME);
    assert.equal(pkg.name, lock.name);
    assert.equal(pkg.name, lock.packages[''].name);
    assert.notEqual(APP_ID, 'cn.MoeKoe.Music');
    assert.deepEqual(pkg.build.protocols.flatMap(item => item.schemes), [APP_PROTOCOL]);
    assert.deepEqual(pkg.build.publish, { provider: 'github', owner: 'yifulin114514143', repo: 'MicoMusic' });
    assert.equal(pkg.build.nsis.license, 'LICENSE');
});
