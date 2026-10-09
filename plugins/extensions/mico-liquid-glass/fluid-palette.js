/* 独立编写的封面量化器；不复制参考项目的代码或素材。 */
(() => {
    'use strict';
    const fallback = Object.freeze([[0.20, 0.28, 0.37], [0.29, 0.37, 0.42], [0.40, 0.45, 0.48], [0.10, 0.15, 0.22]].map(Object.freeze));
    const luminance = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    const distance = (a, b) => a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0);
    function extractPixels(pixels) {
        const bins = new Map();
        for (let i = 0; i + 3 < pixels.length; i += 4) {
            if (pixels[i + 3] < 128) continue;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const id = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            let entry = bins.get(id);
            if (!entry) { entry = { count: 0, sum: [0, 0, 0] }; bins.set(id, entry); }
            entry.count++;
            entry.sum[0] += r; entry.sum[1] += g; entry.sum[2] += b;
        }
        if (!bins.size) throw new Error('封面没有可用的不透明像素');
        const all = [...bins.values()].map((entry) => ({ count: entry.count, color: entry.sum.map((sum) => sum / entry.count / 255) }));
        const tonal = all.filter(({ color }) => luminance(color) > 0.045 && luminance(color) < 0.94);
        // Typography and neutral borders can have many antialiased bins. When the
        // cover has colour, keep those pale/grey pixels out of its accent palette.
        const chromatic = tonal.filter(({ color }) => Math.max(...color) - Math.min(...color) > 0.18);
        // A two-colour cover still has useful chromatic data. A white border or a
        // black letterbox must not displace those colours just because there are <4 bins.
        const choices = (chromatic.length ? chromatic : tonal.length ? tonal : all).sort((a, b) => b.count - a.count).slice(0, 64);
        const main = choices[0].color;
        const second = [...choices].sort((a, b) => distance(b.color, main) * Math.sqrt(b.count) - distance(a.color, main) * Math.sqrt(a.count))[0].color;
        const highlight = [...choices].sort((a, b) => luminance(b.color) - luminance(a.color))[0].color;
        const shadow = [...choices].sort((a, b) => luminance(a.color) - luminance(b.color))[0].color;
        return [main, second, highlight, shadow].map((color) => [...color]);
    }
    function readCover(source, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException('封面读取已取消', 'AbortError')); return; }
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.referrerPolicy = 'no-referrer';
            const clean = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
            const abort = () => { clean(); image.src = ''; reject(new DOMException('封面读取已取消', 'AbortError')); };
            signal?.addEventListener('abort', abort, { once: true });
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 48; canvas.height = 48;
                try {
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    if (!context) throw new Error('无法读取封面像素');
                    context.drawImage(image, 0, 0, 48, 48);
                    const colors = extractPixels(context.getImageData(0, 0, 48, 48).data);
                    clean(); resolve({ colors, image });
                } catch (error) { clean(); reject(error); }
                finally { canvas.width = 0; canvas.height = 0; }
            };
            image.onerror = () => { clean(); reject(new Error('封面读取失败，或源服务器未允许跨域像素读取')); };
            image.src = source;
        });
    }
    const sample = (source, signal) => readCover(source, signal).then(result => result.colors);
    globalThis.MicoFluidPalette = Object.freeze({ fallback, extractPixels, sample, readCover, luminance });
})();
