// 仅用于隔离验收：生产 preload + 源配置导出的引导状态 + 原生 Audio 构造观察。
// 不为业务组件暴露测试接口，也不创建替代 Audio。
require('../../electron/preload.cjs');
const { contextBridge, ipcRenderer } = require('electron');
for (const [key, value] of ipcRenderer.sendSync('immersive-initial-storage')) localStorage.setItem(key, value);
function installImmersiveObservers(pluginWorld = false) {
    if (window.__immersiveValidationObserversInstalled) return;
    window.__immersiveValidationObserversInstalled = true;
    window.__immersiveValidationIdentity = crypto.randomUUID();
    window.__immersiveValidationAudios = [];
    window.__immersiveValidationPauseCalls = [];
    window.__immersiveValidationClipboardWrites = [];
    if (!pluginWorld && navigator.clipboard) {
        // 验证生产复制函数写入的原文本，不更改用户系统剪贴板。
        navigator.clipboard.writeText = async text => { window.__immersiveValidationClipboardWrites.push(String(text)); };
    }
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (...args) {
        window.__immersiveValidationPauseCalls.push({ time:this.currentTime, stack:new Error('原生pause调用观察').stack });
        return originalPause.apply(this,args);
    };
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
    window.__immersiveValidationInputEvents = [];
    if (!pluginWorld) for (const type of ['keydown','click','pointerdown','pointerup']) originalAdd.call(document,type,event=>{
        const node=event.target;
        window.__immersiveValidationInputEvents.push({type,code:event.code || null,isTrusted:event.isTrusted,
            x:event.clientX ?? null,y:event.clientY ?? null,time:performance.now(),audioTime:window.__immersiveValidationAudios[0]?.currentTime,
            target:{tag:node?.tagName,id:node?.id,class:typeof node?.className==='string'?node.className:null,label:node?.getAttribute?.('aria-label')}});
    },true);
    const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if ((this === document || this === window || this instanceof HTMLCanvasElement) && listener && !options?.once &&
            !listeners.some(item => item.active && item.target === this && item.type === type && item.listener === listener && item.capture === capture(options))) {
            listeners.push({ target: this, type, listener, capture: capture(options), active: true });
        }
        return originalAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        for (const item of listeners) if (item.target === this && item.type === type && item.listener === listener && item.capture === capture(options)) {
            item.active = false; item.target = null; item.listener = null;
        }
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
    // 原生 RAF 的待执行数量；执行前移除，避免把历史调用数误当泄漏。
    const raf = window.__immersiveValidationRAF = { pending: new Set(), requested: 0, completed: 0, cancelled: 0 };
    const requestFrame = window.requestAnimationFrame.bind(window), cancelFrame = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
        raf.requested++;
        const handle = requestFrame(time => { raf.pending.delete(handle); raf.completed++; callback(time); });
        raf.pending.add(handle); return handle;
    };
    window.cancelAnimationFrame = handle => { if (raf.pending.delete(handle)) raf.cancelled++; return cancelFrame(handle); };
    window.__immersiveValidationLyricScrollCalls = [];
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (...args) {
        if (this.matches?.('.mico-immersive-lyrics')) window.__immersiveValidationLyricScrollCalls.push({ args, time: performance.now() });
        return scrollTo.call(this, ...args);
    };
    // 仅观察实际 WebGL 调用，保留原生返回值、shader、上下文和播放实现。
    const contexts = window.__immersiveValidationGL = [];
    const contextRecords = new WeakMap(), resourceRecords = new WeakMap(), uniformNames = new WeakMap();
    const resourceMethods = {
        createShader: ['shaders', true], deleteShader: ['shaders', false],
        createProgram: ['programs', true], deleteProgram: ['programs', false],
        createBuffer: ['buffers', true], deleteBuffer: ['buffers', false],
        createTexture: ['textures', true], deleteTexture: ['textures', false],
        createFramebuffer: ['framebuffers', true], deleteFramebuffer: ['framebuffers', false],
        createRenderbuffer: ['renderbuffers', true], deleteRenderbuffer: ['renderbuffers', false]
    };
    const recordContext = (gl, canvas, type) => {
        let record = contextRecords.get(gl);
        if (record) return record;
        record = { id: contexts.length + 1, type, canvas: new WeakRef(canvas), context: new WeakRef(gl),
            creates: {}, deletes: {}, active: {}, compiles: [], links: [], draws: 0, losses: 0, restores: 0, paletteUniform: null };
        contexts.push(record); contextRecords.set(gl, record);
        originalAdd.call(canvas, 'webglcontextlost', () => {
            record.losses++;
            for (const key of Object.keys(record.active)) record.active[key] = 0;
        });
        originalAdd.call(canvas, 'webglcontextrestored', () => { record.restores++; });
        return record;
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        const value = getContext.call(this, type, ...args);
        if (value && ['webgl', 'experimental-webgl', 'webgl2'].includes(type)) recordContext(value, this, type);
        return value;
    };
    for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        const prototype = window[name]?.prototype;
        if (!prototype) continue;
        for (const method of [...Object.keys(resourceMethods), 'compileShader', 'linkProgram', 'drawArrays', 'drawElements', 'getUniformLocation', 'uniform3fv']) {
            if (!Object.prototype.hasOwnProperty.call(prototype, method) || typeof prototype[method] !== 'function') continue;
            const original = prototype[method];
            prototype[method] = function (...args) {
                const value = original.call(this, ...args), record = contextRecords.get(this);
                if (!record) return value;
                const resource = resourceMethods[method];
                if (resource) {
                    const [kind, creating] = resource;
                    if (creating && value) {
                        record.creates[kind] = (record.creates[kind] || 0) + 1;
                        record.active[kind] = (record.active[kind] || 0) + 1;
                        resourceRecords.set(value, { record, kind, active: true });
                    } else if (!creating && args[0]) {
                        record.deletes[kind] = (record.deletes[kind] || 0) + 1;
                        const item = resourceRecords.get(args[0]);
                        if (item?.active) { item.active = false; record.active[kind] = Math.max(0, (record.active[kind] || 0) - 1); }
                    }
                } else if (method === 'getUniformLocation') {
                    if (value) uniformNames.set(value, args[1]);
                } else if (method === 'uniform3fv') {
                    if (uniformNames.get(args[0]) === 'u_colors[0]') record.paletteUniform = Array.from(args[1]);
                } else if (method === 'compileShader') {
                    record.compiles.push({ success: this.getShaderParameter(args[0], this.COMPILE_STATUS), info: this.getShaderInfoLog(args[0]) });
                } else if (method === 'linkProgram') {
                    record.links.push({ success: this.getProgramParameter(args[0], this.LINK_STATUS), info: this.getProgramInfoLog(args[0]) });
                } else {
                    record.draws++;
                    // 自然 draw 后读取最终 framebuffer；不主动重画，也不改 uniforms。
                    const request = window.__immersiveValidationReadback?.request;
                    if (request && !window.__immersiveValidationReadback.result && !window.__immersiveValidationReadback.pending && this.getParameter(this.FRAMEBUFFER_BINDING) === null &&
                        record.canvas.deref()?.id === request.canvasId) {
                        // 此帧的 copy 之后还有玻璃 draw；微任务在整次自然绘制完成后读回。
                        // 不主动重画、修改 uniforms 或改变 framebuffer。
                        window.__immersiveValidationReadback.pending = true;
                        queueMicrotask(() => {
                            const canvas = record.canvas.deref();
                            if (!canvas || this.isContextLost()) return;
                            const css = document.querySelector('.mico-immersive-background')?.getBoundingClientRect() || canvas.getBoundingClientRect();
                            const scaleX = this.drawingBufferWidth / css.width, scaleY = this.drawingBufferHeight / css.height;
                            const regions = request.regions.map(region => {
                                const x = Math.max(0, Math.round((region.x - css.x) * scaleX));
                                const width = Math.max(1, Math.min(Math.round(region.width * scaleX), this.drawingBufferWidth - x));
                                const height = Math.max(1, Math.min(Math.round(region.height * scaleY), this.drawingBufferHeight));
                                const y = Math.max(0, this.drawingBufferHeight - Math.round((region.y - css.y) * scaleY) - height);
                                const pixels = new Uint8Array(width * height * 4);
                                this.readPixels(x, y, width, height, this.RGBA, this.UNSIGNED_BYTE, pixels);
                                return { name: region.name, x, y, width, height, pixels: Array.from(pixels) };
                            });
                            const result = window.__immersiveValidationReadback.result = { contextId: record.id, draws: record.draws, regions };
                            if (pluginWorld) document.documentElement.setAttribute('data-mico-validation-gl-readback', JSON.stringify(result));
                        });
                    }
                }
                return value;
            };
        }
    }
    window.__immersiveValidationFluidDisposals = [];
    originalAdd.call(document, 'mico-fluid-diagnostics', event => {
        window.__immersiveValidationFluidDisposals.push(typeof event.detail === 'string' ? JSON.parse(event.detail) : JSON.parse(JSON.stringify(event.detail)));
    });
    if (pluginWorld) {
        const publish = () => document.documentElement.setAttribute('data-mico-validation-plugin-observation', JSON.stringify({
            listeners: listeners.filter(item => item.active).length,
            observers: observers.filter(item => item.active).length,
            pendingRAF: raf.pending.size,
            gl: contexts.map(record => ({ id: record.id, type: record.type, canvasId: record.canvas.deref()?.id,
                creates: record.creates, deletes: record.deletes, active: record.active, compiles: record.compiles, links: record.links,
                draws: record.draws, losses: record.losses, restores: record.restores, paletteUniform: record.paletteUniform }))
        }));
        originalAdd.call(document, 'mico-validation-observation-request', publish);
        originalAdd.call(document, 'mico-validation-readback-request', () => {
            const request = JSON.parse(document.documentElement.getAttribute('data-mico-validation-gl-request') || 'null');
            window.__immersiveValidationReadback = { request, result: null, pending: false };
        });
        publish();
    }
}
contextBridge.executeInMainWorld({ func: installImmersiveObservers });
