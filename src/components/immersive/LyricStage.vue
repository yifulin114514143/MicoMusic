<template>
    <section ref="viewport" class="mico-immersive-lyrics" :class="{ 'mico-lyrics-reduced': reduceMotion, 'mico-lyrics-browsing': !following }"
        :style="{ '--mico-lyric-font': fontFamily || 'inherit' }" :data-mico-lyric-phase="position.phase"
        :data-mico-lyric-following="String(following)" :data-mico-lyric-active="position.activeIndex"
        aria-label="歌词" tabindex="0" @scroll.passive="onScroll" @wheel.passive="beginBrowse"
        @pointerdown="onPointerDown" @touchstart.passive="onTouchStart" @touchmove.passive="beginBrowse" @touchend.passive="onPointerRelease"
        @keydown="onBrowseKey">
        <div v-if="hasText" class="mico-lyric-content">
            <div class="mico-lyric-spacer" aria-hidden="true" :style="{ height: `${windowed.top + topPadding}px` }"></div>
            <component :is="getSeekTime(row) === null ? 'div' : 'button'" v-for="row in visibleRows" :key="row.key"
                :ref="element => setRowElement(element, row.index)" class="mico-lyric-row"
                :class="{ 'mico-lyric-focused': row.index === focusIndex, 'mico-lyric-active': row.index === position.activeIndex }"
                :style="presentation(row.index)" :data-mico-lyric-index="row.index"
                :data-mico-lyric-timing="row.hasWordTiming ? 'word' : 'line'"
                :type="getSeekTime(row) === null ? undefined : 'button'" :title="getSeekTime(row) === null ? undefined : '从这一句播放'"
                @click="seekRow(row)">
                <span class="mico-lyric-primary">
                    <template v-if="row.hasWordTiming && highlightMode === 'char' && row.index === position.activeIndex">
                        <span v-for="(token, tokenIndex) in row.tokens" :key="tokenIndex" class="mico-lyric-token"
                            :style="{ '--mico-word-fill': `${getTokenProgress(token, time) * 100}%` }">
                            <span class="mico-lyric-token-base">{{ token.text }}</span>
                            <span class="mico-lyric-token-fill" aria-hidden="true">{{ token.text }}</span>
                        </span>
                    </template>
                    <template v-else>{{ row.text || '\u00a0' }}</template>
                </span>
                <span v-if="secondary(row)" class="mico-lyric-secondary">{{ secondary(row) }}</span>
            </component>
            <div class="mico-lyric-spacer" aria-hidden="true" :style="{ height: `${windowed.bottom + bottomPadding}px` }"></div>
        </div>
        <div v-else class="mico-lyric-empty" role="status">{{ tips || '暂无歌词' }}</div>
        <div v-if="following && ['prelude', 'interlude'].includes(position.phase)" class="mico-lyric-gap" role="status"
            :aria-label="position.phase === 'prelude' ? '前奏' : '间奏'"><span aria-hidden="true">● ● ●</span></div>
        <div v-if="!following && hasText" class="mico-lyric-resume-anchor">
            <button class="mico-lyric-resume" type="button" @click.stop="resumeFollow">回到正在播放</button>
        </div>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildLyricTimeline, resolveLyricPosition, getTokenProgress, getSeekTime, selectSecondaryText,
    getVirtualWindow, getLinePresentation, createFollowTimer } from './lyricsTimeline.js';

const props = defineProps({
    lines: { type: Array, default: () => [] }, time: { type: Number, default: 0 },
    mode: { type: String, default: 'translation' }, fontFamily: { type: String, default: '' },
    reduceMotion: { type: Boolean, default: false }, highlightMode: { type: String, default: 'char' },
    windowVisible: { type: Boolean, default: true },
    showTranslation: { type: Boolean, default: true }, tips: { type: String, default: '' }
});
const emit = defineEmits(['seek']);
const viewport = ref(null), following = ref(true), scrollTop = ref(0), viewportHeight = ref(0);
const measuredHeights = ref(new Map());
const rowElements = new Map();
let observer = null, alive = false, pointerHeld = false, generation = 0, followQueued = false, followInstant = false, measuredWidth = 0;
const isVisible = () => !document.hidden && props.windowVisible;
const rows = computed(() => buildLyricTimeline(props.lines));
const position = computed(() => resolveLyricPosition(rows.value, props.time));
const hasText = computed(() => rows.value.some(row => row.hasText));
const secondary = row => selectSecondaryText(row, props.mode, props.showTranslation);
const heights = computed(() => rows.value.map(row => measuredHeights.value.get(row.index) || (secondary(row) ? 128 : 96)));
const topPadding = computed(() => Math.max(0, viewportHeight.value * 0.43 - (heights.value[0] || 96) / 2));
const bottomPadding = computed(() => Math.max(0, viewportHeight.value * 0.57 - (heights.value.at(-1) || 96) / 2));
const windowed = computed(() => getVirtualWindow(heights.value, Math.max(0, scrollTop.value - topPadding.value), viewportHeight.value, 4));
const visibleRows = computed(() => rows.value.slice(windowed.value.start, windowed.value.end));
const focusIndex = computed(() => {
    if (following.value) return position.value.focusIndex;
    const center = Math.max(0, scrollTop.value + viewportHeight.value * 0.43 - topPadding.value);
    const offsets = windowed.value.offsets;
    const boundary = offsets.findIndex((offset, index) => index > 0 && offset > center);
    return Math.max(0, boundary < 0 ? rows.value.length - 1 : boundary - 1);
});
const presentation = index => {
    const value = getLinePresentation(index, focusIndex.value, props.reduceMotion);
    return { '--mico-line-opacity': value.opacity, '--mico-line-blur': `${value.blurPx}px`,
        '--mico-line-delay': `${value.delayMs}ms`, '--mico-line-shift': `${value.translateY}px` };
};
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
        if (!alive || !element || !isVisible() || !following.value || position.value.focusIndex < 0) return;
        const index = position.value.focusIndex;
        const target = Math.max(0, topPadding.value + windowed.value.offsets[index] + heights.value[index] / 2 - element.clientHeight * 0.43);
        if (Math.abs(element.scrollTop - target) < 0.75) return;
        element.scrollTo({ top: target, behavior: immediate || props.reduceMotion ? 'auto' : 'smooth' });
        scrollTop.value = element.scrollTop;
    });
}
function measure() {
    if (!alive || !viewport.value || !isVisible()) return;
    const resized = viewportHeight.value !== viewport.value.clientHeight || measuredWidth !== viewport.value.clientWidth;
    viewportHeight.value = viewport.value.clientHeight;
    measuredWidth = viewport.value.clientWidth;
    const updated = new Map(measuredHeights.value); let changed = false;
    for (const [index, element] of rowElements) {
        const height = element.getBoundingClientRect().height;
        if (height > 0 && Math.abs((updated.get(index) || 0) - height) > 0.5) { updated.set(index, height); changed = true; }
    }
    if (changed) measuredHeights.value = updated;
    if (changed || resized) requestFollow(resized);
}
function setRowElement(element, index) {
    const previous = rowElements.get(index);
    if (previous === element) return;
    if (previous) observer?.unobserve(previous);
    if (element) { rowElements.set(index, element); if (alive && isVisible()) observer?.observe(element); }
    else rowElements.delete(index);
}
function connectObserver() {
    if (!observer || !viewport.value || !isVisible()) return;
    observer.observe(viewport.value);
    for (const element of rowElements.values()) observer.observe(element);
}
function beginBrowse() {
    if (!alive) return;
    following.value = false; cancelPendingFollow();
    if (isVisible() && !pointerHeld) followTimer.arm();
}
function onPointerDown(event) {
    if (event.target?.closest('.mico-lyric-resume')) return;
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
    if (!isVisible()) { followTimer.cancel(); cancelPendingFollow(); observer?.disconnect(); pointerHeld = false; }
    else { connectObserver(); measure(); if (!following.value) followTimer.arm(); }
}
watch(() => props.lines, () => {
    measuredHeights.value = new Map(); following.value = true; pointerHeld = false; followTimer.cancel();
    cancelPendingFollow(); nextTick(() => { if (alive) { measure(); requestFollow(true); } });
}, { flush: 'post' });
watch(() => position.value.focusIndex, () => requestFollow(), { flush: 'post' });
watch(() => props.time, (time, previous) => {
    if (Number.isFinite(previous) && (time < previous || time - previous > 1.5)) requestFollow(true);
}, { flush: 'post' });
watch(() => [props.mode, props.showTranslation, props.fontFamily], () => {
    measuredHeights.value = new Map(); nextTick(() => { if (alive) measure(); });
}, { flush: 'post' });
watch(() => props.windowVisible, visibilityChanged, { flush: 'sync' });
onMounted(() => {
    alive = true;
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(measure); connectObserver(); }
    else window.addEventListener('resize', measure);
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pointerup', onPointerRelease, { passive: true });
    window.addEventListener('pointercancel', onPointerRelease, { passive: true });
    measure(); requestFollow(true);
});
onBeforeUnmount(() => {
    alive = false; cancelPendingFollow(); followTimer.dispose(); observer?.disconnect(); observer = null; rowElements.clear();
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('resize', measure);
    window.removeEventListener('pointerup', onPointerRelease);
    window.removeEventListener('pointercancel', onPointerRelease);
});
</script>
