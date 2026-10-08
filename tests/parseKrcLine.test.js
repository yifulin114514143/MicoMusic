import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKrcLine } from '../src/components/player/parseKrcLine.js';

test('保留 KRC 真实词组相对时间并标记来源', () => {
    const line = parseKrcLine('[1000,3200]<0,400,0>First <550,1200,0>second');
    assert.equal(line.timingSource, 'word');
    assert.equal(line.startTime, 1000);
    assert.equal(line.endTime, 4200);
    assert.deepEqual(line.characters, [
        { char: 'First ', startTime: 1000, endTime: 1400, highlighted: false },
        { char: 'second', startTime: 1550, endTime: 2750, highlighted: false }
    ]);
});
test('行级回退保留旧字符结构但不冒充逐词来源', () => {
    const line = parseKrcLine('[12000,3000]abc');
    assert.equal(line.timingSource, 'line');
    assert.deepEqual(line.characters.map(char => [char.char, char.startTime, char.endTime]), [
        ['a', 12000, 13000], ['b', 13000, 14000], ['c', 14000, 15000]
    ]);
});
test('忽略元数据和空行，零长度组不产生无穷时间', () => {
    assert.equal(parseKrcLine('[ar:artist]'), null);
    assert.equal(parseKrcLine('[1000,400]   '), null);
    const line = parseKrcLine('[1000,0]<0,0,0>word');
    assert.equal(line.characters[0].endTime, 1000);
    assert.equal(line.timingSource, 'word');
});
