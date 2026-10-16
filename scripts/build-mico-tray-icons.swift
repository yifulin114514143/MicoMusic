import AppKit
import Foundation

// 从与 mico-mark.svg 一致的几何轮廓生成 macOS 模板图标和状态栏歌词标识。
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
func writeMark(_ filename: String, size: Int, color: NSColor) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(size) / 64, y: CGFloat(size) / 64)
    // AppKit 的纵坐标向上；轮廓等价于 SVG 的 M 字母。
    let points: [NSPoint] = [(16,15),(16,49),(24,49),(32,33),(40,49),(48,49),
        (48,15),(40,15),(40,34),(34,22),(30,22),(24,34),(24,15)].map { NSPoint(x: $0.0, y: $0.1) }
    let shape = NSBezierPath()
    shape.move(to: points[0])
    for point in points.dropFirst() { shape.line(to: point) }
    shape.close()
    color.setFill()
    shape.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: root.appendingPathComponent(filename))
}
try writeMark("build/icons/mico-trayTemplate.png", size: 18, color: .black)
try writeMark("build/icons/mico-trayTemplate@2x.png", size: 36, color: .black)
try writeMark("src/assets/images/tray/mico-monogram.png", size: 18, color: .white)
try writeMark("src/assets/images/tray/mico-monogram@2x.png", size: 36, color: .white)
