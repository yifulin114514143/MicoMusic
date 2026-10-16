// 所有 phase2 名称均为本探针新定义的标记，不是宿主已有 API。
(() => {
    const root = document.documentElement;
    const previous = JSON.parse(root.getAttribute('data-phase2-probe') || 'null');
    const state = {
        documentRuns: (previous?.documentRuns || 0) + 1,
        hashEvents: 0,
        mutationBatches: 0,
        electronInContentWorld: typeof window.electron,
        electronAPIInContentWorld: typeof window.electronAPI,
        localStorageAvailable: typeof localStorage,
        extensionId: chrome.runtime.id,
        settings: null,
        error: null,
        worker: null
    };
    const publish = () => root.setAttribute('data-phase2-probe', JSON.stringify(state));
    const apply = (settings) => {
        state.settings = settings;
        root.setAttribute('data-phase2-visual', settings.enabled ? 'on' : 'off');
        publish();
    };
    const observer = new MutationObserver(() => {
        state.mutationBatches++;
        publish();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => { state.hashEvents++; publish(); });
    window.addEventListener('phase2-audit-command', (event) => {
        const settings = JSON.parse(event.detail);
        chrome.storage.local.set({ phase2VisualSettings: settings }, () => {
            state.error = chrome.runtime.lastError?.message || null;
            apply(settings);
        });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.phase2VisualSettings) apply(changes.phase2VisualSettings.newValue);
    });
    chrome.storage.local.get('phase2VisualSettings', (stored) => {
        state.error = chrome.runtime.lastError?.message || null;
        apply(stored.phase2VisualSettings || { enabled: true, proof: 'initial' });
    });
    chrome.runtime.sendMessage({ type: 'phase2-audit-ping' }, (response) => {
        state.worker = response || { error: chrome.runtime.lastError?.message || '没有响应' };
        publish();
    });
})();
