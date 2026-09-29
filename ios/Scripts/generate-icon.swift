import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("Uso: generate-icon.swift <salida.png>\n", stderr)
    exit(2)
}

let pixels = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 3,
    hasAlpha: false,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 24
), let context = NSGraphicsContext(bitmapImageRep: bitmap)?.cgContext else {
    fatalError("No se pudo crear el lienzo del icono")
}

context.setFillColor(CGColor(red: 11.0 / 255.0, green: 12.0 / 255.0, blue: 14.0 / 255.0, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: pixels, height: pixels))

let scale = CGFloat(pixels) / 24
context.saveGState()
context.translateBy(x: 0, y: CGFloat(pixels))
context.scaleBy(x: scale, y: -scale)

let border = CGPath(
    roundedRect: CGRect(x: 0.5, y: 0.5, width: 23, height: 23),
    cornerWidth: 6,
    cornerHeight: 6,
    transform: nil
)
context.addPath(border)
context.setStrokeColor(CGColor(red: 37.0 / 255.0, green: 39.0 / 255.0, blue: 45.0 / 255.0, alpha: 1))
context.setLineWidth(0.7)
context.strokePath()

context.setStrokeColor(CGColor(red: 214.0 / 255.0, green: 214.0 / 255.0, blue: 220.0 / 255.0, alpha: 1))
context.setLineWidth(1.8)
context.setLineCap(.round)
context.setLineJoin(.round)

let leftLink = CGMutablePath()
leftLink.move(to: CGPoint(x: 9.35, y: 14.65))
leftLink.addLine(to: CGPoint(x: 7.5, y: 16.5))
leftLink.addCurve(to: CGPoint(x: 3, y: 12), control1: CGPoint(x: 5.74, y: 18.26), control2: CGPoint(x: 1.24, y: 16.5))
leftLink.addLine(to: CGPoint(x: 6, y: 9))
leftLink.addCurve(to: CGPoint(x: 10.5, y: 9), control1: CGPoint(x: 7.24, y: 7.76), control2: CGPoint(x: 9.26, y: 7.76))
context.addPath(leftLink)
context.strokePath()

let rightLink = CGMutablePath()
rightLink.move(to: CGPoint(x: 14.65, y: 9.35))
rightLink.addLine(to: CGPoint(x: 16.5, y: 7.5))
rightLink.addCurve(to: CGPoint(x: 21, y: 12), control1: CGPoint(x: 18.26, y: 5.74), control2: CGPoint(x: 22.76, y: 7.5))
rightLink.addLine(to: CGPoint(x: 18, y: 15))
rightLink.addCurve(to: CGPoint(x: 13.5, y: 15), control1: CGPoint(x: 16.76, y: 16.24), control2: CGPoint(x: 14.74, y: 16.24))
context.addPath(rightLink)
context.strokePath()

let play = CGMutablePath()
play.move(to: CGPoint(x: 9.2, y: 7.7))
play.addLine(to: CGPoint(x: 9.2, y: 16.3))
play.addLine(to: CGPoint(x: 16, y: 12))
play.closeSubpath()
context.addPath(play)
context.setFillColor(CGColor(red: 1, green: 59.0 / 255.0, blue: 48.0 / 255.0, alpha: 1))
context.fillPath()
context.restoreGState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("No se pudo codificar el icono")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
