(() => {
    'use strict';
    const singletonKey = '__micoLiquidGlassRuntime';
    globalThis[singletonKey]?.dispose();
    const extensionId = chrome.runtime.id;
    const config = globalThis.MicoLiquidGlassSettings;
    const root = document.documentElement;
    root.removeAttribute('data-mico-visual-ready');
    const markerNames = ['data-mico-liquid-glass', 'data-mico-liquid-glass-theme', 'data-mico-liquid-glass-motion', 'data-mico-liquid-glass-blur'];
    const abortController = new AbortController();
    let disposed = false;
    let css = null;
    let style = null;
    let settings = config.normalize();
    let settingsRevision = 0;

    const clearMaterial = () => {
        style?.remove();
        style = null;
        for (const name of markerNames) root.removeAttribute(name);
    };
    const render = () => {
        if (disposed) return;
        if (css !== null) root.setAttribute('data-mico-visual-ready', JSON.stringify({ extensionId, enabled: settings.enabled, success: true }));
        if (!settings.enabled || css === null) {
            clearMaterial();
            return;
        }
        if (!style) {
            style = document.createElement('style');
            style.id = 'mico-liquid-glass-style';
            style.textContent = css;
            root.appendChild(style);
        }
        root.setAttribute('data-mico-liquid-glass', 'on');
        root.setAttribute('data-mico-liquid-glass-theme', settings.theme);
        root.setAttribute('data-mico-liquid-glass-motion', settings.reduceMotion ? 'reduced' : 'normal');
        root.setAttribute('data-mico-liquid-glass-blur', settings.lowBlur ? 'low' : 'normal');
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearMaterial();
        root.removeAttribute('data-mico-visual-ready');
        abortController.abort();
        document.removeEventListener('mico-visual-lifecycle', onLifecycle);
        window.removeEventListener('pagehide', onPageHide);
        chrome.storage.onChanged.removeListener(onSettingsChanged);
        if (globalThis[singletonKey] === runtime) delete globalThis[singletonKey];
    };
    const onLifecycle = (event) => {
        let command;
        try {
            if (typeof event.detail !== 'string') return;
            command = JSON.parse(event.detail);
        } catch { return; }
        if (command?.extensionId !== extensionId || command.action !== 'dispose' || typeof command.token !== 'string' || !command.token) return;
        dispose();
        root.setAttribute('data-mico-visual-ack', JSON.stringify({ extensionId, token: command.token, success: true }));
    };
    const onPageHide = () => dispose();
    const onSettingsChanged = (changes, area) => {
        if (disposed || area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, config.key)) return;
        settingsRevision++;
        settings = config.normalize(changes[config.key].newValue);
        render();
    };
    const runtime = Object.freeze({ extensionId, dispose });
    globalThis[singletonKey] = runtime;
    document.addEventListener('mico-visual-lifecycle', onLifecycle);
    window.addEventListener('pagehide', onPageHide);
    chrome.storage.onChanged.addListener(onSettingsChanged);

    // 在默认配置读取完成前不创建样式，避免已关闭用户首屏出现材质闪动。
    // 材质由一个可撤回的 style 承载，manifest 不注入永久 CSS。
    const loadSettings = new Promise((resolve, reject) => {
        chrome.storage.local.get(config.key, (stored) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(config.normalize(stored[config.key]));
        });
    });
    const loadStyle = fetch(chrome.runtime.getURL('glass.css'), { signal: abortController.signal }).then((response) => {
        if (!response.ok) throw new Error(`材质资源加载失败 (${response.status})`);
        return response.text();
    });
    Promise.all([loadSettings, loadStyle]).then(([storedSettings, stylesheet]) => {
        if (disposed) return;
        if (settingsRevision === 0) settings = storedSettings;
        css = stylesheet;
        render();
    }).catch((error) => {
        if (disposed) return;
        dispose();
        root.setAttribute('data-mico-visual-ready', JSON.stringify({ extensionId, success: false, error: error.message }));
        console.error('[MicoMusic 液态玻璃] 已返回基础界面：', error.message);
    });
})();
