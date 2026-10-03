chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'phase2-audit-ping') respond({ serviceWorker: true });
});
