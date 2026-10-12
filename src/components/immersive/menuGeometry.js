// 此模块的矩形全部来自 DOM 测量；只在已测量的空白区域分配菜单空间。
const validRect = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function immersiveMenuLayout({ viewport, cover, lyrics, button, contentHeight, width = 240, inset = 24, gap = 12 }) {
    if (![viewport, cover, lyrics, button].every(validRect) || !Number.isFinite(contentHeight) || contentHeight <= 0) return null;
    const safeLeft = viewport.x + inset;
    const safeTop = viewport.y + inset;
    const safeBottom = viewport.y + viewport.height - inset;
    const availableHeight = Math.max(1, safeBottom - safeTop);
    const height = Math.min(contentHeight, availableHeight);
    const corridorWidth = lyrics.x - cover.x - cover.width - gap * 2;
    const requestedWidth = Math.min(corridorWidth >= 224 ? Math.min(width, corridorWidth) : width, viewport.width - inset * 2);
    const requiredShift = Math.max(0, requestedWidth - corridorWidth);
    const leftSpace = Math.max(0, cover.x - safeLeft);
    if (requestedWidth >= 180 && requiredShift <= leftSpace) {
        const albumShift = requiredShift > 0 ? -requiredShift : 0;
        const x = cover.x + cover.width + albumShift + gap;
        const y = clamp(button.y + button.height - height, safeTop, safeBottom - height);
        return { placement: 'corridor', albumShift, rect: { x, y, width: requestedWidth, height }, lyricsReserved: false };
    }
    // 窄窗没有足够横向间距时，为菜单暂时腾出歌词区域；不把表单盖在仍可见的歌词上。
    const availableWidth = Math.min(lyrics.width, viewport.x + viewport.width - inset - lyrics.x);
    const reservedWidth = Math.min(Math.max(requestedWidth, 240), availableWidth);
    const reservedHeight = Math.min(height, lyrics.height, safeBottom - Math.max(safeTop, lyrics.y));
    if (reservedWidth <= 0 || reservedHeight <= 0) return null;
    return {
        placement: 'lyrics-space', albumShift: 0,
        rect: { x: lyrics.x + (availableWidth - reservedWidth) / 2, y: clamp(button.y + button.height - reservedHeight, Math.max(safeTop, lyrics.y), safeBottom - reservedHeight), width: reservedWidth, height: reservedHeight },
        lyricsReserved: true
    };
}

export function immersiveMenuMorph(button, panel) {
    if (!validRect(button) || !validRect(panel)) return null;
    return {
        transform: `translate(${button.x - panel.x}px, ${button.y - panel.y}px) scale(${button.width / panel.width}, ${button.height / panel.height})`,
        borderRadius: `${Math.max(panel.width, panel.height) / 2}px`
    };
}
