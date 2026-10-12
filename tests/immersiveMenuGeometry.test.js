import test from 'node:test';
import assert from 'node:assert/strict';
import { immersiveMenuLayout, immersiveMenuMorph } from '../src/components/immersive/menuGeometry.js';

const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const viewport = { x: 0, y: 0, width: 1470, height: 847 };
const cover = { x: 173, y: 160, width: 388, height: 388 };
const lyrics = { x: 752, y: 0, width: 630, height: 847 };
const button = { x: 522, y: 588, width: 39, height: 39 };

test('实测横向间距不足时仅按缺口移动专辑，菜单避开封面与歌词', () => {
    const layout = immersiveMenuLayout({ viewport, cover, lyrics, button, contentHeight: 430 });
    assert.equal(layout.placement, 'corridor');
    assert.equal(layout.albumShift, -73);
    assert.equal(overlap(layout.rect, { ...cover, x: cover.x + layout.albumShift }), false);
    assert.equal(overlap(layout.rect, lyrics), false);
    assert.ok(layout.rect.y >= 24 && layout.rect.y + layout.rect.height <= 823);
});

test('宽窗已有足够空白时不移动专辑，也不缩小封面', () => {
    const layout = immersiveMenuLayout({ viewport: { ...viewport, width: 1952 }, cover: { x: 230, y: 230, width: 515, height: 515 }, lyrics: { x: 999, y: 0, width: 830, height: 1100 }, button: { x: 694, y: 792, width: 51, height: 51 }, contentHeight: 470 });
    assert.equal(layout.albumShift, 0);
    assert.equal(layout.placement, 'corridor');
    assert.equal(layout.rect.width, 230);
});

test('窄窗横向空间不足时明确腾出歌词区，保留封面', () => {
    const narrowCover = { x: 54, y: 140, width: 306, height: 306 };
    const layout = immersiveMenuLayout({ viewport: { ...viewport, width: 900 }, cover: narrowCover, lyrics: { x: 423, y: 0, width: 432, height: 847 }, button: { x: 329, y: 470, width: 31, height: 31 }, contentHeight: 430 });
    assert.equal(layout.placement, 'lyrics-space');
    assert.equal(layout.lyricsReserved, true);
    assert.equal(overlap(layout.rect, narrowCover), false);
    assert.equal(layout.albumShift, 0);
});

test('移动布局的菜单在紧凑封面下面的歌词空区内，超高内容使用滚动高度', () => {
    const layout = immersiveMenuLayout({ viewport: { x: 12, y: 16, width: 500, height: 700 }, cover: { x: 42, y: 86, width: 84, height: 84 }, lyrics: { x: 52, y: 233, width: 420, height: 427 }, button: { x: 446, y: 89, width: 31, height: 31 }, contentHeight: 940 });
    assert.equal(layout.placement, 'lyrics-space');
    assert.equal(overlap(layout.rect, { x: 42, y: 86, width: 84, height: 84 }), false);
    assert.ok(layout.rect.y >= 233);
    assert.ok(layout.rect.y + layout.rect.height <= 692);
    assert.ok(layout.rect.height < 940);
});

test('形变按按钮和菜单实际四角映射，不使用固定10%缩放', () => {
    const panel = { x: 500, y: 200, width: 240, height: 430 };
    assert.deepEqual(immersiveMenuMorph(button, panel), { transform: 'translate(22px, 388px) scale(0.1625, 0.09069767441860466)', borderRadius: '215px' });
});

test('无效矩形不产生猜测位置、无穷缩放或不可用菜单', () => {
    const args = { viewport, cover, lyrics, button, contentHeight: 430 };
    for (const invalid of [null, {}, { ...button, width: 0 }, { ...button, x: Infinity }]) {
        assert.equal(immersiveMenuLayout({ ...args, button: invalid }), null);
        assert.equal(immersiveMenuMorph(invalid, cover), null);
    }
});
