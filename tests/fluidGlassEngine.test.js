import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const plugin = new URL('../plugins/extensions/mico-liquid-glass/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, plugin), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await new Promise(setImmediate); };

class Events {
    listeners = new Map();
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); }
    get count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
class Element extends Events {
    attributes = new Map(); children = []; width = 800; height = 600; left = 0; top = 0;
    style = { visibility: 'visible', display: 'block', borderTopLeftRadius: '18px', opacity: '1' };
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(node) { this.children.push(node); node.parent = this; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    getBoundingClientRect() { return { width: this.width, height: this.height, left: this.left, top: this.top }; }
    get offsetWidth() { return this.width; }
    get offsetHeight() { return this.height; }
    get parentElement() { return this.parent || null; }
}
function fakeGl(faults) {
    const live = new Set(); let id = 0;
    const gl = { live, calls: [], lost: 0, draws: 0,
        VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
        ARRAY_BUFFER: 5, STATIC_DRAW: 6, TEXTURE_2D: 7, TEXTURE_MIN_FILTER: 8, TEXTURE_MAG_FILTER: 9,
        LINEAR: 10, TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12, CLAMP_TO_EDGE: 13, RGBA: 14,
        UNSIGNED_BYTE: 15, FRAMEBUFFER: 16, COLOR_ATTACHMENT0: 17, FRAMEBUFFER_COMPLETE: 18,
        SCISSOR_TEST: 19, BLEND: 20, TEXTURE0: 21, TRIANGLES: 22, SRC_ALPHA: 23, ONE_MINUS_SRC_ALPHA: 24, FLOAT: 25,
        UNPACK_FLIP_Y_WEBGL: 26, COLOR_BUFFER_BIT: 27, ONE: 28,
        getShaderParameter: () => !faults.compile,
        getProgramParameter: () => !faults.link,
        getShaderInfoLog: () => 'shader rejected', getProgramInfoLog: () => 'link rejected',
        getAttribLocation: () => 0, getUniformLocation: (_program, name) => name,
        checkFramebufferStatus: () => faults.framebuffer ? 0 : gl.FRAMEBUFFER_COMPLETE,
        getExtension: name => name === 'WEBGL_lose_context' ? { loseContext() { gl.lost++; } } : null,
        drawArrays() { assert.ok(live.size > 0, 'draw requires allocated resources'); gl.draws++; gl.calls.push(['drawArrays']); }
    };
    for (const kind of ['Shader', 'Program', 'Buffer', 'Texture', 'Framebuffer']) {
        gl[`create${kind}`] = () => { if (faults.allocate === kind) return null; const resource = { id: ++id, kind }; live.add(resource); return resource; };
        gl[`delete${kind}`] = resource => { assert.equal(live.delete(resource), true, 'delete only live owned resources'); gl.calls.push(['delete', kind]); };
    }
    for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'bindBuffer', 'bufferData',
        'bindTexture', 'texParameteri', 'texImage2D', 'bindFramebuffer', 'framebufferTexture2D', 'useProgram',
        'enableVertexAttribArray', 'vertexAttribPointer', 'uniform1f', 'uniform1i', 'uniform2fv', 'uniform3fv', 'uniform4fv',
        'disable', 'enable', 'viewport', 'activeTexture', 'blendFunc', 'blendFuncSeparate', 'scissor', 'pixelStorei', 'clearColor', 'clear']) gl[name] = (...args) => gl.calls.push([name, ...args]);
    const upload = gl.texImage2D;
    gl.texImage2D = (...args) => { if (faults.upload && args.length === 6) throw new DOMException('cover denied', 'SecurityError'); upload(...args); };
    return gl;
}
function harness({ visible = true, flow = true, faults = {}, source = '' } = {}) {
    const document = new Events(); document.documentElement = new Element(); document.hidden = !visible;
    const target = new Element(); target.setAttribute('data-motion', flow ? 'flow' : 'still'); target.setAttribute('data-mico-fluid-source', source);
    const player = new Element(); const anchor = new Element(); anchor.setAttribute('data-mico-menu-phase', 'closed');
    player.querySelector = selector => selector === '.mico-immersive-menu-anchor' ? anchor : null;
    player.querySelectorAll = () => [];
    target.closest = () => player;
    let current = target;
    document.querySelector = () => current;
    const gl = fakeGl(faults);
    const canvases = [];
    document.createElement = () => {
        const canvas = new Element(); canvas.copies = 0;
        canvas.getContext = kind => kind === 'webgl' ? gl : { drawImage() { canvas.copies++; }, clearRect() {} };
        canvases.push(canvas); return canvas;
    };
    const motion = new Events(); motion.matches = false;
    const window = { devicePixelRatio: 2, matchMedia: () => motion };
    const requests = []; const observers = []; const rafs = new Map(); let now = 1, rafId = 0;
    class Observer {
        constructor(fn) { this.fn = fn; this.disconnected = false; observers.push(this); }
        observe() {} disconnect() { this.disconnected = true; }
    }
    const context = vm.createContext({ document, window, getComputedStyle: node => node.style, AbortController,
        performance: { now: () => now }, requestAnimationFrame: fn => { rafs.set(++rafId, fn); return rafId; }, cancelAnimationFrame: id => rafs.delete(id),
        MutationObserver: Observer, ResizeObserver: Observer, IntersectionObserver: Observer,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        MicoFluidPalette: { fallback: [[.2,.28,.37],[.29,.37,.42],[.4,.45,.48],[.1,.15,.22]],
            readCover: (source, signal) => new Promise((resolve, reject) => requests.push({ source, signal,
                resolve: colors => resolve({ colors, image: { naturalWidth: 400, naturalHeight: 400 } }), reject })) }
    });
    for (const file of ['fluid-shaders.js', 'fluid-engine.js']) vm.runInContext(read(file), context, { filename: file });
    const settings = { reduceMotion: false, lowBlur: false };
    const engine = context.MicoFluidGlass.create(settings);
    const advance = delta => {
        now += delta; const batch = [...rafs.values()]; rafs.clear(); for (const callback of batch) callback(now);
    };
    const hide = () => { document.hidden = true; document.dispatchEvent({ type: 'visibilitychange' }); };
    const show = () => { document.hidden = false; document.dispatchEvent({ type: 'visibilitychange' }); };
    return { engine, settings, document, target, player, anchor, gl, rafs, advance, hide, show, requests, observers, canvases, motion,
        removeTarget: () => { current = null; engine.sync(); }, get now() { return now; } };
}
function assertReleased(h) {
    assert.equal(h.gl.live.size, 0);
    assert.equal(h.rafs.size, 0);
    const state = plain(h.engine.diagnostics());
    assert.deepEqual(state.resources, { textures: 0, buffers: 0, framebuffers: 0, programs: 0, shaders: 0 });
    assert.equal(state.allocations, state.deletions);
}

test('hidden mount allocates no GPU objects or cover reads; visibility rebuilds and 20 cycles balance deletions', () => {
    const h = harness({ visible: false, source: 'cover-a' });
    assertReleased(h); assert.equal(h.requests.length, 0); assert.equal(h.engine.diagnostics().phase, 'suspended');
    for (let i = 0; i < 20; i++) {
        h.show(); assert.equal(h.engine.diagnostics().phase, 'ready'); assert.equal(h.gl.live.size, 8);
        assert.equal(h.rafs.size, 1); h.advance(40);
        const request = h.requests.at(-1); h.hide(); assert.equal(request.signal.aborted, true); assertReleased(h);
        const frames = h.engine.frameCount; h.advance(1000); assert.equal(h.engine.frameCount, frames);
    }
    h.engine.dispose(); assertReleased(h); assert.equal(h.gl.lost, 1);
    assert.equal(h.document.count + h.motion.count + h.canvases.reduce((sum, canvas) => sum + canvas.count, 0), 0);
    assert.ok(h.observers.every(observer => observer.disconnected));
});

test('native hide and offscreen suspension both delete resources; detach explicitly relinquishes context quota', () => {
    const h = harness(); h.advance(40);
    h.document.documentElement.setAttribute('data-mico-window-visible', 'false'); h.engine.sync(); assertReleased(h);
    h.document.documentElement.removeAttribute('data-mico-window-visible'); h.engine.sync(); assert.equal(h.gl.live.size, 8);
    h.engine.intersectionObserver.fn([{ isIntersecting: false }]); assertReleased(h);
    h.engine.intersectionObserver.fn([{ isIntersecting: true }]); assert.equal(h.gl.live.size, 8);
    h.removeTarget(); assertReleased(h); assert.equal(h.gl.lost, 1); assert.equal(h.target.children.length, 0);
    h.engine.dispose(); assert.equal(h.gl.lost, 1);
});

test('compile/link/allocation/FBO failures clean partial allocations and leave CSS with an explicit error', () => {
    for (const faults of [{ compile: true }, { link: true }, { allocate: 'Texture' }, { framebuffer: true }]) {
        const h = harness({ faults }); assertReleased(h);
        assert.equal(h.engine.diagnostics().phase, 'fallback'); assert.ok(h.engine.diagnostics().error);
        assert.equal(h.document.documentElement.getAttribute('data-mico-fluid-renderer'), 'css');
        h.engine.dispose(); assertReleased(h); assert.equal(h.gl.lost, 1);
    }
});

test('context loss stops draws, cancels pending cover data, and restores only while visible', () => {
    const h = harness({ source: 'cover-a' }); h.advance(40);
    let prevented = false;
    h.canvases[0].dispatchEvent({ type: 'webglcontextlost', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assertReleased(h); assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.engine.diagnostics().phase, 'context-lost');
    h.hide(); h.canvases[0].dispatchEvent({ type: 'webglcontextrestored' }); assertReleased(h);
    h.show(); assert.equal(h.engine.diagnostics().phase, 'ready'); assert.equal(h.gl.live.size, 8);
    assert.equal(h.requests.length, 2); h.engine.dispose(); assertReleased(h);
});

test('late cover completion cannot recolour a hidden/disposed renderer; successful recovery clears read error', async () => {
    const h = harness({ source: 'cover-a' }); const first = h.requests[0];
    h.target.setAttribute('data-mico-fluid-source', 'cover-b'); h.engine.sync(); const second = h.requests[1];
    assert.equal(first.signal.aborted, true); first.resolve([[1,0,0],[1,0,0],[1,0,0],[1,0,0]]); await settle();
    assert.equal(h.engine.diagnostics().paletteStatus, 'pending');
    second.reject(new DOMException('denied', 'SecurityError')); await settle();
    assert.equal(h.engine.diagnostics().paletteStatus, 'tainted'); assert.equal(h.engine.diagnostics().error, 'denied');
    h.target.setAttribute('data-mico-fluid-source', 'cover-c'); h.engine.sync();
    h.requests[2].resolve([[0,1,0],[0,1,0],[0,1,0],[0,1,0]]); await settle();
    assert.equal(h.engine.diagnostics().paletteSource, 'cover'); assert.equal(h.engine.diagnostics().error, null);
    h.target.setAttribute('data-mico-fluid-source', 'cover-d'); h.engine.sync(); const late = h.requests[3];
    h.engine.dispose(); late.resolve([[1,0,0],[1,0,0],[1,0,0],[1,0,0]]); await settle();
    assertReleased(h); assert.equal(h.engine.diagnostics().phase, 'disposed');
});

test('flow time freezes across long hidden intervals and reduced/low-blur modes never maintain RAF', () => {
    const h = harness(); h.advance(40); h.advance(40); assert.ok(h.engine.time > 0);
    const before = h.engine.time; h.hide(); h.advance(120000); assert.equal(h.engine.time, before);
    h.show(); h.advance(40); assert.equal(h.engine.time, before); h.advance(40); assert.equal(h.engine.time, before + .04);
    for (const setting of [{ reduceMotion: true, lowBlur: false }, { reduceMotion: false, lowBlur: true }]) {
        h.engine.setSettings(setting); h.advance(40); const time = h.engine.time;
        assert.equal(h.rafs.size, 0); h.advance(10000); assert.equal(h.engine.time, time);
    }
    h.engine.dispose(); assertReleased(h);
});

test('hero geometry deadline is bounded once per phase despite unrelated DOM sync calls', () => {
    const h = harness({ flow: false }); h.advance(40); assert.equal(h.rafs.size, 0);
    h.player.setAttribute('data-mico-hero-phase', 'opening'); h.engine.sync();
    const deadline = h.engine.geometryUntil;
    for (let i = 0; i < 20; i++) { h.advance(40); h.engine.sync(); assert.equal(h.engine.geometryUntil, deadline); }
    h.advance(40); assert.equal(h.rafs.size, 0); h.engine.dispose();
});

test('low-blur follows bounded menu geometry while keeping fluid time frozen and stopping after the transition', () => {
    const h = harness({ flow: false });
    h.engine.setSettings({ reduceMotion: false, lowBlur: true }); h.advance(40);
    assert.equal(h.rafs.size, 0);
    const time = h.engine.time, frames = h.engine.frameCount;
    h.anchor.setAttribute('data-mico-menu-phase', 'opening'); h.engine.sync();
    const deadline = h.engine.geometryUntil;
    for (let i = 0; i < 20; i++) {
        h.advance(40); h.engine.sync();
        assert.equal(h.engine.geometryUntil, deadline);
        assert.equal(h.engine.time, time);
    }
    h.advance(40);
    assert.ok(h.engine.frameCount > frames + 5, 'menu material must track intermediate geometry');
    assert.equal(h.rafs.size, 0);
    h.advance(10000); assert.equal(h.engine.time, time);
    h.engine.dispose(); assertReleased(h);
});

test('paused seek focus and blur refresh a single glass thumb frame and dispose removes both listeners', () => {
    const h = harness({ flow: false });
    const seek = new Element(); seek.max = '100'; seek.min = '0'; seek.value = '50'; seek.matches = () => false;
    h.player.querySelector = selector => selector === '.mico-immersive-seek' ? seek : selector === '.mico-immersive-menu-anchor' ? h.anchor : null;
    h.advance(40); assert.equal(h.rafs.size, 0); assert.equal(h.engine.shapes, 0);
    h.document.activeElement = seek; h.document.dispatchEvent({ type: 'focusin', target: seek });
    assert.equal(h.rafs.size, 1); h.advance(40); assert.equal(h.engine.shapes, 1); assert.equal(h.rafs.size, 0);
    h.document.activeElement = null; h.document.dispatchEvent({ type: 'focusout', target: seek });
    assert.equal(h.rafs.size, 1); h.advance(40); assert.equal(h.engine.shapes, 0); assert.equal(h.rafs.size, 0);
    h.engine.dispose(); assertReleased(h); assert.equal(h.document.count, 0);
    h.document.dispatchEvent({ type: 'focusin', target: seek }); assert.equal(h.rafs.size, 0);
});

test('palette ignores letterboxes for chromatic selection and rejects invisible images rather than reporting cover success', () => {
    const context = vm.createContext({}); vm.runInContext(read('fluid-palette.js'), context);
    const pixels = [];
    for (let i = 0; i < 100; i++) pixels.push(0,0,0,255);
    for (let i = 0; i < 10; i++) pixels.push(255,64,0,255);
    for (let i = 0; i < 5; i++) pixels.push(0,64,255,255);
    const colors = plain(context.MicoFluidPalette.extractPixels(pixels));
    assert.deepEqual(colors[0], [1,64/255,0]); assert.deepEqual(colors[1], [0,64/255,1]);
    assert.throws(() => context.MicoFluidPalette.extractPixels([0,0,0,0]), /不透明像素/);
    assert.throws(() => context.MicoFluidPalette.extractPixels([]), /不透明像素/);
});

test('colour cover accents exclude pale typography while monochrome covers retain their actual tones', () => {
    const context = vm.createContext({}); vm.runInContext(read('fluid-palette.js'), context);
    const pixels = [];
    for (let i = 0; i < 100; i++) pixels.push(254,235,217,255);
    for (let i = 0; i < 20; i++) pixels.push(235,90,35,255);
    for (let i = 0; i < 10; i++) pixels.push(110,55,85,255);
    const accents = plain(context.MicoFluidPalette.extractPixels(pixels));
    assert.ok(accents.every(color => Math.max(...color) - Math.min(...color) > .18));
    assert.deepEqual(accents[0], [235/255,90/255,35/255]);
    const mono = plain(context.MicoFluidPalette.extractPixels([120,120,120,255,180,180,180,255,0,0,0,255]));
    assert.ok(mono.every(color => color[0] === color[1] && color[1] === color[2]));
    assert.ok(mono.every(color => color[0] > 0));
});

test('real cover texture is composited into the glass scene at host geometry, while background and overlay stay separate', async () => {
    const h = harness({ source: 'cover-a', flow: false });
    const cover = new Element(); cover.width = 200; cover.height = 200; cover.left = 40; cover.top = 20; cover.style.borderTopLeftRadius = '11px';
    const image = new Element(); image.setAttribute('src', 'cover-a');
    const menu = new Element(); menu.width = 160; menu.height = 120; menu.left = 80; menu.top = 80;
    h.player.querySelector = selector => ({ '.mico-immersive-menu-anchor': h.anchor, '.mico-immersive-cover': cover,
        '.mico-immersive-cover img': image, '.mico-immersive-menu': menu })[selector] || null;
    h.player.querySelectorAll = () => [menu];
    h.requests[0].resolve([[1,.25,0],[0,.25,1],[.5,.5,.5],[.1,.1,.1]]); await settle(); h.advance(40);
    assert.equal(h.engine.diagnostics().coverSceneStatus, 'ready'); assert.equal(h.engine.diagnostics().coverSceneDraws, 1);
    assert.equal(h.gl.live.size, 9); assert.equal(h.engine.diagnostics().outputCanvases, 2);
    assert.ok(h.gl.calls.some(call => call[0] === 'texImage2D' && call.length === 7 && call[6] === h.engine.coverImage));
    assert.ok(h.gl.calls.some(call => call[0] === 'uniform4fv' && call[1] === 'u_rect' && JSON.stringify(call[2]) === '[140,120,200,200]'));
    const coverPass = h.gl.calls.findIndex(call => call[0] === 'uniform1i' && call[1] === 'u_cover');
    const clear = h.gl.calls.findIndex(call => call[0] === 'clear');
    const glassPass = h.gl.calls.findIndex(call => call[0] === 'uniform1f' && call[1] === 'u_pointerActive');
    assert.ok(coverPass < clear && clear < glassPass, 'opaque background copied before transparent glass rendering');
    assert.ok(h.gl.calls.some(call => call[0] === 'blendFuncSeparate' && call[3] === h.gl.ONE), 'alpha must not be multiplied by itself at the glass rim');
    assert.equal(h.engine.backgroundCanvas.copies, 1); assert.equal(h.engine.overlayCanvas.copies, 1);
    assert.equal(h.engine.overlayCanvas.parent, h.player); assert.equal(h.engine.backgroundCanvas.parent, h.target);
    h.target.style.opacity = '.4'; h.engine.requestFrame(); h.advance(40);
    assert.equal(h.engine.overlayCanvas.style.opacity, '.4', 'foreground glass follows the Hero background fade');
    h.hide(); assertReleased(h);
    assert.ok(h.canvases.every(canvas => canvas.width === 0 && canvas.height === 0), 'hidden output backing stores are released too');
    h.show(); h.advance(40); assert.equal(h.engine.diagnostics().coverSceneDraws, 3);
    h.engine.dispose(); assertReleased(h); assert.equal(h.player.children.length + h.target.children.length, 0);
});

test('cover upload security failure releases all objects and returns to CSS; a new cover can recover', async () => {
    const faults = { upload: true }; const h = harness({ faults, source: 'cover-a' });
    h.requests[0].resolve([[1,0,0],[1,0,0],[1,0,0],[1,0,0]]); await settle();
    assertReleased(h); assert.equal(h.engine.diagnostics().phase, 'fallback');
    assert.equal(h.engine.diagnostics().coverSceneStatus, 'error'); assert.equal(h.engine.diagnostics().coverSceneError, 'cover denied');
    assert.equal(h.document.documentElement.getAttribute('data-mico-fluid-renderer'), 'css');
    faults.upload = false; h.target.setAttribute('data-mico-fluid-source', 'cover-b'); h.engine.sync();
    h.requests[1].resolve([[0,1,0],[0,1,0],[0,1,0],[0,1,0]]); await settle();
    assert.equal(h.engine.diagnostics().phase, 'ready'); assert.equal(h.engine.diagnostics().coverSceneStatus, 'ready');
    assert.equal(h.engine.diagnostics().coverSceneError, null); assert.equal(h.engine.diagnostics().error, null);
    h.engine.dispose(); assertReleased(h);
});
