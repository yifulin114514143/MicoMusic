import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLyricTimeline, resolveLyricPosition, getTokenProgress, getSeekTime,
    selectSecondaryText, getVirtualWindow, getLinePresentation, createFollowTimer
} from '../src/components/immersive/lyricsTimeline.js';
import { parseKrcLine } from '../src/components/player/parseKrcLine.js';

const lyric = (start, end, text, extra = {}) => ({
    startTime: start, endTime: end, timingSource: 'word',
    characters: [{ char: text, startTime: start, endTime: end, highlighted: true }], ...extra
});

test('真实毫秒时间控制逐组渐进填充，旧 highlighted 不影响结果', () => {
    const token = buildLyricTimeline([lyric(1000, 3000, 'You must')])[0].tokens[0];
    assert.equal(getTokenProgress(token, 0.5), 0);
    assert.equal(getTokenProgress(token, 1), 0);
    assert.equal(getTokenProgress(token, 2), 0.5);
    assert.equal(getTokenProgress(token, 3), 1);
    assert.equal(getTokenProgress(token, 10), 1);
});

test('合成或未知来源只允许行级展示，不将等分时间伪装成逐词来源', () => {
    const rows = buildLyricTimeline([
        lyric(0, 1000, '合成', { timingSource: 'line' }),
        lyric(1000, 2000, '未知', { timingSource: undefined }),
        lyric(2000, 3000, '真实')
    ]);
    assert.deepEqual(rows.map(row => row.hasWordTiming), [false, false, true]);
});

test('真实 parser 输出的主行时间与逐词来源直接用于舞台，不重新拆词造时间', () => {
    const parsed = parseKrcLine('[2000,3000]<200,800,0>You must <1500,500,0>be');
    const row = buildLyricTimeline([parsed])[0];
    assert.equal(row.hasWordTiming, true);
    assert.equal(row.tokens.length, 2);
    assert.equal(getSeekTime(row), 2);
    assert.equal(getTokenProgress(row.tokens[0], 2.6), 0.5);
    assert.equal(getTokenProgress(row.tokens[1], 2.6), 0);
    assert.equal(resolveLyricPosition([row], 4.9).phase, 'line');
    assert.equal(resolveLyricPosition([row], 5).phase, 'outro');
    const fallback = buildLyricTimeline([parseKrcLine('[6000,1000]没有词组来源')])[0];
    assert.equal(fallback.hasWordTiming, false);
});

test('前奏、有效行、间奏、尾奏采用半开区间并保留真实聚焦行', () => {
    const rows = buildLyricTimeline([lyric(2000, 4000, '第一句'), lyric(7000, 9000, '第二句')]);
    assert.deepEqual(resolveLyricPosition(rows, 0), { phase: 'prelude', activeIndex: -1, focusIndex: 0, nextIndex: 0 });
    assert.equal(resolveLyricPosition(rows, 2).activeIndex, 0);
    assert.deepEqual(resolveLyricPosition(rows, 4), { phase: 'interlude', activeIndex: -1, focusIndex: 0, nextIndex: 1 });
    assert.equal(resolveLyricPosition(rows, 7).activeIndex, 1);
    assert.deepEqual(resolveLyricPosition(rows, 9), { phase: 'outro', activeIndex: -1, focusIndex: 1, nextIndex: -1 });
});

test('倒退 seek 和新歌曲从时间直接求解，不沿用旧行或高亮状态', () => {
    const rows = buildLyricTimeline([lyric(0, 2000, '旧一'), lyric(2000, 4000, '旧二')]);
    assert.equal(resolveLyricPosition(rows, 3).activeIndex, 1);
    assert.equal(resolveLyricPosition(rows, 0.2).activeIndex, 0);
    assert.equal(getTokenProgress(rows[1].tokens[0], 0.2), 0);
    const changed = buildLyricTimeline([lyric(5000, 6000, '新歌曲')]);
    assert.equal(resolveLyricPosition(changed, 0).phase, 'prelude');
});

test('重叠行取最近开始的有效行，不依赖数组顺序推断时间', () => {
    const rows = buildLyricTimeline([lyric(3000, 6000, '后开始'), lyric(1000, 5000, '先开始')]);
    assert.equal(resolveLyricPosition(rows, 4).activeIndex, 0);
    assert.equal(resolveLyricPosition(rows, 2).activeIndex, 1);
});

test('有时间的空行表示间奏；无词与无时间词分别明确为空/不可同步', () => {
    assert.equal(resolveLyricPosition(buildLyricTimeline([]), 0).phase, 'empty');
    const blank = buildLyricTimeline([{ startTime: 0, endTime: 3000, timingSource: 'line', characters: [] }, lyric(3000, 4000, '开始')]);
    assert.equal(resolveLyricPosition(blank, 1).phase, 'interlude');
    assert.equal(resolveLyricPosition(blank, 1).activeIndex, -1);
    const untimed = buildLyricTimeline([{ characters: [{ char: '无时间词' }] }]);
    assert.equal(resolveLyricPosition(untimed, 99).phase, 'untimed');
    assert.equal(getSeekTime(untimed[0]), null);
});

test('缺失主时间时可使用实际 token 范围，但异常时间不能产生假进度', () => {
    const rows = buildLyricTimeline([
        { timingSource: 'word', characters: [{ char: '真实组', startTime: 1200, endTime: 2400 }] },
        { timingSource: 'word', characters: [{ char: '坏组', startTime: 3000, endTime: 1000 }] },
        { timingSource: 'word', characters: [{ char: '字符串时间', startTime: '500', endTime: '600' }] }
    ]);
    assert.equal(rows[0].startMs, 1200);
    assert.equal(rows[0].hasWordTiming, true);
    assert.equal(rows[1].hasWordTiming, false);
    assert.equal(rows[2].hasWordTiming, false);
    assert.equal(getTokenProgress(rows[1].tokens[0], 4), 0);
    assert.equal(getTokenProgress({ startMs: 1000, endMs: 1000, timed: true }, 1), 1);
});

test('点击跳转使用真实行起点秒值，空行或无时间行不触发 seek', () => {
    const rows = buildLyricTimeline([lyric(1250, 3000, '可跳转'), { startTime: 4000, endTime: 5000, characters: [] }]);
    assert.equal(getSeekTime(rows[0]), 1.25);
    assert.equal(getSeekTime(rows[1]), null);
});

test('翻译/音译只使用精确字段，关闭副文本时两者均隐藏', () => {
    const row = buildLyricTimeline([lyric(0, 1000, '原文', { translated: '译文', romanized: 'on yomi' })])[0];
    assert.equal(selectSecondaryText(row, 'translation', true), '译文');
    assert.equal(selectSecondaryText(row, 'romanization', true), 'on yomi');
    assert.equal(selectSecondaryText(row, 'translation', false), '');
    assert.equal(selectSecondaryText(row, 'romanization', false), '');
    assert.equal(selectSecondaryText({ translated: '' }, 'romanization', true), '');
});

test('窗口化限制 DOM 数量但末端、向上与向下浏览均可到达', () => {
    const heights = Array.from({ length: 1000 }, () => 100);
    const first = getVirtualWindow(heights, 0, 600, 3);
    assert.equal(first.start, 0);
    assert.ok(first.end - first.start <= 13);
    const middle = getVirtualWindow(heights, 50000, 600, 3);
    assert.ok(middle.start <= 500 && middle.end > 505);
    assert.equal(middle.top + middle.renderedHeight + middle.bottom, 100000);
    const last = getVirtualWindow(heights, 99900, 600, 3);
    assert.equal(last.end, 1000);
    assert.ok(last.start >= 995);
    assert.equal(getVirtualWindow(heights, 0, 600, 3).start, 0);
});

test('可见近行才使用模糊，远离窗口的行不创建巨大滤镜开销', () => {
    assert.equal(getLinePresentation(5, 5).blurPx, 0);
    assert.ok(getLinePresentation(6, 5).blurPx < getLinePresentation(8, 5).blurPx);
    assert.equal(getLinePresentation(900, 5).blurPx, 0);
    assert.ok(getLinePresentation(8, 5).delayMs > 0);
    assert.equal(getLinePresentation(8, 5, true).delayMs, 0);
});

test('输入不被归一化过程改写，空白、字符组与字幕文本原样保留', () => {
    const original = lyric(0, 1000, ' You  must ', { translated: ' 翻译 ' });
    const snapshot = structuredClone(original);
    const row = buildLyricTimeline([original])[0];
    assert.equal(row.text, ' You  must ');
    assert.equal(row.translated, ' 翻译 ');
    assert.deepEqual(original, snapshot);
});

test('用户浏览恢复定时器始终只有一份，取消和销毁后异步回调不会恢复', () => {
    const pending = new Map(); let id = 0; let resumed = 0;
    const timer = createFollowTimer(() => resumed++, {
        setTimer(callback) { pending.set(++id, callback); return id; },
        clearTimer(key) { pending.delete(key); }, delay: 4500
    });
    timer.arm(); timer.arm(); assert.equal(pending.size, 1);
    const callback = [...pending.values()][0];
    timer.cancel(); assert.equal(pending.size, 0);
    callback(); assert.equal(resumed, 0);
    timer.arm(); const disposedCallback = [...pending.values()][0];
    timer.dispose(); assert.equal(pending.size, 0);
    disposedCallback(); timer.arm(); assert.equal(resumed, 0); assert.equal(pending.size, 0);
});
