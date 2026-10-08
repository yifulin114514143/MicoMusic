<template>
    <div ref="surface" class="mico-immersive-background" aria-hidden="true"
        :data-motion="animate ? 'flow' : 'still'" :data-blur="lowBlur ? 'low' : 'normal'">
        <img v-if="cover && !failed" :key="`${cover}:first`" class="mico-immersive-background-layer mico-immersive-background-layer-one"
            :src="cover" alt="" draggable="false" @error="failed = true">
        <img v-if="cover && !failed && !lowBlur" :key="`${cover}:second`" class="mico-immersive-background-layer mico-immersive-background-layer-two"
            :src="cover" alt="" draggable="false" @error="failed = true">
        <div class="mico-immersive-background-wash"></div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    source: { type: String, default: '' },
    playing: { type: Boolean, default: false },
    reduceMotion: { type: Boolean, default: false },
    lowBlur: { type: Boolean, default: false },
    windowVisible: { type: Boolean, default: true }
});
const surface = ref(null);
const failed = ref(false);
const documentVisible = ref(!document.hidden);
const inViewport = ref(true);
const cover = computed(() => props.source);
const animate = computed(() => props.playing && props.windowVisible && documentVisible.value && inViewport.value && !props.reduceMotion && !props.lowBlur);
let observer;
let mounted = false;
const onVisibility = () => { documentVisible.value = !document.hidden; };
watch(cover, () => { failed.value = false; });

onMounted(() => {
    mounted = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver((entries) => {
            if (mounted) inViewport.value = entries.some((entry) => entry.isIntersecting);
        });
        observer.observe(surface.value);
    }
});
onBeforeUnmount(() => {
    mounted = false;
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener('visibilitychange', onVisibility);
});
</script>
