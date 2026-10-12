// 沉浸歌词的新内部时间接口；秒来自播放器，歌词字段保持原始毫秒单位。
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const clockMilliseconds = seconds => typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
const timelineIndexes = new WeakMap();
const indexTimedRows = rows => {
    const sorted = rows.filter(row => row.timed).sort((first, second) => first.startMs - second.startMs || first.index - second.index);
    let end = -1;
    return { rows: sorted, ends: sorted.map(row => (end = Math.max(end, row.endMs))) };
};
const latestStart = (rows, time) => {
    let low = 0, high = rows.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows[middle].startMs <= time) low = middle + 1; else high = middle;
    }
    return low - 1;
};
const activeAt = (index, time, from) => {
    for (let rowIndex = from; rowIndex >= 0 && index.ends[rowIndex] > time; rowIndex--) {
        if (time < index.rows[rowIndex].endMs) return index.rows[rowIndex];
    }
    return null;
};

// 展示规则：仅在真实行边界之间至少留出四秒时呈现间奏行。
// 这不是歌曲结构识别，也不改变主行或逐词时间；普通换气/行间停顿不产生三个点。
export const LYRIC_GAP_MIN_MS = 4000;
const buildGapIntervals = (voicedRows, blankRows) => {
    const gaps = [];
    const append = (startMs, endMs, beforeIndex, afterIndex, phase) => {
        if (endMs - startMs < LYRIC_GAP_MIN_MS) return;
        gaps.push({ key: `mico-lyric-gap-${startMs}-${endMs}`, startMs, endMs, beforeIndex, afterIndex, phase });
    };
    if (!voicedRows.length) return gaps;
    append(0, voicedRows[0].startMs, -1, voicedRows[0].index, 'prelude');
    let previous = voicedRows[0], endMs = previous.endMs;
    for (const next of voicedRows.slice(1)) {
        if (next.startMs > endMs) append(endMs, next.startMs, previous.index, next.index, 'interlude');
        if (next.endMs >= endMs) { previous = next; endMs = next.endMs; }
    }
    // 尾部只有歌词数据明确提供了空白区间才可呈现；没有音频总时长时不推测尾奏。
    let blankStart = null, blankEnd = null;
    for (const blank of blankRows) {
        if (blank.endMs <= endMs) continue;
        const start = Math.max(endMs, blank.startMs);
        if (blankStart !== null && start > blankEnd) {
            append(blankStart, blankEnd, previous.index, -1, 'interlude');
            blankStart = null;
        }
        if (blankStart === null) blankStart = start;
        blankEnd = Math.max(blankEnd ?? 0, blank.endMs);
    }
    if (blankStart !== null) append(blankStart, blankEnd, previous.index, -1, 'interlude');
    return gaps;
};
const getTimelineIndex = rows => {
    let index = timelineIndexes.get(rows);
    if (!index) {
        const textRows = rows.filter(row => row.hasText);
        const voiced = indexTimedRows(textRows), blank = indexTimedRows(rows.filter(row => !row.hasText));
        index = { textRows, voiced, blank, gaps: buildGapIntervals(voiced.rows, blank.rows) };
        timelineIndexes.set(rows, index);
    }
    return index;
};

// 布局索引与原歌词索引分开；空白歌词源不再占一个无意义的可点击/聚焦主行。
export function buildLyricStageRows(rows) {
    const { textRows, gaps } = getTimelineIndex(rows);
    const stage = [], before = new Map(), after = new Map();
    for (const gap of gaps) {
        const map = gap.afterIndex >= 0 ? before : after;
        const index = gap.afterIndex >= 0 ? gap.afterIndex : gap.beforeIndex;
        if (!map.has(index)) map.set(index, []);
        map.get(index).push(gap);
    }
    for (const row of textRows) {
        for (const gap of before.get(row.index) || []) stage.push({ ...gap, kind: 'gap', hasText: false });
        stage.push({ ...row, sourceIndex: row.index, kind: 'line' });
        for (const gap of after.get(row.index) || []) stage.push({ ...gap, kind: 'gap', hasText: false });
    }
    return stage.map((row, index) => ({ ...row, index }));
}

export function getLyricStageFocus(stageRows, position) {
    if (position.gap) return stageRows.findIndex(row => row.kind === 'gap' && row.key === position.gap.key);
    return stageRows.findIndex(row => row.kind === 'line' && row.sourceIndex === position.focusIndex);
}

export function buildLyricTimeline(lines) {
    if (!Array.isArray(lines)) return [];
    return lines.map((source, index) => {
        const line = source && typeof source === 'object' ? source : {};
        const tokens = (Array.isArray(line.characters) ? line.characters : [])
            .filter(token => token && typeof token.char === 'string')
            .map(token => ({ text: token.char, startMs: token.startTime, endMs: token.endTime,
                timed: validTime(token.startTime) && validTime(token.endTime) && token.endTime >= token.startTime }));
        const timedTokens = tokens.filter(token => token.timed);
        const startMs = validTime(line.startTime) ? line.startTime : timedTokens.length ? Math.min(...timedTokens.map(token => token.startMs)) : null;
        const suppliedEnd = validTime(line.endTime) && startMs !== null && line.endTime >= startMs ? line.endTime : null;
        const endMs = suppliedEnd ?? (timedTokens.length ? Math.max(...timedTokens.map(token => token.endMs)) : null);
        const text = tokens.map(token => token.text).join('');
        return {
            index, key: `mico-lyric-${index}-${startMs ?? 'untimed'}`, text, hasText: Boolean(text.trim()), tokens,
            startMs, endMs, timed: startMs !== null && endMs !== null && endMs >= startMs,
            timingSource: line.timingSource === 'word' ? 'word' : 'line',
            hasWordTiming: line.timingSource === 'word' && tokens.length > 0 && tokens.every(token => token.timed),
            translated: typeof line.translated === 'string' ? line.translated : '',
            romanized: typeof line.romanized === 'string' ? line.romanized : ''
        };
    });
}

export function resolveLyricPosition(rows, seconds) {
    const { textRows, voiced, blank, gaps } = getTimelineIndex(rows);
    if (!textRows.length) return { phase: 'empty', activeIndex: -1, focusIndex: -1, nextIndex: -1, gap: null };
    const voicedRows = voiced.rows;
    if (!voicedRows.length) return { phase: 'untimed', activeIndex: -1, focusIndex: textRows[0].index, nextIndex: -1, gap: null };
    const time = clockMilliseconds(seconds);
    const current = latestStart(voicedRows, time);
    const active = activeAt(voiced, time, current);
    if (active) return { phase: 'line', activeIndex: active.index, focusIndex: active.index,
        nextIndex: voicedRows[latestStart(voicedRows, active.startMs) + 1]?.index ?? -1, gap: null };
    const gap = gaps.find(value => value.startMs <= time && time < value.endMs);
    if (gap) return { phase: gap.phase, activeIndex: -1, focusIndex: gap.beforeIndex >= 0 ? gap.beforeIndex : gap.afterIndex,
        nextIndex: gap.afterIndex, gap: { ...gap, progress: (time - gap.startMs) / (gap.endMs - gap.startMs) } };
    const previous = voicedRows[current];
    const next = voicedRows[current + 1];
    const insideBlank = Boolean(activeAt(blank, time, latestStart(blank.rows, time)));
    if (!previous) return { phase: insideBlank ? 'interlude' : 'prelude', activeIndex: -1, focusIndex: next.index, nextIndex: next.index, gap: null };
    if (next || insideBlank) return { phase: 'interlude', activeIndex: -1, focusIndex: previous.index, nextIndex: next?.index ?? -1, gap: null };
    return { phase: 'outro', activeIndex: -1, focusIndex: previous.index, nextIndex: -1, gap: null };
}

export function getTokenProgress(token, seconds) {
    if (!token?.timed || !validTime(token.startMs) || !validTime(token.endMs) || token.endMs < token.startMs) return 0;
    const time = clockMilliseconds(seconds);
    if (time < token.startMs) return 0;
    if (token.endMs === token.startMs) return 1;
    return Math.max(0, Math.min(1, (time - token.startMs) / (token.endMs - token.startMs)));
}

// 此函数只判断词组是否正在填充，不作为播放采样钟的启停依据。
export function hasWordMotion(row, seconds, lookAheadSeconds = 0.35) {
    if (!row?.hasWordTiming) return false;
    const time = clockMilliseconds(seconds);
    const horizon = time + Math.max(0, lookAheadSeconds) * 1000;
    return row.tokens.some(token => token.timed && token.endMs > time && token.startMs <= horizon);
}

// 行边界也需要逐帧采样。仅跟着当前词组启停会在前奏、换行间隙和整行模式中
// 回到父播放器的节流 timeupdate，下一句已开始后才唤醒。保持原歌词时间不变。
export function hasLyricClockWork(rows, seconds) {
    if (!validTime(seconds)) return false;
    const { voiced, blank } = getTimelineIndex(rows);
    if (!voiced.rows.length) return false;
    const finalEnd = Math.max(voiced.ends.at(-1) ?? -1, blank.ends.at(-1) ?? -1);
    return clockMilliseconds(seconds) < finalEnd;
}

// 抬升只使用同一个真实词组进度，不拆分词组、不补造字符时间，也不另开动画钟。
export function getTokenPresentation(token, seconds, reduceMotion = false) {
    const progress = getTokenProgress(token, seconds);
    const lift = !reduceMotion && progress > 0 && progress < 1 ? Math.sin(Math.PI * progress) : 0;
    return { progress, translateY: lift ? -3.2 * lift : 0, scale: 1 + 0.025 * lift };
}

// 接口名保留兼容；它现在同时更新行边界、间奏和逐词进度。
// 时钟来自真实音频元素，绝不根据歌词长度或 RAF 时间推算播放进度。
// buffering 时 audio.currentTime 停住，最多等待 stallMs 后停止帧，新的 timeupdate 可重新唤醒。
export function createLyricWordClock({ readTime, onTime, requestFrame, cancelFrame, canAnimate,
    hasMotion, now = () => performance.now(), stallMs = 160, onState = () => {} }) {
    let frame = null, generation = 0, disposed = false, running = false;
    let previousTime = null, lastChange = 0;
    const setRunning = value => {
        if (running === value) return;
        running = value; onState(value);
    };
    const cancel = () => {
        generation++;
        if (frame !== null) cancelFrame(frame);
        frame = null; setRunning(false);
    };
    const sample = timestamp => {
        const time = readTime();
        if (!validTime(time)) return null;
        if (time !== previousTime) {
            previousTime = time; lastChange = timestamp;
        }
        onTime(time);
        return time;
    };
    const queue = () => {
        const ticket = generation;
        frame = requestFrame(timestamp => {
            if (disposed || ticket !== generation) return;
            frame = null;
            if (!canAnimate()) { cancel(); return; }
            const time = sample(timestamp);
            if (time === null || !hasMotion(time) || timestamp - lastChange >= stallMs) { cancel(); return; }
            if (disposed || ticket !== generation) return;
            queue();
        });
    };
    return {
        sync() {
            if (disposed) return;
            const timestamp = now(), time = sample(timestamp);
            if (disposed) return;
            if (time === null || !canAnimate() || !hasMotion(time)) { cancel(); return; }
            if (!running) { lastChange = timestamp; setRunning(true); queue(); }
        },
        stop: cancel,
        dispose() { disposed = true; cancel(); },
        isRunning: () => running
    };
}

export function getSeekTime(row) {
    return row?.hasText && validTime(row.startMs) ? row.startMs / 1000 : null;
}

export function selectSecondaryText(row, mode, visible) {
    if (!visible) return '';
    return (mode === 'romanization' ? row.romanized : row.translated) || '';
}

export function getVirtualWindow(heights, scrollTop, viewportHeight, overscan = 4) {
    const values = heights.map(height => Number.isFinite(height) && height > 0 ? height : 104);
    const offsets = [0];
    for (const height of values) offsets.push(offsets.at(-1) + height);
    const total = offsets.at(-1);
    if (!values.length) return { start: 0, end: 0, top: 0, bottom: 0, renderedHeight: 0, offsets };
    const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
    const bottom = top + Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1);
    const find = position => {
        let low = 0, high = values.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (offsets[middle + 1] <= position) low = middle + 1; else high = middle;
        }
        return Math.min(values.length - 1, low);
    };
    const start = Math.max(0, find(top) - overscan);
    const end = Math.min(values.length, find(bottom) + overscan + 1);
    return { start, end, top: offsets[start], bottom: total - offsets[end],
        renderedHeight: offsets[end] - offsets[start], offsets };
}

export function getLinePresentation(index, focusIndex, reduceMotion = false) {
    const distance = Math.abs(index - focusIndex);
    const opacity = [1, 0.45, 0.37, 0.26, 0.18][Math.min(4, distance)];
    return { distance, opacity, blurPx: distance > 4 ? 0 : [0, 2.5, 3, 5.5, 7][distance],
        delayMs: reduceMotion ? 0 : Math.min(distance, 4) * 22,
        translateY: reduceMotion ? 0 : Math.max(-4, Math.min(4, index - focusIndex)) * 2 };
}

export function createFollowTimer(onResume, { delay = 3000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let timer = null, generation = 0, disposed = false;
    const cancel = () => {
        generation++;
        if (timer !== null) clearTimer(timer);
        timer = null;
    };
    return {
        arm() {
            if (disposed) return;
            cancel(); const current = generation;
            timer = setTimer(() => {
                if (disposed || generation !== current) return;
                timer = null; onResume();
            }, delay);
        },
        cancel,
        dispose() { disposed = true; cancel(); }
    };
}

// 以下是歌词专用的新内部物理接口，单位为 CSS px、秒；没有浏览器平滑滚动依赖。
export const LYRIC_SPRING = Object.freeze({ stiffness: 280, damping: 28, mass: 1 });
export const LYRIC_SPRING_LIMITS = Object.freeze({ distance: 0.05, speed: 0.1, frameSeconds: 0.064, durationSeconds: 3 });

export function stepLyricSpring(state, target, seconds) {
    const position = Number.isFinite(state?.position) ? state.position : 0;
    const velocity = Number.isFinite(state?.velocity) ? state.velocity : 0;
    if (!Number.isFinite(target)) return { position, velocity };
    const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (!time) return { position, velocity };
    // m*x'' + c*x' + k*(x-target)=0 的欠阻尼精确解，避免 Euler 在长帧时失稳。
    const decay = LYRIC_SPRING.damping / (2 * LYRIC_SPRING.mass);
    const frequencySquared = LYRIC_SPRING.stiffness / LYRIC_SPRING.mass;
    const frequency = Math.sqrt(frequencySquared - decay * decay);
    const displacement = position - target;
    const attenuation = Math.exp(-decay * time);
    const sine = Math.sin(frequency * time), cosine = Math.cos(frequency * time);
    return {
        position: target + attenuation * (displacement * cosine + (velocity + decay * displacement) / frequency * sine),
        velocity: attenuation * (velocity * cosine - (decay * velocity + frequencySquared * displacement) / frequency * sine)
    };
}

export function isLyricSpringSettled(state, target) {
    return Math.abs(state.position - target) <= LYRIC_SPRING_LIMITS.distance && Math.abs(state.velocity) <= LYRIC_SPRING_LIMITS.speed;
}

export function retargetLineSpring(state, target, delaySeconds) {
    return { ...state, pendingTarget: target, delaySeconds: Math.max(0, delaySeconds) };
}

export function stepLineSpring(state, seconds) {
    const time = Math.max(0, seconds);
    const delayed = Math.min(time, state.delaySeconds);
    let physical = stepLyricSpring(state, state.target, delayed);
    const delaySeconds = Math.max(0, state.delaySeconds - delayed);
    const target = delaySeconds === 0 ? state.pendingTarget : state.target;
    physical = stepLyricSpring(physical, target, time - delayed);
    return { ...state, ...physical, target, delaySeconds };
}

export function createLyricSpring({ requestFrame, cancelFrame, onUpdate, canAnimate = () => true }) {
    let physical = { position: 0, velocity: 0 }, target = 0, frame = null, previous = null;
    let elapsed = 0, generation = 0, running = false, disposed = false;
    const snapshot = () => ({ ...physical, target, running, elapsed });
    const publish = (deltaSeconds = 0, force = false) => onUpdate(snapshot(), { deltaSeconds, force }) === true;
    const cancel = () => {
        generation++;
        if (frame !== null) cancelFrame(frame);
        frame = null; previous = null; running = false;
    };
    const queue = () => {
        const ticket = generation;
        frame = requestFrame(timestamp => {
            if (disposed || ticket !== generation) return;
            frame = null;
            if (!canAnimate()) { cancel(); physical.velocity = 0; publish(0, true); return; }
            const elapsedFrame = previous === null ? 0 : Math.max(0, (timestamp - previous) / 1000);
            const delta = Math.min(LYRIC_SPRING_LIMITS.frameSeconds, elapsedFrame);
            previous = timestamp; elapsed += elapsedFrame;
            physical = stepLyricSpring(physical, target, delta);
            const auxiliaryMoving = publish(delta);
            if (disposed || ticket !== generation) return;
            if (elapsed >= LYRIC_SPRING_LIMITS.durationSeconds || (isLyricSpringSettled(physical, target) && !auxiliaryMoving)) {
                cancel(); physical = { position: target, velocity: 0 }; publish(0, true);
            } else queue();
        });
    };
    return {
        moveTo(nextTarget, { immediate = false, from } = {}) {
            if (disposed || !Number.isFinite(nextTarget)) return;
            const changedTarget = target !== nextTarget;
            target = nextTarget;
            if (immediate || !canAnimate()) {
                cancel(); physical = { position: target, velocity: 0 }; elapsed = 0; publish(0, true); return;
            }
            if (!running && Number.isFinite(from)) physical = { position: from, velocity: 0 };
            if (!running) {
                elapsed = 0; previous = null; running = true;
                const auxiliaryMoving = publish();
                if (isLyricSpringSettled(physical, target) && !auxiliaryMoving) { running = false; publish(0, true); return; }
                queue();
            } else if (changedTarget) {
                // 真实 resize / 测量 / 新行只改变目标，保留当前位置、速度及唯一待执行帧。
                elapsed = 0;
            }
        },
        stop(position = physical.position) {
            cancel(); physical = { position: Number.isFinite(position) ? position : physical.position, velocity: 0 }; publish(0, true);
        },
        dispose() { disposed = true; cancel(); physical.velocity = 0; },
        getState: snapshot
    };
}
