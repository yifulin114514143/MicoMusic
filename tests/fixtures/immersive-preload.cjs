// 仅用于隔离验收：生产 preload + 源配置导出的引导状态 + 原生 Audio 构造观察。
// 不为业务组件暴露测试接口，也不创建替代 Audio。
require('../../electron/preload.cjs');
const { contextBridge, ipcRenderer } = require('electron');
for (const [key, value] of ipcRenderer.sendSync('immersive-initial-storage')) localStorage.setItem(key, value);
contextBridge.executeInMainWorld({ func: () => {
    window.__immersiveValidationIdentity = crypto.randomUUID();
    window.__immersiveValidationAudios = [];
    const OriginalAudio = window.Audio;
    window.Audio = new Proxy(OriginalAudio, {
        construct(target, args, newTarget) {
            const audio = Reflect.construct(target, args, newTarget);
            window.__immersiveValidationAudios.push(audio);
            return audio;
        }
    });
    // 观察清理；仅计 document/window 的非 once 监听，保留原生增删行为。
    const listeners = window.__immersiveValidationListeners = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if ((this === document || this === window) && listener && !options?.once &&
            !listeners.some(item => item.active && item.target === this && item.type === type && item.listener === listener && item.capture === capture(options))) {
            listeners.push({ target: this, type, listener, capture: capture(options), active: true });
        }
        return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        for (const item of listeners) if (item.target === this && item.type === type && item.listener === listener && item.capture === capture(options)) item.active = false;
        return originalRemove.call(this, type, listener, options);
    };
    const observers = window.__immersiveValidationObservers = [];
    for (const name of ['MutationObserver', 'IntersectionObserver', 'ResizeObserver']) {
        const Original = window[name];
        if (typeof Original !== 'function') continue;
        window[name] = new Proxy(Original, {
            construct(target, args, newTarget) {
                const observer = Reflect.construct(target, args, newTarget);
                const item = { name, active: false };
                observers.push(item);
                const observe = observer.observe.bind(observer), disconnect = observer.disconnect.bind(observer);
                observer.observe = (...values) => { item.active = true; return observe(...values); };
                observer.disconnect = () => { item.active = false; return disconnect(); };
                return observer;
            }
        });
    }
} });
