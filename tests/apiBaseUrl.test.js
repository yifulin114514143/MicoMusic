import test from 'node:test';
import assert from 'node:assert/strict';

test('桌面版使用独立运行端口，用户自定义地址仍优先，错误设置回退到本地服务', async () => {
    globalThis.window = { electron: { apiBaseUrl: 'http://127.0.0.1:49152' } };
    let settings = '{}';
    globalThis.localStorage = { getItem: () => settings };
    const { getApiBaseUrl, DEFAULT_API_BASE_URL } = await import('../src/utils/apiBaseUrl.js');
    assert.equal(DEFAULT_API_BASE_URL, window.electron.apiBaseUrl);
    assert.equal(getApiBaseUrl(), window.electron.apiBaseUrl);
    settings = JSON.stringify({ apiBaseUrl: 'https://example.com/api/' });
    assert.equal(getApiBaseUrl(), 'https://example.com/api');
    settings = JSON.stringify({ apiBaseUrl: 'file:///tmp/api' });
    assert.equal(getApiBaseUrl(), window.electron.apiBaseUrl);
    settings = 'invalid JSON';
    assert.equal(getApiBaseUrl(), window.electron.apiBaseUrl);
});
