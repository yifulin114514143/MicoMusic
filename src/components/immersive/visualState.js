import { reactive, onMounted, onUnmounted } from 'vue';

// 本适配只读取阶段三正式插件的精确 DOM 契约；它不启用插件、不写插件配置。
export function readImmersiveVisualState(root) {
    return {
        enabled: root?.getAttribute('data-mico-liquid-glass') === 'on',
        reduceMotion: root?.getAttribute('data-mico-liquid-glass-motion') === 'reduced',
        lowBlur: root?.getAttribute('data-mico-liquid-glass-blur') === 'low',
        windowVisible: root?.getAttribute('data-mico-window-visible') !== 'false'
    };
}

export function useImmersiveVisualState() {
    const state = reactive(readImmersiveVisualState(document.documentElement));
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let observer;
    const sync = () => {
        Object.assign(state, readImmersiveVisualState(document.documentElement));
        state.reduceMotion ||= motionPreference.matches;
    };
    onMounted(() => {
        sync();
        observer = new MutationObserver(sync);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-mico-liquid-glass', 'data-mico-liquid-glass-motion', 'data-mico-liquid-glass-blur', 'data-mico-window-visible']
        });
        motionPreference.addEventListener('change', sync);
    });
    onUnmounted(() => {
        observer?.disconnect();
        motionPreference.removeEventListener('change', sync);
    });
    return state;
}
