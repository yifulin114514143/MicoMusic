const render = () => chrome.storage.local.get('phase2VisualSettings', (stored) => {
    document.querySelector('#phase2-result').textContent = JSON.stringify(stored);
    document.body.setAttribute('data-phase2-popup', JSON.stringify({
        settings: stored.phase2VisualSettings || null,
        electronAPI: typeof window.electronAPI,
        electron: typeof window.electron,
        require: typeof require
    }));
});
for (const [id, enabled] of [['phase2-off', false], ['phase2-on', true]]) {
    document.getElementById(id).addEventListener('click', () => {
        chrome.storage.local.set({ phase2VisualSettings: { enabled, proof: 'popup' } }, render);
    });
}
chrome.storage.onChanged.addListener(render);
render();
