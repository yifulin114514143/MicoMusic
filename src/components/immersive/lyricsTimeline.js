// 沉浸歌词的新内部时间接口；秒来自播放器，歌词字段保持原始毫秒单位。
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const clockMilliseconds = seconds => typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;

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
    const textRows = rows.filter(row => row.hasText);
    if (!textRows.length) return { phase: 'empty', activeIndex: -1, focusIndex: -1, nextIndex: -1 };
    const timedRows = rows.filter(row => row.timed).sort((first, second) => first.startMs - second.startMs || first.index - second.index);
    const voicedRows = timedRows.filter(row => row.hasText);
    if (!voicedRows.length) return { phase: 'untimed', activeIndex: -1, focusIndex: textRows[0].index, nextIndex: -1 };
    const time = clockMilliseconds(seconds);
    const active = voicedRows.filter(row => time >= row.startMs && time < row.endMs).at(-1);
    if (active) return { phase: 'line', activeIndex: active.index, focusIndex: active.index,
        nextIndex: voicedRows.find(row => row.startMs > active.startMs)?.index ?? -1 };
    const previous = voicedRows.filter(row => row.startMs <= time).at(-1);
    const next = voicedRows.find(row => row.startMs > time);
    const insideBlank = timedRows.some(row => !row.hasText && time >= row.startMs && time < row.endMs);
    if (!previous) return { phase: insideBlank ? 'interlude' : 'prelude', activeIndex: -1, focusIndex: next.index, nextIndex: next.index };
    if (next || insideBlank) return { phase: 'interlude', activeIndex: -1, focusIndex: previous.index, nextIndex: next?.index ?? -1 };
    return { phase: 'outro', activeIndex: -1, focusIndex: previous.index, nextIndex: -1 };
}

export function getTokenProgress(token, seconds) {
    if (!token?.timed || !validTime(token.startMs) || !validTime(token.endMs) || token.endMs < token.startMs) return 0;
    const time = clockMilliseconds(seconds);
    if (time < token.startMs) return 0;
    if (token.endMs === token.startMs) return 1;
    return Math.max(0, Math.min(1, (time - token.startMs) / (token.endMs - token.startMs)));
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
    const opacity = [1, 0.54, 0.37, 0.26, 0.18][Math.min(4, distance)];
    return { distance, opacity, blurPx: distance > 4 ? 0 : [0, 1.2, 3, 5.5, 7][distance],
        delayMs: reduceMotion ? 0 : Math.min(distance, 4) * 22,
        translateY: reduceMotion ? 0 : Math.max(-4, Math.min(4, index - focusIndex)) * 2 };
}

export function createFollowTimer(onResume, { delay = 4500, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
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
