(() => {
    const config = globalThis.MicoLiquidGlassSettings;
    const form = document.getElementById('glass-settings');
    const status = document.getElementById('status');
    const controls = Object.fromEntries(['enabled', 'theme', 'reduceMotion', 'lowBlur'].map((name) => [name, document.getElementById(name)]));
    let ready = false;
    for (const control of Object.values(controls)) control.disabled = true;
    const render = (value) => {
        const settings = config.normalize(value);
        controls.enabled.checked = settings.enabled;
        controls.theme.value = settings.theme;
        controls.reduceMotion.checked = settings.reduceMotion;
        controls.lowBlur.checked = settings.lowBlur;
    };
    const changed = (changes, area) => {
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, config.key)) render(changes[config.key].newValue);
    };
    chrome.storage.onChanged.addListener(changed);
    window.addEventListener('pagehide', () => chrome.storage.onChanged.removeListener(changed), { once: true });
    chrome.storage.local.get(config.key, (stored) => {
        const error = chrome.runtime.lastError;
        if (error) { status.textContent = `读取失败：${error.message}`; return; }
        render(stored[config.key]);
        ready = true;
        for (const control of Object.values(controls)) control.disabled = false;
        status.textContent = '修改后即时保存';
    });
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('change', () => {
        if (!ready) return;
        const settings = config.normalize({
            enabled: controls.enabled.checked,
            theme: controls.theme.value,
            reduceMotion: controls.reduceMotion.checked,
            lowBlur: controls.lowBlur.checked
        });
        chrome.storage.local.set({ [config.key]: settings }, () => {
            const error = chrome.runtime.lastError;
            status.textContent = error ? `保存失败：${error.message}` : settings.enabled ? '已保存，材质已启用' : '已保存，已恢复基础界面';
        });
    });
})();
