import test from 'node:test';
import assert from 'node:assert/strict';
import { heroTransform, heroTransformStyle } from '../src/components/immersive/heroGeometry.js';

test('Hero 将实际大封面的四个角映射到实际小封面，不推测固定布局', () => {
    const source = { x: 33, y: 705, width: 64, height: 60 };
    const destination = { x: 140, y: 168, width: 388, height: 388 };
    const transform = heroTransform(source, destination);
    assert.equal(destination.x + transform.x, source.x);
    assert.equal(destination.y + transform.y, source.y);
    assert.equal(destination.width * transform.scaleX, source.width);
    assert.equal(destination.height * transform.scaleY, source.height);
    assert.match(heroTransformStyle(transform), /^translate\(-107px, 537px\) scale\(/);
});

test('没有已测量封面或零面积时跳过 Morph，不产生无穷 scale', () => {
    const actual = { x: 1, y: 2, width: 64, height: 64 };
    for (const invalid of [null, {}, { ...actual, width: 0 }, { ...actual, x: Infinity }]) {
        assert.equal(heroTransform(invalid, actual), null);
        assert.equal(heroTransform(actual, invalid), null);
    }
    assert.equal(heroTransformStyle(null), 'none');
});
