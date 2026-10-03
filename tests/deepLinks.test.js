import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepLink, createDeepLinkQueue } from '../electron/services/deepLinks.js';

test('接收歌曲、歌单和组队参数，保留原 IPC 字段', () => {
    assert.deepEqual(parseDeepLink('micomusic://share?hash=ABC123'), {
        hash: 'ABC123', listid: '', teamcode: '', urlPath: 'share'
    });
    assert.equal(parseDeepLink('micomusic://share?listid=123').listid, '123');
    assert.deepEqual(parseDeepLink('micomusic://team/join?code=456'), {
        hash: '', listid: '', teamcode: '456', urlPath: 'join'
    });
});

test('拒绝原版协议、网页、畸形链接和没有操作参数的链接', () => {
    for (const input of ['moekoe://share?hash=ABC', 'https://example.com/?hash=ABC',
        'micomusic://share', 'micomusic://team/join', 'micomusic://unknown?hash=ABC',
        'micomusic://[', '--flag', null]) assert.equal(parseDeepLink(input), null);
});

test('冷启动和页面重载排队，页面就绪后只发送一次，热启动立即投递', () => {
    const received = [];
    const queue = createDeepLinkQueue(params => received.push(params));
    queue.receive('micomusic://share?hash=FIRST');
    assert.equal(received.length, 0);
    queue.setReady(true);
    queue.setReady(true);
    assert.equal(received.length, 1);
    queue.receive('micomusic://share?listid=SECOND');
    assert.equal(received.length, 2);
    queue.setReady(false);
    queue.receive('micomusic://team/join?code=THIRD');
    assert.equal(received.length, 2);
    queue.setReady(true);
    assert.equal(received.length, 3);
    assert.equal(queue.receive('moekoe://share?hash=OTHER'), false);
    assert.equal(queue.receive('micomusic://open'), true);
    assert.equal(received.length, 3);
});
