// 本文件的键和字段是插件自己定义的配置协议，不读取或改写宿主设置。
(() => {
    const defaults = Object.freeze({ version: 1, enabled: true, theme: 'auto', reduceMotion: false, lowBlur: false });
    const normalize = (input) => {
        const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        return {
            version: 1,
            enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
            theme: ['auto', 'light', 'dark'].includes(value.theme) ? value.theme : defaults.theme,
            reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : defaults.reduceMotion,
            lowBlur: typeof value.lowBlur === 'boolean' ? value.lowBlur : defaults.lowBlur
        };
    };
    globalThis.MicoLiquidGlassSettings = Object.freeze({ key: 'micoLiquidGlassSettings', defaults, normalize });
})();
