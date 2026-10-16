<template>
    <section ref="dialog" class="mico-immersive-player" role="dialog" aria-modal="true" aria-label="沉浸播放器" @keydown.capture="handleDialogKey"
        :data-mico-hero-phase="heroPhase" @pointerdown="onSwipeStart" @pointerup="onSwipeEnd" @pointercancel="swipeStart = null"
        :data-reduced-motion="reduceMotion ? 'true' : 'false'" :data-low-blur="lowBlur ? 'true' : 'false'"
        :data-mico-menu-placement="menuPlacement" :data-mico-menu-reserved="menuVisible && menuPlacement === 'lyrics-space' ? 'true' : 'false'"
        :style="{ '--mico-immersive-menu-album-shift': `${menuAlbumShift}px` }">
        <ImmersiveBackground :source="coverSource" :playing="playing" :reduce-motion="reduceMotion" :low-blur="lowBlur" :window-visible="windowVisible" />
        <button ref="closeButton" type="button" class="mico-immersive-close" aria-label="退出沉浸播放器" title="退出沉浸播放器（Esc）" @click="requestClose">
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
        </button>
        <div ref="albumElement" class="mico-immersive-album-pane">
            <div ref="coverElement" class="mico-immersive-cover">
                <img v-if="coverSource && !coverFailed" :key="coverSource" :src="coverSource" :alt="`${song.name || '歌曲'}封面`"
                    draggable="false" @error="coverFailed = true">
                <svg v-else class="mico-immersive-cover-fallback" viewBox="0 0 96 96" fill="none" aria-label="暂无封面" role="img">
                    <path d="M61 21v43M61 21l-29 7v43M32 40l29-7" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
                    <ellipse cx="24" cy="72" rx="10" ry="8" fill="currentColor" /><ellipse cx="53" cy="65" rx="10" ry="8" fill="currentColor" />
                </svg>
            </div>
            <div class="mico-immersive-song-row">
                <div class="mico-immersive-song-text">
                    <h1 class="mico-immersive-song-title" :title="song.name || ''">{{ song.name || '暂无播放歌曲' }}</h1>
                    <p class="mico-immersive-song-artist" :title="song.author || ''">{{ song.author || '选择一首歌曲开始播放' }}</p>
                </div>
                <div ref="menuAnchor" class="mico-immersive-menu-anchor" :data-mico-menu-phase="menuPhase">
                    <button ref="menuButton" type="button" class="mico-immersive-more" aria-label="更多播放选项" title="更多播放选项"
                        :aria-expanded="menuOpen" aria-controls="mico-immersive-options" @click="menuOpen = !menuOpen">
                        <i class="fas fa-ellipsis-h" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            <div class="mico-immersive-progress">
                <progress class="mico-immersive-progress-track" :max="safeDuration || 1" :value="displayTime" aria-hidden="true"></progress>
                <input class="mico-immersive-seek" type="range" min="0" :max="safeDuration" step="0.1" :value="displayTime" :disabled="safeDuration <= 0"
                    aria-label="歌曲播放进度" :aria-valuetext="`${formatTime(displayTime)}，共 ${formatTime(safeDuration)}`"
                    @input="previewSeek" @change="commitSeek" @pointercancel="seekPreview = null">
                <div class="mico-immersive-times"><span>{{ formatTime(displayTime) }}</span><span>{{ safeDuration > 0 ? `-${formatTime(Math.max(0, safeDuration - displayTime))}` : '0:00' }}</span></div>
            </div>
            <div class="mico-immersive-controls">
                <button type="button" class="mico-immersive-control mico-immersive-mode" :class="{ 'mico-immersive-control-active': playbackModeIndex === 0 }"
                    aria-label="随机播放" :aria-pressed="playbackModeIndex === 0" title="随机播放" @click="emit('playback-mode', playbackModeIndex === 0 ? 1 : 0)"><i class="fas fa-shuffle" aria-hidden="true"></i></button>
                <button type="button" class="mico-immersive-control" aria-label="上一首" title="上一首" @click="emit('previous')"><i class="fas fa-backward" aria-hidden="true"></i></button>
                <button type="button" class="mico-immersive-control mico-immersive-play" :aria-label="playing ? '暂停' : '播放'" :title="playing ? '暂停' : '播放'" @click="emit('toggle-play')"><i :class="playing ? 'fas fa-pause' : 'fas fa-play'" aria-hidden="true"></i></button>
                <button type="button" class="mico-immersive-control" aria-label="下一首" title="下一首" @click="emit('next')"><i class="fas fa-forward" aria-hidden="true"></i></button>
                <button type="button" class="mico-immersive-control mico-immersive-mode" :class="{ 'mico-immersive-control-active': playbackModeIndex === 1 || playbackModeIndex === 2 }"
                    :aria-label="playbackModeIndex === 2 ? '单曲循环，点击顺序播放' : playbackModeIndex === 1 ? '列表循环，点击单曲循环' : '循环关闭，点击列表循环'"
                    :title="playbackModeIndex === 2 ? '单曲循环' : playbackModeIndex === 1 ? '列表循环' : '循环关闭'" @click="cycleRepeat">
                    <i class="fas fa-repeat" aria-hidden="true"></i><sup v-if="playbackModeIndex === 2" class="mico-immersive-repeat-one">1</sup>
                </button>
            </div>
        </div>
        <div v-if="menuVisible" ref="menuElement" id="mico-immersive-options" class="mico-immersive-menu" aria-label="播放选项" :inert="menuPhase !== 'open' || undefined"
            :style="menuStyle" :data-mico-menu-content-phase="menuPhase === 'open' ? 'visible' : menuPhase === 'opening' ? 'revealing' : 'hidden'">
            <div ref="menuContent" class="mico-immersive-menu-content">
                <div class="mico-immersive-menu-actions">
                    <button type="button" class="mico-immersive-menu-action" :disabled="!song.hash" @click.stop="runAction('like')"><i class="fas fa-heart" aria-hidden="true"></i>喜欢这首歌</button>
                    <button type="button" class="mico-immersive-menu-action" :disabled="!song.hash" @click.stop="runAction('collect')"><i class="fas fa-plus" aria-hidden="true"></i>收藏到歌单</button>
                    <button type="button" class="mico-immersive-menu-action" @click.stop="runAction('queue')"><i class="fas fa-list" aria-hidden="true"></i>播放队列</button>
                    <button type="button" class="mico-immersive-menu-action" :disabled="!song.hash" @click.stop="runAction('share')"><i class="fas fa-share" aria-hidden="true"></i>分享歌曲</button>
                    <button type="button" class="mico-immersive-menu-action" @click.stop="runAction('desktop-lyrics')"><i class="fas fa-desktop" aria-hidden="true"></i>桌面歌词</button>
                </div>
                <label class="mico-immersive-menu-field"><span><i class="fas fa-volume-up" aria-hidden="true"></i>音量</span>
                    <input class="mico-immersive-volume-range" type="range" min="0" max="100" step="1" :value="safeVolume" aria-label="播放音量"
                        :aria-valuetext="`${Math.round(safeVolume)}%`" @input="emit('volume-change', Number($event.target.value))">
                    <output>{{ Math.round(safeVolume) }}%</output>
                </label>
                <label class="mico-immersive-menu-field"><span>播放速度</span>
                    <select :value="speed" aria-label="播放速度" @change="emit('playback-speed', Number($event.target.value))">
                        <option v-for="value in speeds" :key="value" :value="value">{{ value }}×</option>
                    </select>
                </label>
                <label class="mico-immersive-menu-field"><span>播放模式</span>
                    <select :value="playbackModeIndex" aria-label="播放模式" @change="emit('playback-mode', Number($event.target.value))">
                        <option :value="0">随机播放</option><option :value="1">列表循环</option><option :value="2">单曲循环</option><option :value="3">顺序播放</option>
                    </select>
                </label>
                <label v-if="qualityOptions.length" class="mico-immersive-menu-field"><span>音质</span>
                    <select :value="selectedQualityIndex" aria-label="歌曲音质" @change="changeQuality">
                        <option v-for="(option, index) in qualityOptions" :key="`${option.value}:${option.hash}`" :value="index">{{ option.label }}</option>
                    </select>
                </label>
                <label class="mico-immersive-menu-field"><span>显示翻译 / 音译</span><input type="checkbox" v-model="showTranslation"></label>
            </div>
        </div>
        <div ref="lyricsElement" class="mico-immersive-lyrics-pane" :inert="menuVisible && menuPlacement === 'lyrics-space' || undefined" :aria-hidden="menuVisible && menuPlacement === 'lyrics-space' || undefined">
            <LyricStage :lines="lyrics" :time="currentTime" :mode="lyricsMode" :font-family="fontFamily" :reduce-motion="reduceMotion"
                :highlight-mode="highlightMode" :show-translation="showTranslation" :tips="tips" :window-visible="windowVisible"
                :playing="playing" :playback-clock="playbackClock" @seek="emit('seek', $event)" />
        </div>
        <footer class="mico-immersive-footer"><span class="mico-immersive-brand">MicoMusic</span>
            <div class="mico-immersive-tools">
                <button type="button" class="mico-immersive-tool" :aria-label="lyricsMode === 'romanization' ? '切换为翻译' : '切换为音译'"
                    :title="lyricsMode === 'romanization' ? '切换为翻译' : '切换为音译'" @click="emit('lyrics-mode')"><i class="fas fa-language" aria-hidden="true"></i></button>
                <button type="button" class="mico-immersive-tool" aria-label="复制歌词" title="复制歌词" :disabled="!lyrics.length" @click="emit('copy-lyrics')"><i class="fas fa-quote-right" aria-hidden="true"></i></button>
            </div>
        </footer>
    </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ImmersiveBackground from './ImmersiveBackground.vue';
import LyricStage from './LyricStage.vue';
import { heroTransform, heroTransformStyle } from './heroGeometry.js';
import { immersiveMenuLayout, immersiveMenuMorph } from './menuGeometry.js';

const props = defineProps({
    song: { type: Object, default: () => ({}) }, currentTime: { type: Number, default: 0 }, duration: { type: Number, default: 0 },
    playing: { type: Boolean, default: false }, volume: { type: Number, default: 70 }, speed: { type: Number, default: 1 },
    playbackModeIndex: { type: Number, default: 3 }, lyrics: { type: Array, default: () => [] }, lyricsMode: { type: String, default: 'translation' },
    tips: { type: String, default: '' }, reduceMotion: { type: Boolean, default: false }, lowBlur: { type: Boolean, default: false }, windowVisible: { type: Boolean, default: true },
    fontFamily: { type: String, default: '' }, highlightMode: { type: String, default: 'char' }, originRect: { type: Object, default: null }, getOriginRect: { type: Function, default: null },
    playbackClock: { type: Function, default: null }
});
const emit = defineEmits(['close', 'toggle-play', 'previous', 'next', 'seek', 'volume-change', 'playback-mode', 'like', 'collect', 'queue', 'share', 'desktop-lyrics', 'lyrics-mode', 'copy-lyrics', 'playback-speed', 'quality-change']);
const coverFailed = ref(false);
const menuOpen = ref(false);
const menuVisible = ref(false);
const menuPhase = ref('closed');
const menuElement = ref(null);
const menuContent = ref(null);
const albumElement = ref(null);
const lyricsElement = ref(null);
const menuPlacement = ref('corridor');
const menuAlbumShift = ref(0);
const menuStyle = ref({});
const showTranslation = ref(true);
const menuAnchor = ref(null);
const menuButton = ref(null);
const dialog = ref(null);
const closeButton = ref(null);
const coverElement = ref(null);
const heroPhase = ref('opening');
let swipeStart = null;
let mounted = false;
let menuRevision = 0;
let heroRevision = 0;
const animations = new Set();
const heroAnimations = new Set();
const menuAnimations = new Set();
const albumAnimations = new Set();
const springEasing = 'cubic-bezier(0.31, 1.28, 0.32, 1.02)';
const menuEasing = 'cubic-bezier(0.22, 1.04, 0.36, 1)';
const motionAllowed = () => !props.reduceMotion && props.windowVisible && !document.hidden;
const animateElement = (element, frames, options, group = heroAnimations) => {
    if (!element || !motionAllowed() || typeof element.animate !== 'function') return Promise.resolve();
    const animation = element.animate(frames, { ...options, fill: 'both' });
    animations.add(animation);
    group.add(animation);
    const release = () => { animations.delete(animation); group.delete(animation); animation.cancel(); };
    // Hero 的短动画结束后仍需保留终态，直到整组结束或界面卸载。
    // 否则控件在180ms、背景在420ms重新出现，封面却仍在退场。
    return animation.finished.then(() => {}, release);
};
const cancelGroup = group => {
    for (const animation of group) { animations.delete(animation); animation.cancel(); }
    group.clear();
};
const settleAnimations = () => {
    for (const animation of animations) {
        try { animation.finish(); } catch { animation.cancel(); }
    }
};
const runHero = async (closing) => {
    const revision = ++heroRevision;
    const cover = coverElement.value;
    const background = dialog.value.querySelector('.mico-immersive-background');
    const fades = [...dialog.value.querySelectorAll('.mico-immersive-song-row, .mico-immersive-progress, .mico-immersive-controls, .mico-immersive-lyrics-pane, .mico-immersive-footer, .mico-immersive-close')];
    // 先读取当前画面，再取消旧动画；中途退出从已显示的位置返回小封面。
    const coverStart = closing ? { transform: getComputedStyle(cover).transform, borderRadius: getComputedStyle(cover).borderRadius } : null;
    const backgroundStart = closing ? getComputedStyle(background).opacity : 0;
    const fadeStarts = closing ? fades.map(element => {
        const style = getComputedStyle(element);
        return { opacity: style.opacity, transform: style.transform };
    }) : [];
    cancelGroup(heroAnimations);
    const measured = coverElement.value?.getBoundingClientRect();
    const origin = closing && props.getOriginRect ? props.getOriginRect() : props.originRect;
    const transform = heroTransformStyle(heroTransform(origin, measured));
    heroPhase.value = closing ? 'closing' : 'opening';
    await Promise.all([
        animateElement(cover, closing ? [coverStart, { transform, borderRadius: '8px' }] : [{ transform, borderRadius: '8px' }, { transform: 'none', borderRadius: '11px' }], { duration: 450, easing: springEasing }),
        animateElement(background, [{ opacity: backgroundStart }, { opacity: closing ? 0 : 1 }], { duration: closing ? 420 : 250, easing: 'ease' }),
        ...fades.map((element, index) => animateElement(element, closing ? [fadeStarts[index], { opacity: 0, transform: 'translateY(12px)' }] : [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: closing ? 180 : 350, delay: closing ? 0 : 70, easing: springEasing }))
    ]);
    if (!mounted || revision !== heroRevision) return;
    if (closing) emit('close');
    else { cancelGroup(heroAnimations); heroPhase.value = 'open'; }
};
const requestClose = () => {
    if (!mounted || heroPhase.value === 'closing') return;
    // 菜单正在移开专辑时，先冻结父节点的实测画面。
    // Hero 以此坐标返回小封面，避免父节点继续移动而把落点带偏。
    if (albumElement.value && albumAnimations.size) {
        albumElement.value.style.transform = getComputedStyle(albumElement.value).transform;
        cancelGroup(albumAnimations);
    }
    menuOpen.value = false;
    return runHero(true);
};
defineExpose({ requestClose });
const onSwipeStart = event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button, input, select, .mico-immersive-lyrics, .mico-immersive-cover, .mico-immersive-menu')) return;
    swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
};
const onSwipeEnd = event => {
    const start = swipeStart;
    swipeStart = null;
    if (!start || start.id !== event.pointerId) return;
    const dy = event.clientY - start.y;
    if (dy > 96 && Math.abs(event.clientX - start.x) < dy * 0.6) requestClose();
};
let previousFocus;
const seekPreview = ref(null);
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
const coverSource = computed(() => typeof props.song.img === 'string' ? props.song.img : '');
const safeDuration = computed(() => Number.isFinite(props.duration) ? Math.max(0, props.duration) : 0);
const safeVolume = computed(() => Number.isFinite(props.volume) ? Math.min(100, Math.max(0, props.volume)) : 0);
const displayTime = computed(() => Math.min(safeDuration.value, Math.max(0, seekPreview.value ?? (Number.isFinite(props.currentTime) ? props.currentTime : 0))));
const qualityOptions = computed(() => Array.isArray(props.song.qualityOptions) ? props.song.qualityOptions : []);
const selectedQualityIndex = computed(() => qualityOptions.value.findIndex((option) => props.song.resolvedQuality === option.value && props.song.playHash === option.hash));
const formatTime = (seconds) => {
    const total = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const previewSeek = (event) => { seekPreview.value = Math.min(safeDuration.value, Math.max(0, Number(event.target.value))); };
const commitSeek = (event) => { const value = Math.min(safeDuration.value, Math.max(0, Number(event.target.value))); seekPreview.value = null; emit('seek', value); };
const cycleRepeat = () => emit('playback-mode', props.playbackModeIndex === 1 ? 2 : props.playbackModeIndex === 2 ? 3 : 1);
const runAction = (action) => { menuOpen.value = false; emit(action); };
const changeQuality = (event) => {
    const option = qualityOptions.value[Number(event.target.value)];
    if (option) emit('quality-change', option);
};
const onOutsidePointer = (event) => {
    if (menuOpen.value && !menuAnchor.value?.contains(event.target) && !menuElement.value?.contains(event.target)) menuOpen.value = false;
};
const handleDialogKey = (event) => {
    if (event.code === 'Escape') {
        event.stopPropagation();
        if (menuOpen.value) { menuOpen.value = false; menuButton.value?.focus(); }
        else requestClose();
        return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(control => !control.closest('[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
};
const onGlobalTab = event => {
    if (event.key !== 'Tab' || document.activeElement !== document.body) return;
    const controls = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(control => !control.closest('[inert]'));
    event.preventDefault();
    (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
};
watch(coverSource, () => { coverFailed.value = false; });
watch(() => props.song.hash, () => { menuOpen.value = false; seekPreview.value = null; });
const positionMenu = async () => {
    const menu = menuElement.value;
    if (!menu || !dialog.value || !coverElement.value || !lyricsElement.value || !menuButton.value) return;
    const actualCover = coverElement.value.getBoundingClientRect();
    const baseCover = { x: actualCover.x - menuAlbumShift.value, y: actualCover.y, width: actualCover.width, height: actualCover.height };
    const style = getComputedStyle(menu);
    const contentHeight = menuContent.value.scrollHeight + ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
    const layout = immersiveMenuLayout({ viewport: dialog.value.getBoundingClientRect(), cover: baseCover, lyrics: lyricsElement.value.getBoundingClientRect(), button: menuButton.value.getBoundingClientRect(), contentHeight });
    if (!layout) return;
    menuPlacement.value = layout.placement;
    menuAlbumShift.value = layout.albumShift;
    await nextTick();
    if (!menuElement.value || !dialog.value) return;
    const viewport = dialog.value.getBoundingClientRect();
    menuStyle.value = { left: `${layout.rect.x - viewport.x}px`, top: `${layout.rect.y - viewport.y}px`, width: `${layout.rect.width}px`, height: `${layout.rect.height}px`, maxHeight: `${layout.rect.height}px` };
    await nextTick();
};
watch(menuOpen, async (open) => {
    const revision = ++menuRevision;
    const interrupted = menuAnimations.size > 0 && menuElement.value;
    const previousStyle = interrupted ? getComputedStyle(menuElement.value) : null;
    const start = previousStyle ? { transform: previousStyle.transform, opacity: previousStyle.opacity, borderRadius: previousStyle.borderRadius } : null;
    const previousContentStyle = interrupted ? getComputedStyle(menuContent.value) : null;
    const contentStart = previousContentStyle ? { opacity: previousContentStyle.opacity, transform: previousContentStyle.transform } : null;
    const menuBoundsStart = interrupted ? menuElement.value.getBoundingClientRect() : null;
    const albumStart = albumElement.value?.getBoundingClientRect();
    cancelGroup(menuAnimations);
    cancelGroup(albumAnimations);
    if (!open && menuElement.value?.contains(document.activeElement)) menuButton.value?.focus();
    if (open) menuVisible.value = true;
    await nextTick();
    if (!mounted || revision !== menuRevision || !menuElement.value) return;
    if (open) await positionMenu();
    else if (heroPhase.value === 'open') {
        const previousShift = menuAlbumShift.value;
        menuAlbumShift.value = 0;
        // 菜单是section直接子节点，布局基点单独同步到专辑返回后的空白区域。
        // 其translate动画随后保留当前全局位置，不依赖transformed ancestor。
        menuStyle.value = { ...menuStyle.value, left: `${menuElement.value.offsetLeft - previousShift}px` };
        await nextTick();
    }
    if (!mounted || revision !== menuRevision || !menuElement.value) return;
    menuPhase.value = open ? 'opening' : 'closing';
    const button = menuButton.value.getBoundingClientRect();
    const menu = menuElement.value.getBoundingClientRect();
    const morph = immersiveMenuMorph(button, menu);
    const corridorDrop = { transform: `translate(0px, ${button.y - menu.y}px) scale(${button.width / menu.width}, ${button.height / menu.height})`, borderRadius: morph.borderRadius, opacity: 1, offset: open ? 0.22 : 0.78 };
    const panelFrames = [start || (open ? { ...morph, opacity: 1 } : { transform: 'none', borderRadius: '24px', opacity: 1 })];
    // 首次展开先让小圆进入实测空白区，再向上展开，避免展开中段扫过封面。
    // 中断反转保留已经显示的真实形状，不能重新跳回这条起始路线。
    if (!interrupted) panelFrames.push(corridorDrop);
    panelFrames.push(open ? { transform: 'none', borderRadius: '24px', opacity: 1 } : { ...morph, opacity: 0 });
    const albumDestination = albumElement.value.getBoundingClientRect();
    const albumTranslation = albumStart.x - albumDestination.x;
    let menuTranslation = albumTranslation, menuTranslationY = 0;
    if (interrupted) {
        // 用保留的实际矩阵读一次新布局矩形，求真实画面的平移差；不解析CSS矩阵字符串。
        menuElement.value.style.transform = start.transform;
        const continuedBounds = menuElement.value.getBoundingClientRect();
        menuTranslation = menuBoundsStart.x - continuedBounds.x;
        menuTranslationY = menuBoundsStart.y - continuedBounds.y;
        menuElement.value.style.removeProperty('transform');
    }
    menuElement.value.style.transformOrigin = '0 0';
    await Promise.all([
        animateElement(menuElement.value, panelFrames, { duration: open ? 450 : 300, easing: menuEasing }, menuAnimations),
        animateElement(menuElement.value, [{ translate: `${menuTranslation}px ${menuTranslationY}px` }, { translate: '0px 0px' }], { duration: open ? 450 : 300, easing: menuEasing }, menuAnimations),
        animateElement(menuContent.value, [contentStart || (open ? { opacity: 0, transform: 'translateY(10px)' } : { opacity: 1, transform: 'none' }), open ? { opacity: 1, transform: 'none' } : { opacity: 0, transform: 'translateY(6px)' }], { duration: open ? 220 : 90, delay: open && !interrupted ? 160 : 0, easing: 'ease-out' }, menuAnimations),
        heroPhase.value === 'closing' ? Promise.resolve() : animateElement(albumElement.value, [{ transform: `translateX(${albumTranslation}px)` }, { transform: 'none' }], { duration: open ? 450 : 300, easing: menuEasing }, albumAnimations)
    ]);
    if (!mounted || revision !== menuRevision) return;
    menuPhase.value = open ? 'open' : 'closed';
    if (!open) menuVisible.value = false;
    cancelGroup(menuAnimations);
    cancelGroup(albumAnimations);
});
watch(() => props.reduceMotion || !props.windowVisible, (stop) => { if (stop) settleAnimations(); });
const onVisibility = () => { if (document.hidden) settleAnimations(); };
const onResize = async () => {
    if (heroPhase.value !== 'open' || menuAnimations.size) settleAnimations();
    await nextTick();
    if (menuOpen.value && mounted) await positionMenu();
};
onMounted(async () => {
    mounted = true;
    previousFocus = document.activeElement;
    closeButton.value?.focus();
    document.addEventListener('pointerdown', onOutsidePointer);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', onGlobalTab, true);
    window.addEventListener('resize', onResize);
    await nextTick();
    if (mounted && heroPhase.value === 'opening') runHero(false);
});
onBeforeUnmount(() => {
    mounted = false;
    heroRevision++;
    menuRevision++;
    for (const animation of animations) animation.cancel();
    animations.clear();
    heroAnimations.clear();
    menuAnimations.clear();
    albumAnimations.clear();
    document.removeEventListener('pointerdown', onOutsidePointer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onGlobalTab, true);
    window.removeEventListener('resize', onResize);
    if (dialog.value?.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus();
});
</script>
