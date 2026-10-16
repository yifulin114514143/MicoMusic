<template>
    <div class="mico-immersive-background" aria-hidden="true" :data-mico-fluid-source="cover"
        :data-mico-fluid-visible="windowVisible ? 'true' : 'false'"
        :data-motion="animate ? 'flow' : 'still'" :data-blur="lowBlur ? 'low' : 'normal'">
        <img v-if="cover && !failed" :key="cover" class="mico-immersive-background-fallback"
            :src="cover" alt="" draggable="false" @error="failed = true">
        <div class="mico-immersive-background-wash"></div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
    source: { type: String, default: '' },
    playing: { type: Boolean, default: false },
    reduceMotion: { type: Boolean, default: false },
    lowBlur: { type: Boolean, default: false },
    windowVisible: { type: Boolean, default: true }
});
const failed = ref(false);
const cover = computed(() => props.source);
// 此组件仅发布宿主播放/设置语义。GPU、可见性监听及观察器都属于可撤回插件。
const animate = computed(() => props.playing && props.windowVisible && !props.reduceMotion && !props.lowBlur);
watch(cover, () => { failed.value = false; });
</script>
