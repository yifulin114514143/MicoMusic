<template>
    <section ref="viewport" class="mico-immersive-lyrics" :class="{ 'mico-lyrics-reduced': reduceMotion, 'mico-lyrics-browsing': !following }"
        :style="{ '--mico-lyric-font': fontFamily || 'inherit' }" :data-mico-lyric-phase="position.phase"
        :data-mico-lyric-following="String(following)" :data-mico-lyric-active="position.activeIndex" :data-mico-lyric-clock="wordClockRunning ? 'running' : 'idle'"
        :data-mico-lyric-stage-focus="followFocusIndex" :data-mico-lyric-gap-key="position.gap?.key || 'none'"
        aria-label="歌词" tabindex="0" @scroll.passive="onScroll" @wheel.passive="beginBrowse"
        @pointerdown="onPointerDown" @touchstart.passive="onTouchStart" @touchmove.passive="beginBrowse" @touchend.passive="onPointerRelease" @touchcancel.passive="onPointerRelease"
        @keydown="onBrowseKey">
        <div v-if="hasText" class="mico-lyric-content">
            <div class="mico-lyric-spacer" aria-hidden="true" :style="{ height: `${windowed.top + topPadding}px` }"></div>
            <template v-for="row in visibleRows" :key="row.key">
            <div v-if="row.kind === 'gap'" :ref="element => setRowElement(element, row.index)"
                class="mico-lyric-row mico-lyric-gap-row" :class="{ 'mico-lyric-focused': row.index === focusIndex, 'mico-lyric-gap-active': isGapActive(row) }"
                :style="presentation(row.index)" :data-mico-lyric-stage-index="row.index"
                :data-mico-lyric-gap-start="row.startMs" :data-mico-lyric-gap-end="row.endMs"
                :data-mico-lyric-gap-before="row.beforeIndex" :data-mico-lyric-gap-after="row.afterIndex"
                :aria-hidden="!isGapActive(row)">
                <span v-if="isGapActive(row)" class="mico-lyric-gap" role="status"
                    :aria-label="row.phase === 'prelude' ? '前奏' : '间奏'" :data-mico-lyric-gap-progress="position.gap.progress">
                    <span v-for="dot in 3" :key="dot" class="mico-lyric-gap-dot" aria-hidden="true"
                        :style="{ '--mico-gap-dot-fill': Math.max(0, Math.min(1, position.gap.progress * 3 - (dot - 1))) }"></span>
                </span>
            </div>
            <component v-else :is="getSeekTime(row) === null ? 'div' : 'button'"
                :ref="element => setRowElement(element, row.index)" class="mico-lyric-row"
                :class="{ 'mico-lyric-focused': row.index === focusIndex, 'mico-lyric-active': row.sourceIndex === position.activeIndex }"
                :style="presentation(row.index)" :data-mico-lyric-index="row.sourceIndex" :data-mico-lyric-stage-index="row.index"
                :data-mico-lyric-timing="row.hasWordTiming ? 'word' : 'line'"
                :type="getSeekTime(row) === null ? undefined : 'button'" :title="getSeekTime(row) === null ? undefined : '从这一句播放'"
                @click="seekRow(row)">
                <span class="mico-lyric-primary">
                    <template v-if="row.hasWordTiming && highlightMode === 'char'">
                        <span v-for="(token, tokenIndex) in row.tokens" :key="tokenIndex" class="mico-lyric-token"
                            :style="{ '--mico-word-fill': `${getTokenProgress(token, visualTime) * 100}%` }">
                            <span class="mico-lyric-token-base">{{ token.text }}</span>
                            <span class="mico-lyric-token-fill" aria-hidden="true">{{ token.text }}</span>
                        </span>
                    </template>
                    <template v-else>{{ row.text || '\u00a0' }}</template>
                </span>
                <span v-if="secondary(row)" class="mico-lyric-secondary">{{ secondary(row) }}</span>
            </component>
            </template>
            <div class="mico-lyric-spacer" aria-hidden="true" :style="{ height: `${windowed.bottom + bottomPadding}px` }"></div>
        </div>
        <div v-else class="mico-lyric-empty" role="status">{{ tips || '暂无歌词' }}</div>
        <div v-if="!following && hasText" class="mico-lyric-resume-anchor">
            <button class="mico-lyric-resume" type="button" @click.stop="resumeFollow">回到正在播放</button>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildLyricTimeline, buildLyricStageRows, getLyricStageFocus, resolveLyricPosition, getTokenProgress, getSeekTime, selectSecondaryText,
    getVirtualWindow, getLinePresentation, createFollowTimer, createLyricSpring,
    retargetLineSpring, stepLineSpring, isLyricSpringSettled, hasWordMotion, createLyricWordClock } from './lyricsTimeline.js';

const props = defineProps({
    lines: { type: Array, default: () => [] }, time: { type: Number, default: 0 },
    mode: { type: String, default: 'translation' }, fontFamily: { type: String, default: '' },
    reduceMotion: { type: Boolean, default: false }, highlightMode: { type: String, default: 'char' },
    windowVisible: { type: Boolean, default: true },
    playing: { type: Boolean, default: false }, playbackClock: { type: Function, default: null },
    showTranslation: { type: Boolean, default: true }, tips: { type: String, default: '' }
});
const emit = defineEmits(['seek']);
const viewport = ref(null), following = ref(true), scrollTop = ref(0), viewportHeight = ref(0);
const visualTime = ref(props.time), wordClockRunning = ref(false);
const measuredHeights = ref(new Map());
const rowElements = new Map();
const lineSprings = new Map();
let observer = null, alive = false, pointerHeld = false, generation = 0, followQueued = false, followInstant = false, measuredWidth = 0;
const isVisible = () => !document.hidden && props.windowVisible;
const rows = computed(() => buildLyricTimeline(props.lines));
const stageRows = computed(() => buildLyricStageRows(rows.value));
const sourceStageIndexes = computed(() => new Map(stageRows.value.filter(row => row.kind === 'line').map(row => [row.sourceIndex, row.index])));
const position = computed(() => resolveLyricPosition(rows.value, visualTime.value));
const followFocusIndex = computed(() => getLyricStageFocus(stageRows.value, position.value));
const activeStageIndex = computed(() => sourceStageIndexes.value.get(position.value.activeIndex) ?? -1);
const hasText = computed(() => rows.value.some(row => row.hasText));
const secondary = row => selectSecondaryText(row, props.mode, props.showTranslation);
const isGapActive = row => following.value && row.key === position.value.gap?.key;
const heights = computed(() => stageRows.value.map(row => measuredHeights.value.get(row.index) || (row.kind === 'gap' ? 72 : secondary(row) ? 128 : 96)));
const topPadding = computed(() => Math.max(0, viewportHeight.value * 0.43 - (heights.value[0] || 96) / 2));
const bottomPadding = computed(() => Math.max(0, viewportHeight.value * 0.57 - (heights.value.at(-1) || 96) / 2));
const windowed = computed(() => getVirtualWindow(heights.value, Math.max(0, scrollTop.value - topPadding.value), viewportHeight.value, 4));
const visibleRows = computed(() => stageRows.value.slice(windowed.value.start, windowed.value.end));
const focusIndex = computed(() => {
    if (following.value) return followFocusIndex.value;
    const center = Math.max(0, scrollTop.value + viewportHeight.value * 0.43 - topPadding.value);
    const offsets = windowed.value.offsets;
    const boundary = offsets.findIndex((offset, index) => index > 0 && offset > center);
    return Math.max(0, boundary < 0 ? stageRows.value.length - 1 : boundary - 1);
});
const presentation = index => {
    const value = getLinePresentation(index, focusIndex.value, props.reduceMotion);
    return { '--mico-line-opacity': value.opacity, '--mico-line-blur': `${value.blurPx}px`,
        '--mico-line-delay': `${value.delayMs}ms`, '--mico-line-shift': `${value.translateY}px`,
        '--mico-line-scale': !props.reduceMotion && index === activeStageIndex.value ? 1.03 : 1 };
};
const wordClock = createLyricWordClock({
    readTime: () => props.playbackClock ? props.playbackClock() : props.time,
    onTime: time => { visualTime.value = time; },
    requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: frame => window.cancelAnimationFrame(frame),
    canAnimate: () => alive && isVisible() && props.playing && typeof props.playbackClock === 'function'
        && props.highlightMode === 'char' && !props.reduceMotion
        && document.documentElement.getAttribute('data-mico-liquid-glass') === 'on',
    hasMotion: time => {
        const active = resolveLyricPosition(rows.value, time).activeIndex;
        return rowElements.has(sourceStageIndexes.value.get(active)) && hasWordMotion(rows.value[active], time);
    },
    onState: running => { wordClockRunning.value = running; }
});
const spring = createLyricSpring({
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frame => window.cancelAnimationFrame(frame),
    canAnimate: () => alive && isVisible() && following.value && !props.reduceMotion
        && document.documentElement.getAttribute('data-mico-liquid-glass') === 'on',
    onUpdate(state, { deltaSeconds, force }) {
        const element = viewport.value;
        if (!element || !alive) return false;
        element.scrollTop = state.position;
        scrollTop.value = element.scrollTop;
        element.setAttribute('data-mico-lyric-spring', state.running ? 'running' : 'idle');
        element.setAttribute('data-mico-lyric-spring-position', String(state.position));
        element.setAttribute('data-mico-lyric-spring-velocity', String(state.velocity));
        element.setAttribute('data-mico-lyric-spring-target', String(state.target));
        if (force) {
            lineSprings.clear();
            for (const row of rowElements.values()) row.style.setProperty('--mico-line-inertia', '0px');
            return false;
        }
        let moving = false;
        for (const index of lineSprings.keys()) if (!rowElements.has(index)) lineSprings.delete(index);
        for (const [index, row] of rowElements) {
            let line = lineSprings.get(index) || { position: state.position, velocity: state.velocity,
                target: state.position, pendingTarget: state.position, delaySeconds: 0 };
            if (line.pendingTarget !== state.target) {
                const delay = getLinePresentation(index, focusIndex.value).delayMs / 1000;
                line = retargetLineSpring(line, state.target, delay);
            }
            line = stepLineSpring(line, deltaSeconds);
            lineSprings.set(index, line);
            row.style.setProperty('--mico-line-inertia', `${Math.max(-90, Math.min(90, state.position - line.position))}px`);
            moving ||= line.delaySeconds > 0 || !isLyricSpringSettled(line, state.target);
        }
        return moving;
    }
});
const followTimer = createFollowTimer(() => {
    if (!alive || !isVisible() || pointerHeld) return;
    resumeFollow();
});
function cancelPendingFollow() { generation++; followQueued = false; followInstant = false; }
function requestFollow(instant = false) {
    if (!alive || !following.value || !isVisible()) return;
    followInstant ||= instant;
    if (followQueued) return;
    followQueued = true; const ticket = generation;
    nextTick(() => {
        if (ticket !== generation) return;
        followQueued = false; const immediate = followInstant; followInstant = false;
        const element = viewport.value;
        if (!alive || !element || !isVisible() || !following.value || followFocusIndex.value < 0) return;
        const index = followFocusIndex.value;
        const target = Math.max(0, topPadding.value + windowed.value.offsets[index] + heights.value[index] / 2 - element.clientHeight * 0.43);
        spring.moveTo(target, { immediate: immediate || props.reduceMotion, from: element.scrollTop });
    });
}
function measure() {
    if (!alive || !viewport.value || !isVisible()) return;
    const resized = viewportHeight.value !== viewport.value.clientHeight || measuredWidth !== viewport.value.clientWidth;
    viewportHeight.value = viewport.value.clientHeight;
    measuredWidth = viewport.value.clientWidth;
    const updated = new Map(measuredHeights.value); let changed = false;
    for (const [index, element] of rowElements) {
        // transform/scale 不参与布局测量，否则当前行的 1.03 会被误算为行高并反复改变目标。
        const height = element.offsetHeight;
        if (height > 0 && Math.abs((updated.get(index) || 0) - height) > 0.5) { updated.set(index, height); changed = true; }
    }
    if (changed) measuredHeights.value = updated;
    if (changed || resized) requestFollow();
}
function setRowElement(element, index) {
    const previous = rowElements.get(index);
    if (previous === element) return;
    if (previous) observer?.unobserve(previous);
    if (element) { rowElements.set(index, element); if (alive && isVisible()) observer?.observe(element); }
    else { rowElements.delete(index); lineSprings.delete(index); }
}
function connectObserver() {
    if (!observer || !viewport.value || !isVisible()) return;
    observer.observe(viewport.value);
    for (const element of rowElements.values()) observer.observe(element);
}
function beginBrowse() {
    if (!alive) return;
    following.value = false; cancelPendingFollow(); spring.stop(viewport.value?.scrollTop);
    if (isVisible() && !pointerHeld) followTimer.arm();
}
function onPointerDown(event) {
    if (!event.isPrimary || event.button !== 0 || event.target?.closest('.mico-lyric-resume')) return;
    pointerHeld = true; followTimer.cancel(); beginBrowse();
}
function onTouchStart() { pointerHeld = true; followTimer.cancel(); beginBrowse(); }
function onPointerRelease() {
    if (!pointerHeld) return;
    pointerHeld = false;
    if (!following.value && alive && isVisible()) followTimer.arm();
}
function onBrowseKey(event) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) beginBrowse();
}
function onScroll() {
    if (!alive || !viewport.value) return;
    scrollTop.value = viewport.value.scrollTop;
    if (!following.value && !pointerHeld && isVisible()) followTimer.arm();
}
function resumeFollow() {
    following.value = true; pointerHeld = false; followTimer.cancel(); requestFollow();
}
function seekRow(row) {
    const seconds = getSeekTime(row);
    if (seconds === null) return;
    emit('seek', seconds); resumeFollow();
}
function visibilityChanged() {
    if (!isVisible()) {
        followTimer.cancel(); cancelPendingFollow(); spring.stop(viewport.value?.scrollTop); wordClock.stop(); observer?.disconnect(); pointerHeld = false;
    } else {
        wordClock.sync(); connectObserver(); measure(); if (!following.value) followTimer.arm(); else requestFollow(true);
    }
}
watch(() => props.lines, () => {
    measuredHeights.value = new Map(); following.value = true; pointerHeld = false; followTimer.cancel();
    spring.stop(viewport.value?.scrollTop); wordClock.stop(); cancelPendingFollow();
    nextTick(() => { if (alive) { wordClock.sync(); measure(); requestFollow(true); } });
}, { flush: 'post' });
watch(() => followFocusIndex.value, () => requestFollow(), { flush: 'post' });
watch(() => props.time, (time, previous) => {
    if (!isVisible()) return;
    visualTime.value = time; wordClock.sync();
    if (Number.isFinite(previous) && (time < previous || time - previous > 1.5)) requestFollow(props.reduceMotion);
}, { flush: 'post' });
watch(() => [props.playing, props.highlightMode, props.playbackClock], () => {
    if (alive && isVisible()) wordClock.sync(); else wordClock.stop();
}, { flush: 'sync' });
watch(() => [windowed.value.start, windowed.value.end], () => {
    nextTick(() => { if (alive && isVisible()) wordClock.sync(); });
}, { flush: 'post' });
watch(() => [props.mode, props.showTranslation, props.fontFamily], () => {
    measuredHeights.value = new Map(); nextTick(() => { if (alive) measure(); });
}, { flush: 'post' });
watch(() => props.windowVisible, visibilityChanged, { flush: 'sync' });
watch(() => props.reduceMotion, () => {
    spring.stop(viewport.value?.scrollTop); wordClock.sync(); cancelPendingFollow(); requestFollow(props.reduceMotion);
}, { flush: 'sync' });
onMounted(() => {
    alive = true;
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(measure); connectObserver(); }
    else window.addEventListener('resize', measure);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pointerup', onPointerRelease, { passive: true });
    window.addEventListener('pointercancel', onPointerRelease, { passive: true });
    wordClock.sync(); measure(); requestFollow(true);
});
onBeforeUnmount(() => {
    alive = false; cancelPendingFollow(); followTimer.dispose(); spring.dispose(); wordClock.dispose(); lineSprings.clear();
    observer?.disconnect(); observer = null; rowElements.clear();
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('resize', measure);
    window.removeEventListener('pointerup', onPointerRelease);
    window.removeEventListener('pointercancel', onPointerRelease);
});
</script>
