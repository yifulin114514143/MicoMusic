import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLyricTimeline, buildLyricStageRows, getLyricStageFocus, LYRIC_GAP_MIN_MS, resolveLyricPosition, getTokenProgress, getSeekTime,
    selectSecondaryText, getVirtualWindow, getLinePresentation, createFollowTimer,
    LYRIC_SPRING, LYRIC_SPRING_LIMITS, stepLyricSpring, isLyricSpringSettled,
    retargetLineSpring, stepLineSpring, createLyricSpring, hasWordMotion, hasLyricClockWork, getTokenPresentation, createLyricWordClock
} from '../src/components/immersive/lyricsTimeline.js';
import { parseKrcLine } from '../src/components/player/parseKrcLine.js';

const lyric = (start, end, text, extra = {}) => ({
    startTime: start, endTime: end, timingSource: 'word',
    characters: [{ char: text, startTime: start, endTime: end, highlighted: true }], ...extra
});

test('280/28/1 精确物理解满足时间分段连续性、衰减与轻微过冲', () => {
    assert.deepEqual(LYRIC_SPRING, { stiffness: 280, damping: 28, mass: 1 });
    const start = { position: 0, velocity: 0 };
    const whole = stepLyricSpring(start, 500, 0.2);
    const partitioned = stepLyricSpring(stepLyricSpring(start, 500, 0.08), 500, 0.12);
    assert.ok(Math.abs(whole.position - partitioned.position) < 1e-10);
    assert.ok(Math.abs(whole.velocity - partitioned.velocity) < 1e-9);
    assert.ok(whole.position > 0 && whole.position < 500);
    const overshoot = stepLyricSpring(start, 500, Math.PI / Math.sqrt(84));
    assert.ok(overshoot.position > 500 && overshoot.position < 505);
    assert.ok(isLyricSpringSettled(stepLyricSpring(start, 500, 1.2), 500));
    assert.deepEqual(stepLyricSpring(start, 500, 0), start);
    assert.deepEqual(stepLyricSpring(start, Number.NaN, 0.1), start);
    assert.ok(Number.isFinite(stepLyricSpring(start, 500, 1000).position));
});

test('附近行使用不同延迟独立惯性，同一帧可跨过延迟边界且不丢运动时间', () => {
    const initial = { position: 0, velocity: 0, target: 0, pendingTarget: 0, delaySeconds: 0 };
    const active = retargetLineSpring(initial, 200, getLinePresentation(4, 4).delayMs / 1000);
    const neighbor = retargetLineSpring(initial, 200, getLinePresentation(6, 4).delayMs / 1000);
    assert.equal(stepLineSpring(neighbor, 0.02).position, 0);
    assert.ok(stepLineSpring(active, 0.02).position > 0);
    const split = stepLineSpring(stepLineSpring(neighbor, 0.02), 0.06);
    const whole = stepLineSpring(neighbor, 0.08);
    assert.ok(Math.abs(split.position - whole.position) < 1e-10);
    assert.ok(Math.abs(split.velocity - whole.velocity) < 1e-9);
    const retargeted = retargetLineSpring(whole, 400, 0.044);
    assert.equal(retargeted.position, whole.position);
    assert.equal(retargeted.velocity, whole.velocity);
    assert.ok(isLyricSpringSettled(stepLineSpring(retargeted, 1.5), 400));
});

const frameHarness = ({ canAnimate = () => true, onUpdate = () => false } = {}) => {
    const pending = new Map(); let id = 0, timestamp = 0, updates = [];
    const spring = createLyricSpring({
        requestFrame(callback) { pending.set(++id, callback); return id; },
        cancelFrame(key) { pending.delete(key); }, canAnimate,
        onUpdate(state, frame) { updates.push({ ...state, ...frame }); return onUpdate(state, frame); }
    });
    return { spring, pending, updates, tick(milliseconds = 1000 / 60) {
        timestamp += milliseconds;
        const callbacks = [...pending.values()]; pending.clear();
        for (const callback of callbacks) callback(timestamp);
        assert.ok(pending.size <= 1, '始终最多一个待执行 RAF');
    } };
};

test('普通换行、resize 与虚拟窗口测量仅更新目标，保留位置和物理速度', () => {
    const harness = frameHarness();
    harness.spring.moveTo(500, { from: 0 });
    for (let index = 0; index < 7; index++) harness.tick();
    const before = harness.spring.getState();
    assert.ok(before.position > 0 && before.velocity > 0);
    const pendingFrame = [...harness.pending.keys()][0];
    harness.spring.moveTo(740, { from: 999 });
    const after = harness.spring.getState();
    assert.equal(after.position, before.position);
    assert.equal(after.velocity, before.velocity);
    assert.equal(after.target, 740);
    assert.equal([...harness.pending.keys()][0], pendingFrame);
    harness.spring.moveTo(740, { from: -100 });
    assert.equal(harness.spring.getState().velocity, before.velocity);
    for (let index = 0; index < 120 && harness.pending.size; index++) harness.tick();
    assert.equal(harness.pending.size, 0);
    assert.deepEqual(harness.spring.getState(), { position: 740, velocity: 0, target: 740, running: false, elapsed: harness.spring.getState().elapsed });
    const count = harness.updates.length; harness.tick();
    assert.equal(harness.updates.length, count, '静止后没有空转 RAF');
});

test('浏览、隐藏、插件关闭、销毁与减弱动效停止帧；已取消回调不可重新安排', () => {
    let enabled = true;
    const harness = frameHarness({ canAnimate: () => enabled });
    harness.spring.moveTo(100, { from: 0 }); harness.tick(); harness.tick();
    const late = [...harness.pending.values()][0];
    harness.spring.stop(23);
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.spring.getState().velocity, 0);
    late(100); assert.equal(harness.pending.size, 0);
    assert.equal(harness.spring.getState().position, 23);
    harness.spring.moveTo(200, { from: 23 });
    enabled = false; harness.tick();
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.spring.getState().running, false);
    harness.spring.moveTo(90, { immediate: true });
    assert.equal(harness.spring.getState().position, 90);
    assert.equal(harness.pending.size, 0);
    enabled = true; harness.spring.moveTo(300, { from: 90 });
    const afterDispose = [...harness.pending.values()][0];
    harness.spring.dispose(); afterDispose(999); harness.spring.moveTo(999);
    assert.equal(harness.pending.size, 0);
});

test('长帧限制物理步长，辅助行最迟三秒结束，重复相同目标不能延长上界', () => {
    const harness = frameHarness({ onUpdate: () => true });
    harness.spring.moveTo(400, { from: 0 });
    harness.tick(); harness.tick(1000);
    assert.equal(harness.updates.at(-1).deltaSeconds, LYRIC_SPRING_LIMITS.frameSeconds);
    for (let index = 0; index < 200 && harness.pending.size; index++) {
        harness.spring.moveTo(400); harness.tick();
    }
    assert.equal(harness.pending.size, 0);
    assert.equal(harness.spring.getState().position, 400);
    assert.equal(harness.spring.getState().velocity, 0);
    assert.ok(harness.updates.at(-1).force);
    const stalledFrame = frameHarness({ onUpdate: () => true });
    stalledFrame.spring.moveTo(900, { from: 0 });
    stalledFrame.tick(); stalledFrame.tick(5000);
    assert.equal(stalledFrame.pending.size, 0, '三秒上界使用实际帧时间，不能因64ms步长钳制拖成长动画');
    assert.equal(stalledFrame.spring.getState().position, 900);
});

test('3秒无操作恢复跟随是唯一延时任务，手动操作不会创建第二个循环', () => {
    let scheduledDelay = null;
    const timer = createFollowTimer(() => {}, {
        setTimer(callback, delay) { scheduledDelay = delay; return 1; }, clearTimer() {}
    });
    timer.arm(); assert.equal(scheduledDelay, 3000); timer.dispose();
});

test('真实毫秒时间控制逐组渐进填充，旧 highlighted 不影响结果', () => {
    const token = buildLyricTimeline([lyric(1000, 3000, 'You must')])[0].tokens[0];
    assert.equal(getTokenProgress(token, 0.5), 0);
    assert.equal(getTokenProgress(token, 1), 0);
    assert.equal(getTokenProgress(token, 2), 0.5);
    assert.equal(getTokenProgress(token, 3), 1);
    assert.equal(getTokenProgress(token, 10), 1);
});

test('前奏、词组空档、整行来源和下一句边界保持采样工作，尾奏与无时间来源停止', () => {
    const rows = buildLyricTimeline([
        { startTime: 2000, endTime: 4000, timingSource: 'word', characters: [
            { char: '前组', startTime: 2000, endTime: 2200 }, { char: '后组', startTime: 3500, endTime: 3700 }
        ] },
        lyric(6000, 7000, '整行来源', { timingSource: 'line' })
    ]);
    assert.equal(hasWordMotion(rows[0], 0), false);
    assert.equal(hasLyricClockWork(rows, 0), true, '前奏保持真实时钟采样以捕获第一句起点');
    assert.equal(hasWordMotion(rows[0], 2.3), false);
    assert.equal(hasLyricClockWork(rows, 2.3), true, '词组之间不回到父 timeupdate');
    assert.equal(hasLyricClockWork(rows, 5), true, '行间空档不回到父 timeupdate');
    assert.equal(hasWordMotion(rows[1], 6.2), false);
    assert.equal(hasLyricClockWork(rows, 6.2), true, '整行模式仍需准确捕获行边界');
    assert.equal(hasLyricClockWork(rows, 7), false);
    assert.equal(hasLyricClockWork(rows, Number.NaN), false);
    assert.equal(hasLyricClockWork(buildLyricTimeline([{ characters: [{ char: '无时间' }] }]), 0), false);
    assert.equal(hasLyricClockWork(buildLyricTimeline([]), 0), false);
});

test('真实音频刚跨过行起点便在下一帧切换，不等待下一次父时间通知或增加偏移', () => {
    const rows = buildLyricTimeline([lyric(2000, 2400, '第一句'), lyric(3000, 3500, '第二句', { timingSource: 'line' })]);
    const pending = new Map(), samples = []; let id = 0, timestamp = 0, audioTime = 1.95;
    const clock = createLyricWordClock({
        readTime: () => audioTime,
        onTime: time => samples.push({ time, active: resolveLyricPosition(rows, time).activeIndex }),
        requestFrame(callback) { pending.set(++id, callback); return id; },
        cancelFrame(key) { pending.delete(key); }, canAnimate: () => true,
        hasMotion: time => hasLyricClockWork(rows, time), now: () => timestamp
    });
    const tick = time => {
        timestamp += 1000 / 60; audioTime = time;
        const callbacks = [...pending.values()]; pending.clear();
        for (const callback of callbacks) callback(timestamp);
        assert.ok(pending.size <= 1);
    };
    clock.sync(); assert.equal(samples.at(-1).active, -1);
    tick(1.999); assert.equal(samples.at(-1).active, -1);
    tick(2.004); assert.deepEqual(samples.at(-1), { time: 2.004, active: 0 });
    tick(2.45); assert.equal(samples.at(-1).active, -1);
    tick(3.003); assert.deepEqual(samples.at(-1), { time: 3.003, active: 1 });
    assert.equal(clock.isRunning(), true);
    tick(3.5); assert.equal(clock.isRunning(), false); assert.equal(pending.size, 0);
    clock.dispose();
});

test('词组抬升随真实填充同帧求值，暂停与seek可逆，减弱动效只关闭几何反馈', () => {
    const token = buildLyricTimeline([lyric(1000, 3000, '一个词组')])[0].tokens[0];
    const start = getTokenPresentation(token, 1), middle = getTokenPresentation(token, 2), end = getTokenPresentation(token, 3);
    assert.equal(start.progress, 0); assert.equal(start.translateY, 0); assert.equal(start.scale, 1);
    assert.equal(middle.progress, getTokenProgress(token, 2));
    assert.ok(middle.translateY < 0); assert.ok(middle.scale > 1);
    assert.deepEqual(getTokenPresentation(token, 2), middle, '相同暂停时间产生相同状态');
    assert.equal(getTokenPresentation(token, 1.5).progress, 0.25, '倒退seek不用旧动画进度');
    assert.equal(end.progress, 1); assert.equal(end.translateY, 0); assert.equal(end.scale, 1);
    assert.deepEqual(getTokenPresentation(token, 2, true), { progress: 0.5, translateY: 0, scale: 1 });
    assert.deepEqual(getTokenPresentation({ timed: false }, 2), { progress: 0, translateY: 0, scale: 1 });
});

test('逐词 RAF 只读取真实音频时钟，缓冲停住时不推算进度并停止空转', () => {
    const pending = new Map(), samples = [], states = [];
    let id = 0, timestamp = 0, audioTime = 1.1;
    const row = buildLyricTimeline([lyric(1000, 3000, '真实词组')])[0];
    const clock = createLyricWordClock({
        readTime: () => audioTime, onTime: time => samples.push(time),
        requestFrame(callback) { pending.set(++id, callback); return id; },
        cancelFrame(key) { pending.delete(key); }, canAnimate: () => true,
        hasMotion: time => hasWordMotion(row, time), now: () => timestamp,
        onState: running => states.push(running)
    });
    const tick = (milliseconds, time = audioTime) => {
        timestamp += milliseconds; audioTime = time;
        const callbacks = [...pending.values()]; pending.clear();
        for (const callback of callbacks) callback(timestamp);
        assert.ok(pending.size <= 1);
    };
    clock.sync(); clock.sync(); assert.equal(pending.size, 1);
    tick(1000 / 60, 1.115);
    assert.equal(samples.at(-1), 1.115, 'RAF 时间不当作音乐时间');
    tick(1000 / 60, 1.13);
    for (let frame = 0; frame < 12; frame++) tick(1000 / 60);
    assert.equal(samples.at(-1), 1.13);
    assert.equal(clock.isRunning(), false);
    assert.equal(pending.size, 0);
    assert.deepEqual(states, [true, false]);
    audioTime = 1.5; clock.sync(); assert.equal(pending.size, 1);
    tick(16, 3); assert.equal(pending.size, 0, '词组已唱完立即停止帧');
    clock.dispose();
});

test('暂停、隐藏、减弱动效及销毁可撤销逐词帧，迟到回调不能唤醒', () => {
    const pending = new Map(), samples = [];
    let id = 0, enabled = true, audioTime = 0.2;
    const clock = createLyricWordClock({
        readTime: () => audioTime, onTime: time => samples.push(time),
        requestFrame(callback) { pending.set(++id, callback); return id; },
        cancelFrame(key) { pending.delete(key); }, canAnimate: () => enabled,
        hasMotion: () => true, now: () => 0
    });
    clock.sync(); const late = [...pending.values()][0];
    enabled = false; audioTime = 0.3; clock.sync();
    assert.equal(samples.at(-1), 0.3);
    assert.equal(pending.size, 0); assert.equal(clock.isRunning(), false);
    late(100); assert.equal(pending.size, 0);
    enabled = true; clock.sync(); const afterDispose = [...pending.values()][0];
    clock.dispose(); afterDispose(200); clock.sync();
    assert.equal(pending.size, 0); assert.equal(clock.isRunning(), false);
});

test('无逐词来源、词组间长间隔、异常音乐时间均不创建空转词动画', () => {
    const row = buildLyricTimeline([{ startTime: 0, endTime: 5000, timingSource: 'word', characters: [
        { char: '一', startTime: 1000, endTime: 1200 }, { char: '二', startTime: 3000, endTime: 3500 }
    ] }])[0];
    assert.equal(hasWordMotion(row, 0), false);
    assert.equal(hasWordMotion(row, 0.7), true);
    assert.equal(hasWordMotion(row, 1.3), false);
    assert.equal(hasWordMotion(row, 2.7), true);
    assert.equal(hasWordMotion(row, 3.5), false);
    assert.equal(hasWordMotion({ ...row, hasWordTiming: false }, 1.1), false);
    const pending = new Map(); let id = 0;
    const clock = createLyricWordClock({
        readTime: () => Number.NaN, onTime: () => assert.fail('不得发布异常时间'),
        requestFrame(callback) { pending.set(++id, callback); return id; },
        cancelFrame(key) { pending.delete(key); }, canAnimate: () => true,
        hasMotion: () => true, now: () => 0
    });
    clock.sync(); assert.equal(pending.size, 0); clock.dispose();
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
    assert.deepEqual(resolveLyricPosition(rows, 0), { phase: 'prelude', activeIndex: -1, focusIndex: 0, nextIndex: 0, gap: null });
    assert.equal(resolveLyricPosition(rows, 2).activeIndex, 0);
    assert.deepEqual(resolveLyricPosition(rows, 4), { phase: 'interlude', activeIndex: -1, focusIndex: 0, nextIndex: 1, gap: null });
    assert.equal(resolveLyricPosition(rows, 7).activeIndex, 1);
    assert.deepEqual(resolveLyricPosition(rows, 9), { phase: 'outro', activeIndex: -1, focusIndex: 1, nextIndex: -1, gap: null });
});

test('普通短换气与行间停顿不生成三个点，四秒展示阈值不修改任何源时间', () => {
    assert.equal(LYRIC_GAP_MIN_MS, 4000);
    const source = [lyric(2000, 4000, '普通第一句'), lyric(6000, 8000, '普通第二句'), lyric(11000, 13000, '普通第三句')];
    const snapshot = structuredClone(source), rows = buildLyricTimeline(source);
    assert.equal(resolveLyricPosition(rows, 1).gap, null);
    assert.equal(resolveLyricPosition(rows, 5).gap, null);
    assert.equal(resolveLyricPosition(rows, 9).gap, null);
    assert.deepEqual(buildLyricStageRows(rows).map(row => row.kind), ['line', 'line', 'line']);
    assert.deepEqual(source, snapshot);
});

test('长前奏与真实间奏在歌词序列中占明确一行，源歌词索引与布局索引保持分离', () => {
    const rows = buildLyricTimeline([lyric(6000, 8000, '第一句'), lyric(14000, 16000, '第二句')]);
    const stage = buildLyricStageRows(rows);
    assert.deepEqual(stage.map(row => row.kind), ['gap', 'line', 'gap', 'line']);
    assert.deepEqual(stage.filter(row => row.kind === 'line').map(row => [row.sourceIndex, row.index]), [[0, 1], [1, 3]]);
    const prelude = resolveLyricPosition(rows, 3);
    assert.equal(prelude.gap.phase, 'prelude');
    assert.equal(prelude.gap.progress, 0.5);
    assert.equal(getLyricStageFocus(stage, prelude), 0);
    const middle = resolveLyricPosition(rows, 11);
    assert.deepEqual(middle.gap, { key: 'mico-lyric-gap-8000-14000', startMs: 8000, endMs: 14000,
        beforeIndex: 0, afterIndex: 1, phase: 'interlude', progress: 0.5 });
    assert.equal(getLyricStageFocus(stage, middle), 2, '自动跟随聚焦间奏自身，不停留在前句再浮出三个点');
    assert.equal(getSeekTime(stage[2]), null);
    assert.equal(getSeekTime(stage[3]), 14);
    assert.equal(getLyricStageFocus(stage, resolveLyricPosition(rows, 14)), 3);
});

test('间奏采用真实半开边界，暂停保持进度、倒退重新求值，尾奏不凭歌曲长度猜测', () => {
    const rows = buildLyricTimeline([lyric(0, 1000, '第一句'), lyric(5000, 6000, '第二句')]);
    assert.equal(resolveLyricPosition(rows, 1).gap.progress, 0);
    const paused = resolveLyricPosition(rows, 3);
    assert.deepEqual(resolveLyricPosition(rows, 3), paused);
    assert.equal(paused.gap.progress, 0.5);
    assert.equal(resolveLyricPosition(rows, 4.999).gap !== null, true);
    assert.equal(resolveLyricPosition(rows, 5).gap, null);
    assert.equal(resolveLyricPosition(rows, 5).activeIndex, 1);
    assert.equal(resolveLyricPosition(rows, 2).gap.progress, 0.25);
    assert.equal(resolveLyricPosition(rows, 999).gap, null);
    const unknown = buildLyricTimeline([{ characters: [{ char: '没有主行边界' }] }, { characters: [{ char: '不能补造间奏' }] }]);
    assert.equal(buildLyricStageRows(unknown).some(row => row.kind === 'gap'), false);
});

test('重叠长句覆盖短句结束点，不根据短行末端制造假间奏；空行仅保留真实有效区间', () => {
    const rows = buildLyricTimeline([lyric(0, 10000, '长句'), lyric(1000, 2000, '重叠短句'),
        { startTime: 3000, endTime: 9000, characters: [] }, lyric(12000, 13000, '后句'),
        { startTime: 13000, endTime: 18000, characters: [] }]);
    const stage = buildLyricStageRows(rows);
    assert.deepEqual(stage.map(row => row.kind), ['line', 'line', 'line', 'gap']);
    assert.equal(resolveLyricPosition(rows, 6).activeIndex, 0);
    assert.equal(resolveLyricPosition(rows, 6).gap, null);
    assert.equal(resolveLyricPosition(rows, 11).gap, null, '长句真实末端至下一句仅两秒');
    assert.equal(resolveLyricPosition(rows, 15).gap.beforeIndex, 3);
    assert.equal(resolveLyricPosition(rows, 15).gap.afterIndex, -1);
    assert.equal(resolveLyricPosition(rows, 18).gap, null);
    assert.deepEqual(stage.filter(row => row.kind === 'line').map(row => row.sourceIndex), [0, 1, 3]);
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

test('时间索引保留同起点顺序、已结束短行后的长行及空行边界', () => {
    const rows = buildLyricTimeline([
        lyric(1000, 10000, '长行'), lyric(3000, 4000, '短行'), lyric(3000, 3500, '同起点后行'),
        { startTime: 10000, endTime: 12000, characters: [] }, lyric(12000, 13000, '尾行')
    ]);
    assert.equal(resolveLyricPosition(rows, 3.2).activeIndex, 2);
    assert.equal(resolveLyricPosition(rows, 3.7).activeIndex, 1);
    assert.equal(resolveLyricPosition(rows, 4).activeIndex, 0);
    assert.equal(resolveLyricPosition(rows, 10).phase, 'interlude');
    assert.equal(resolveLyricPosition(rows, 12).activeIndex, 4);
    assert.equal(resolveLyricPosition(rows, 13).phase, 'outro');
    assert.equal(resolveLyricPosition(rows, 2).activeIndex, 0, '倒退仍直接按音乐时间查询索引');
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
    assert.equal(getLinePresentation(6, 5).blurPx, 2.5);
    assert.equal(getLinePresentation(6, 5).opacity, 0.45);
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
