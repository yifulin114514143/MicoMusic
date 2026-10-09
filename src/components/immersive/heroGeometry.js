// 新定义的几何适配器：输入均来自实际 DOMRect，不按窗口尺寸推测小封面位置。
export function heroTransform(origin, destination) {
    const valid = rect => rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
    if (!valid(origin) || !valid(destination)) return null;
    return {
        x: origin.x - destination.x,
        y: origin.y - destination.y,
        scaleX: origin.width / destination.width,
        scaleY: origin.height / destination.height
    };
}

export function heroTransformStyle(transform) {
    if (!transform) return 'none';
    return `translate(${transform.x}px, ${transform.y}px) scale(${transform.scaleX}, ${transform.scaleY})`;
}
