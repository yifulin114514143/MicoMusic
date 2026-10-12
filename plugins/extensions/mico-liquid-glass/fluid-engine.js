/* 单 WebGL 上下文、背景与前景两份 2D 输出。业务音频、歌词和控件留在 DOM。 */
(() => {
    'use strict';
    const resourceMethods = {
        textures: 'deleteTexture', buffers: 'deleteBuffer', framebuffers: 'deleteFramebuffer', programs: 'deleteProgram', shaders: 'deleteShader'
    };
    const targetSelector = '.mico-immersive-background';
    const shapeSelectors = ['.mico-immersive-more', '.mico-immersive-close', '.mico-immersive-tool', '.mico-immersive-menu'];
    const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
    const smooth = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
    class FluidGlassEngine {
        constructor(settings) {
            this.settings = settings;
            this.disposed = false;
            this.target = null;
            this.canvas = null;
            this.backgroundCanvas = null; this.overlayCanvas = null;
            this.coverImage = null; this.coverSource = null; this.coverSceneStatus = 'none'; this.coverSceneError = null;
            this.coverSceneDraws = 0;
            this.coverFallback = false;
            this.gl = null;
            this.raf = 0;
            this.frameCount = 0;
            this.lastDraw = 0;
            this.time = 0;
            this.width = 0; this.height = 0; this.dpr = 1;
            this.phase = 'waiting'; this.error = null;
            this.pointer = [-1000, -1000]; this.pointerActive = 0;
            this.viewportVisible = true;
            this.source = null;
            this.paletteStatus = 'pending'; this.paletteSource = 'fallback';
            this.colors = MicoFluidPalette.fallback.map((color) => [...color]);
            this.fromColors = this.colors;
            this.toColors = this.colors;
            this.colorStarted = 0; this.colorEnds = 0;
            this.menuPhase = 'closed'; this.menuStarted = 0; this.geometryUntil = 0;
            this.heroPhase = null;
            this.shapes = 0;
            this.resources = Object.fromEntries(Object.keys(resourceMethods).map((name) => [name, new Set()]));
            this.allocations = 0; this.deletions = 0;
            this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.onVisibility = () => this.sync();
            this.onFocusChange = () => this.requestFrame();
            this.onPointer = (event) => {
                if (!this.target || !this.canvas) return;
                const rect = this.target.getBoundingClientRect();
                this.pointer = [event.clientX - rect.left, event.clientY - rect.top];
                this.pointerActive = 1;
                this.requestFrame();
            };
            this.onPointerLeave = () => { this.pointerActive = 0; this.requestFrame(); };
            this.onContextLost = (event) => {
                event.preventDefault(); this.cancelFrame(); this.releaseResources();
                for (const canvas of [this.canvas, this.backgroundCanvas, this.overlayCanvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
                this.paletteAbort?.abort(); this.source = null;
                this.phase = 'context-lost'; this.error = 'WebGL 上下文丢失；保留静态背景及 DOM 控件';
                document.documentElement.setAttribute('data-mico-fluid-renderer', 'css'); this.publish();
            };
            this.onContextRestored = () => {
                if (this.disposed || !this.target) return;
                this.phase = 'suspended'; this.error = null; this.sync();
            };
            this.observer = new MutationObserver(() => this.sync());
            this.observer.observe(document.documentElement, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['data-mico-fluid-source', 'data-motion', 'data-blur', 'data-mico-fluid-visible', 'data-mico-menu-phase', 'data-mico-hero-phase', 'data-mico-window-visible', 'value', 'max']
            });
            document.addEventListener('visibilitychange', this.onVisibility);
            document.addEventListener('pointermove', this.onPointer, { passive: true });
            document.addEventListener('pointerleave', this.onPointerLeave);
            document.addEventListener('input', this.onVisibility);
            document.addEventListener('focusin', this.onFocusChange);
            document.addEventListener('focusout', this.onFocusChange);
            this.motionPreference.addEventListener('change', this.onVisibility);
            this.sync();
        }
        allocate(kind, resource) {
            if (!resource) throw new Error(`WebGL 无法创建 ${kind}`);
            this.resources[kind].add(resource); this.allocations++; return resource;
        }
        release(kind, resource) {
            if (!this.resources[kind].delete(resource)) return;
            this.gl?.[resourceMethods[kind]](resource); this.deletions++;
        }
        releaseResources() {
            // Detach bound storage too: deleting a currently bound object may keep it alive
            // until the binding is replaced, especially across a hidden-window interval.
            this.gl?.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl?.bindTexture(this.gl.TEXTURE_2D, null);
            this.gl?.bindBuffer(this.gl.ARRAY_BUFFER, null);
            this.gl?.useProgram(null);
            for (const kind of Object.keys(resourceMethods)) for (const resource of [...this.resources[kind]]) this.release(kind, resource);
            this.programs = null; this.texture = null; this.framebuffer = null; this.buffer = null; this.coverTexture = null; this.fluidTexture = null;
        }
        program(fragment) {
            const gl = this.gl;
            const compile = (type, source) => {
                const shader = this.allocate('shaders', gl.createShader(type));
                gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'WebGL shader 编译失败');
                return shader;
            };
            const vertex = compile(gl.VERTEX_SHADER, MicoFluidShaders.vertex);
            const pixel = compile(gl.FRAGMENT_SHADER, fragment);
            const program = this.allocate('programs', gl.createProgram());
            gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program 链接失败');
            this.release('shaders', vertex); this.release('shaders', pixel);
            return { program, position: gl.getAttribLocation(program, 'a_position'), uniforms: new Map() };
        }
        buildResources() {
            this.releaseResources();
            const gl = this.gl;
            this.programs = { fluid: this.program(MicoFluidShaders.fluid), copy: this.program(MicoFluidShaders.copy), image: this.program(MicoFluidShaders.image), glass: this.program(MicoFluidShaders.glass) };
            this.buffer = this.allocate('buffers', gl.createBuffer());
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
            this.texture = this.allocate('textures', gl.createTexture());
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            // A complete sampler also exists before any cover arrives; it never
            // aliases the scene FBO being written by the fluid program.
            this.fluidTexture = this.allocate('textures', gl.createTexture());
            gl.bindTexture(gl.TEXTURE_2D, this.fluidTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
            this.framebuffer = this.allocate('framebuffers', gl.createFramebuffer());
            this.width = 0; this.height = 0;
            this.resize();
            if (this.coverImage) this.uploadCover();
        }
        use(program) {
            const gl = this.gl;
            gl.useProgram(program.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.enableVertexAttribArray(program.position); gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0);
        }
        uniform(program, name, method, value) {
            if (!program.uniforms.has(name)) program.uniforms.set(name, this.gl.getUniformLocation(program.program, name));
            this.gl[method](program.uniforms.get(name), value);
        }
        resize() {
            if (!this.canvas || !this.target || !this.gl) return;
            const rect = this.target.getBoundingClientRect();
            const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
            const dpr = clamp(window.devicePixelRatio || 1, 1, 1.5);
            if (width === this.width && height === this.height && dpr === this.dpr) return;
            this.width = width; this.height = height; this.dpr = dpr;
            this.canvas.width = Math.ceil(width * dpr); this.canvas.height = Math.ceil(height * dpr);
            for (const canvas of [this.backgroundCanvas, this.overlayCanvas]) {
                canvas.width = this.canvas.width; canvas.height = this.canvas.height;
            }
            // 场景 FBO 保留一个 CSS 像素一采样，最终玻璃边缘仍以 capped DPR 输出。
            this.sceneWidth = Math.ceil(width); this.sceneHeight = Math.ceil(height);
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.sceneWidth, this.sceneHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('WebGL 场景 framebuffer 不完整');
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        attach(target) {
            this.target = target; this.source = null; this.error = null;
            this.viewportVisible = true; this.heroPhase = null;
            this.canvas = document.createElement('canvas'); this.canvas.id = 'mico-liquid-glass-canvas'; this.canvas.className = 'mico-immersive-fluid-source'; this.canvas.setAttribute('aria-hidden', 'true');
            this.canvas.addEventListener('webglcontextlost', this.onContextLost); this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
            target.appendChild(this.canvas);
            try {
                const player = target.closest('.mico-immersive-player');
                if (!player) throw new Error('沉浸播放器容器不存在');
                this.backgroundCanvas = document.createElement('canvas'); this.backgroundCanvas.className = 'mico-immersive-background-canvas'; this.backgroundCanvas.setAttribute('aria-hidden', 'true');
                this.overlayCanvas = document.createElement('canvas'); this.overlayCanvas.className = 'mico-immersive-glass-overlay'; this.overlayCanvas.setAttribute('aria-hidden', 'true');
                target.appendChild(this.backgroundCanvas); player.appendChild(this.overlayCanvas);
                this.backgroundContext = this.backgroundCanvas.getContext('2d', { alpha: false, desynchronized: true });
                this.overlayContext = this.overlayCanvas.getContext('2d', { alpha: true, desynchronized: true });
                if (!this.backgroundContext || !this.overlayContext) throw new Error('无法创建玻璃输出画布');
                // Transparent glass is blended into this buffer. Mark its resulting
                // premultiplied pixels correctly before the 2D canvas copy.
                this.gl = this.canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'default' });
                if (!this.gl) throw new Error('WebGL 不可用，使用静态封面背景');
                // Build on the first visible sync. Hidden mounting must not allocate an FBO.
                this.phase = 'suspended';
            } catch (error) { this.fallback(error); }
            this.resizeObserver = new ResizeObserver(() => { if (this.phase === 'ready') this.requestFrame(); });
            this.resizeObserver.observe(target);
            this.intersectionObserver = new IntersectionObserver((entries) => { this.viewportVisible = entries.some((entry) => entry.isIntersecting); this.sync(); });
            this.intersectionObserver.observe(target);
        }
        fallback(error) {
            this.cancelFrame(); this.releaseResources(); this.phase = 'fallback'; this.error = error.message;
            for (const canvas of [this.canvas, this.backgroundCanvas, this.overlayCanvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
            document.documentElement.setAttribute('data-mico-fluid-renderer', 'css'); this.publish();
        }
        detach() {
            this.cancelFrame(); this.paletteAbort?.abort(); this.paletteAbort = null;
            this.resizeObserver?.disconnect(); this.intersectionObserver?.disconnect(); this.resizeObserver = null; this.intersectionObserver = null;
            this.releaseResources();
            this.canvas?.removeEventListener('webglcontextlost', this.onContextLost); this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
            // Removing a canvas alone does not promptly relinquish its WebGL context quota.
            this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
            for (const canvas of [this.canvas, this.backgroundCanvas, this.overlayCanvas]) if (canvas) { canvas.width = 0; canvas.height = 0; }
            if (this.target) this.target.removeAttribute('data-mico-fluid-state');
            this.backgroundCanvas?.remove(); this.overlayCanvas?.remove();
            this.backgroundCanvas = null; this.overlayCanvas = null; this.backgroundContext = null; this.overlayContext = null;
            this.canvas?.remove(); this.canvas = null; this.gl = null; this.target = null; this.source = null;
            this.coverImage = null; this.coverSource = null; this.coverSceneStatus = 'none'; this.coverSceneError = null;
            this.coverFallback = false;
            document.documentElement.removeAttribute('data-mico-fluid-renderer');
        }
        suspend() {
            this.cancelFrame();
            if (this.paletteAbort) { this.paletteAbort.abort(); this.paletteAbort = null; this.source = null; }
            if (this.phase === 'ready') {
                this.releaseResources(); this.phase = 'suspended';
                for (const canvas of [this.canvas, this.backgroundCanvas, this.overlayCanvas]) { canvas.width = 0; canvas.height = 0; }
                document.documentElement.setAttribute('data-mico-fluid-renderer', 'css');
            }
            this.publish();
        }
        sync() {
            if (this.disposed) return;
            const target = document.querySelector(targetSelector);
            if (target !== this.target) { this.detach(); this.phase = 'waiting'; if (target) this.attach(target); }
            if (!target) return;
            if (!this.visible()) { this.suspend(); return; }
            const source = target.getAttribute('data-mico-fluid-source') || '';
            if (this.phase === 'fallback' && this.coverFallback && source !== this.source) { this.phase = 'suspended'; this.coverFallback = false; }
            if (this.phase === 'suspended') {
                try {
                    this.buildResources(); this.phase = 'ready';
                    document.documentElement.setAttribute('data-mico-fluid-renderer', 'webgl');
                } catch (error) { this.fallback(error); }
            }
            if (source !== this.source && this.phase !== 'context-lost') this.loadPalette(source);
            const player = target.closest('.mico-immersive-player');
            const menu = player?.querySelector('.mico-immersive-menu-anchor');
            const phase = menu?.getAttribute('data-mico-menu-phase') || 'closed';
            if (phase !== this.menuPhase) { this.menuPhase = phase; this.menuStarted = performance.now(); if (phase === 'opening' || phase === 'closing') this.geometryUntil = this.menuStarted + 460; }
            const hero = player?.getAttribute('data-mico-hero-phase');
            if (hero !== this.heroPhase) {
                this.heroPhase = hero;
                if (hero === 'opening' || hero === 'closing') this.geometryUntil = Math.max(this.geometryUntil, performance.now() + 460);
            }
            if (this.phase === 'ready') this.requestFrame();
            else this.publish();
        }
        visible() { return !!this.target && this.viewportVisible && !document.hidden && this.target.getAttribute('data-mico-fluid-visible') !== 'false' && document.documentElement.getAttribute('data-mico-window-visible') !== 'false'; }
        reduced() { return !!this.settings.reduceMotion || this.motionPreference.matches; }
        flowing() { return this.visible() && !this.reduced() && !this.settings.lowBlur && this.target.getAttribute('data-motion') === 'flow' && this.target.getAttribute('data-blur') !== 'low'; }
        needsFrames(now) { return this.visible() && !this.reduced() && (now < this.geometryUntil || !this.settings.lowBlur && (this.flowing() || now < this.colorEnds)); }
        setSettings(settings) { this.settings = settings; this.sync(); }
        loadPalette(source) {
            this.source = source; this.paletteAbort?.abort();
            if (this.coverTexture) { this.release('textures', this.coverTexture); this.coverTexture = null; }
            this.coverImage = null; this.coverSource = null; this.coverSceneStatus = source ? 'pending' : 'none'; this.coverSceneError = null;
            const abort = new AbortController(); this.paletteAbort = abort;
            this.paletteStatus = source ? 'pending' : 'loaded';
            if (!source) { this.paletteAbort = null; this.transitionPalette(MicoFluidPalette.fallback, 'fallback'); return; }
            MicoFluidPalette.readCover(source, abort.signal).then(({ colors, image }) => {
                if (this.disposed || abort.signal.aborted || this.source !== source) return;
                this.paletteAbort = null;
                if (this.phase === 'ready') this.error = null;
                this.coverImage = image; this.coverSource = source;
                if (this.phase === 'ready') {
                    try { this.uploadCover(); }
                    catch (error) { this.coverFallback = true; this.fallback(error); return; }
                }
                this.paletteStatus = 'loaded'; this.transitionPalette(colors, 'cover');
            }).catch((error) => {
                if (this.disposed || abort.signal.aborted) return;
                this.paletteAbort = null;
                this.coverSceneStatus = 'unavailable'; this.coverSceneError = error.message;
                this.paletteStatus = error.name === 'SecurityError' ? 'tainted' : 'error';
                this.paletteSource = 'fallback'; this.coverFallback = true; this.fallback(error);
            });
        }
        uploadCover() {
            const gl = this.gl;
            if (!this.coverImage || !gl) return;
            if (this.coverTexture) this.release('textures', this.coverTexture);
            this.coverTexture = this.allocate('textures', gl.createTexture());
            gl.bindTexture(gl.TEXTURE_2D, this.coverTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            let field;
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.coverImage);
                field = document.createElement('canvas'); field.width = 32; field.height = 32;
                const context = field.getContext('2d');
                if (!context) throw new Error('无法生成封面空间色彩纹理');
                context.drawImage(this.coverImage, 0, 0, 32, 32);
                gl.bindTexture(gl.TEXTURE_2D, this.fluidTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, field);
            }
            catch (error) { this.coverSceneStatus = 'error'; this.coverSceneError = error.message; this.coverFallback = true; throw error; }
            finally { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); if (field) { field.width = 0; field.height = 0; } }
            this.coverSceneStatus = 'ready'; this.coverSceneError = null;
        }
        transitionPalette(colors, source) {
            this.fromColors = this.colors.map((color) => [...color]); this.toColors = colors.map((color) => [...color]); this.paletteSource = source;
            this.colorStarted = performance.now(); this.colorEnds = this.colorStarted + 1500;
            // 首次可见画面直接使用真实封面；后续换封面执行 1.5 秒切色。
            if (!this.frameCount || this.reduced() || this.settings.lowBlur) { this.colors = this.toColors; this.colorEnds = 0; }
            this.requestFrame();
        }
        requestFrame() {
            if (this.disposed || this.phase !== 'ready' || !this.visible() || this.raf) return;
            this.raf = requestAnimationFrame((now) => this.tick(now));
        }
        cancelFrame() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.lastDraw = 0; }
        tick(now) {
            this.raf = 0;
            if (this.disposed || this.phase !== 'ready' || !this.visible()) { this.publish(); return; }
            if (this.lastDraw && now - this.lastDraw < 15 && this.needsFrames(now)) { this.requestFrame(); return; }
            if (this.flowing() && this.lastDraw) this.time += Math.min(.1, (now - this.lastDraw) / 1000);
            this.lastDraw = now;
            if (this.colorEnds) {
                const mix = this.reduced() || this.settings.lowBlur ? 1 : smooth((now - this.colorStarted) / 1500);
                this.colors = this.fromColors.map((color, i) => color.map((value, j) => value + (this.toColors[i][j] - value) * mix));
                if (mix >= 1) this.colorEnds = 0;
            }
            try { this.draw(now); this.frameCount++; }
            catch (error) { this.fallback(error); return; }
            if (this.needsFrames(now)) this.requestFrame();
            this.publish();
        }
        measure(node) {
            const bounds = node.getBoundingClientRect(), origin = this.target.getBoundingClientRect();
            if (bounds.width < 1 || bounds.height < 1) return null;
            const style = getComputedStyle(node);
            if (style.visibility === 'hidden' || style.display === 'none') return null;
            const radiusValue = parseFloat(style.borderTopLeftRadius) || 0;
            const radius = clamp(style.borderTopLeftRadius.endsWith('%') ? radiusValue * Math.min(bounds.width, bounds.height) / 100 :
                radiusValue * Math.min(node.offsetWidth ? bounds.width / node.offsetWidth : 1, node.offsetHeight ? bounds.height / node.offsetHeight : 1),
                0, Math.min(bounds.width, bounds.height) / 2);
            let opacity = clamp(Number(style.opacity), 0, 1);
            const player = this.target.closest('.mico-immersive-player');
            for (let ancestor = node.parentElement; ancestor && ancestor !== player; ancestor = ancestor.parentElement) {
                opacity *= clamp(Number(getComputedStyle(ancestor).opacity), 0, 1);
            }
            return { rect: [bounds.left-origin.left+bounds.width/2, bounds.top-origin.top+bounds.height/2, bounds.width, bounds.height], radius, opacity };
        }
        draw(now) {
            this.resize();
            const gl = this.gl, programs = this.programs;
            gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fluidTexture);
            this.use(programs.fluid); this.uniform(programs.fluid, 'u_resolution', 'uniform2fv', [this.sceneWidth, this.sceneHeight]); this.uniform(programs.fluid, 'u_time', 'uniform1f', this.time); this.uniform(programs.fluid, 'u_colors[0]', 'uniform3fv', this.colors.flat());
            this.uniform(programs.fluid, 'u_coverField', 'uniform1i', 0);
            const coverMix = this.coverSceneStatus === 'ready' ? (this.colorEnds ? smooth((now - this.colorStarted) / 1500) : 1) : 0;
            this.uniform(programs.fluid, 'u_coverMix', 'uniform1f', coverMix); gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
            this.use(programs.copy); this.uniform(programs.copy, 'u_scene', 'uniform1i', 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
            // Two GPU-backed 2D copies separate a full background from a transparent
            // foreground. The menu's glass can therefore sit above the real DOM cover.
            this.backgroundContext.drawImage(this.canvas, 0, 0);
            const player = this.target.closest('.mico-immersive-player');
            const coverNode = player?.querySelector('.mico-immersive-cover');
            const coverDomImage = player?.querySelector('.mico-immersive-cover img');
            if (coverNode && coverDomImage?.getAttribute('src') === this.coverSource && this.coverTexture) {
                const cover = this.measure(coverNode);
                if (cover) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
                    gl.bindTexture(gl.TEXTURE_2D, this.coverTexture);
                    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                    this.use(programs.image); this.uniform(programs.image, 'u_cover', 'uniform1i', 0);
                    this.uniform(programs.image, 'u_view', 'uniform2fv', [this.width, this.height]);
                    this.uniform(programs.image, 'u_rect', 'uniform4fv', cover.rect); this.uniform(programs.image, 'u_radius', 'uniform1f', cover.radius);
                    this.uniform(programs.image, 'u_opacity', 'uniform1f', cover.opacity);
                    const ratio = this.coverImage.naturalWidth / this.coverImage.naturalHeight, rectRatio = cover.rect[2] / cover.rect[3];
                    this.uniform(programs.image, 'u_crop', 'uniform2fv', ratio > rectRatio ? [rectRatio / ratio, 1] : [1, ratio / rectRatio]);
                    gl.drawArrays(gl.TRIANGLES, 0, 6); this.coverSceneDraws++; gl.disable(gl.BLEND);
                }
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            const nodes = player ? [...player.querySelectorAll(shapeSelectors.join(','))] : [];
            const more = player?.querySelector('.mico-immersive-more');
            const menu = player?.querySelector('.mico-immersive-menu');
            const moreShape = more ? this.measure(more) : null;
            const menuShape = menu ? this.measure(menu) : null;
            const elapsed = now - this.menuStarted;
            const joining = !this.reduced() && (this.menuPhase === 'opening' || this.menuPhase === 'closing') && elapsed < 350 && moreShape && menuShape;
            const joinAmount = joining ? (this.menuPhase === 'opening' ? 30 * (1 - smooth(elapsed / 350)) : 30 * smooth(elapsed / 260)) : 0;
            gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.use(programs.glass); this.uniform(programs.glass, 'u_scene', 'uniform1i', 0); this.uniform(programs.glass, 'u_view', 'uniform2fv', [this.width, this.height]); this.uniform(programs.glass, 'u_pointer', 'uniform2fv', this.pointer); this.uniform(programs.glass, 'u_pointerActive', 'uniform1f', this.pointerActive);
            this.shapes = 0;
            const renderShape = (shape, join = null, neck = 0, frost = .25, regular = 0) => {
                this.uniform(programs.glass, 'u_rect', 'uniform4fv', shape.rect); this.uniform(programs.glass, 'u_radius', 'uniform1f', shape.radius);
                this.uniform(programs.glass, 'u_joinRect', 'uniform4fv', join?.rect || [0,0,0,0]); this.uniform(programs.glass, 'u_joinRadius', 'uniform1f', join?.radius || 0); this.uniform(programs.glass, 'u_joinAmount', 'uniform1f', neck);
                this.uniform(programs.glass, 'u_strength', 'uniform1f', this.settings.lowBlur ? .7 : 1.15); this.uniform(programs.glass, 'u_opacity', 'uniform1f', shape.opacity * .97);
                this.uniform(programs.glass, 'u_frost', 'uniform1f', this.settings.lowBlur ? 0 : frost);
                this.uniform(programs.glass, 'u_regular', 'uniform1f', regular);
                let left = shape.rect[0] - shape.rect[2]/2, top = shape.rect[1] - shape.rect[3]/2, right = left + shape.rect[2], bottom = top + shape.rect[3];
                if (join) { left = Math.min(left,join.rect[0]-join.rect[2]/2); top = Math.min(top,join.rect[1]-join.rect[3]/2); right = Math.max(right,join.rect[0]+join.rect[2]/2); bottom = Math.max(bottom,join.rect[1]+join.rect[3]/2); }
                const pad = Math.max(regular > .01 ? 26 : 2,neck); left = clamp(left-pad,0,this.width); top = clamp(top-pad,0,this.height); right = clamp(right+pad,0,this.width); bottom = clamp(bottom+pad,0,this.height);
                gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.floor(left*this.dpr), Math.floor((this.height-bottom)*this.dpr), Math.ceil((right-left)*this.dpr), Math.ceil((bottom-top)*this.dpr)); gl.drawArrays(gl.TRIANGLES,0,6); this.shapes++;
            };
            for (const node of nodes) {
                if (joining && node === more) continue;
                const shape = this.measure(node); if (!shape) continue;
                const regular = node === menu ? smooth((Math.min(shape.rect[2], shape.rect[3]) - 40) / 96) : 0;
                renderShape(shape, node === menu && joining ? moreShape : null, node === menu ? joinAmount : 0, node === menu ? 1 : .25, regular);
            }
            const seek = player?.querySelector('.mico-immersive-seek');
            if (seek && !seek.disabled && (seek.matches(':hover') || seek === document.activeElement)) {
                const base = this.measure(seek); const max = Number(seek.max), min = Number(seek.min); const ratio = max > min ? clamp((Number(seek.value)-min)/(max-min),0,1) : 0;
                if (base) renderShape({ rect: [base.rect[0]-base.rect[2]/2+5.5+ratio*(base.rect[2]-11), base.rect[1], 14, 14], radius: 7, opacity: 1 });
            }
            gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
            this.overlayContext.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            this.overlayContext.drawImage(this.canvas, 0, 0);
            this.overlayCanvas.style.opacity = getComputedStyle(this.target).opacity;
        }
        diagnostics() {
            return { phase: this.phase, renderer: this.phase === 'ready' ? 'webgl1' : 'css', frameCount: this.frameCount, rafPending: !!this.raf,
                dpr: this.dpr, width: this.width, height: this.height, targetFrameRate: 60, paletteStatus: this.paletteStatus, paletteSource: this.paletteSource,
                paletteTransitionMs: 1500, shapes: this.shapes, timeSeconds: this.time, resources: Object.fromEntries(Object.entries(this.resources).map(([kind, values]) => [kind, values.size])),
                outputCanvases: this.backgroundCanvas && this.overlayCanvas ? 2 : 0, coverSceneStatus: this.coverSceneStatus, coverSceneError: this.coverSceneError, coverSceneDraws: this.coverSceneDraws,
                allocations: this.allocations, deletions: this.deletions, error: this.error };
        }
        publish() { if (this.target) this.target.setAttribute('data-mico-fluid-state', JSON.stringify(this.diagnostics())); }
        dispose() {
            if (this.disposed) return;
            this.disposed = true; this.observer.disconnect();
            document.removeEventListener('visibilitychange', this.onVisibility); document.removeEventListener('pointermove', this.onPointer); document.removeEventListener('pointerleave', this.onPointerLeave); document.removeEventListener('input', this.onVisibility);
            document.removeEventListener('focusin', this.onFocusChange); document.removeEventListener('focusout', this.onFocusChange);
            this.motionPreference.removeEventListener('change', this.onVisibility);
            this.detach(); this.phase = 'disposed';
            document.dispatchEvent(new CustomEvent('mico-fluid-diagnostics', { detail: JSON.stringify(this.diagnostics()) }));
        }
    }
    globalThis.MicoFluidGlass = Object.freeze({ create: (settings) => new FluidGlassEngine(settings) });
})();
