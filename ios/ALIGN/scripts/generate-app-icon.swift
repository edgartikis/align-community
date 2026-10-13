#!/usr/bin/env swift
import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Uso: swift generate-app-icon.swift <logo-fuente.png|approved-icon.b64> <destino.png>\n", stderr)
    exit(2)
}

let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
let officialIcon = input.hasSuffix(".b64")

let sourceData: Data
do {
    let data = try Data(contentsOf: URL(fileURLWithPath: input))
    if officialIcon {
        let encoded = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let decoded = Data(base64Encoded: encoded) else {
            fatalError("El ícono aprobado ALIGN no tiene una codificación válida.")
        }
        sourceData = decoded
    } else {
        sourceData = data
    }
} catch {
    fputs("No se pudo leer el logo ALIGN: \(input): \(error)\n", stderr)
    exit(2)
}

guard let logo = NSImage(data: sourceData) else {
    fatalError("El archivo de logo ALIGN no contiene una imagen válida.")
}
let size = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("No se pudo preparar el ícono.")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
// Official branding: white ram and ALIGN letters, on a pure black background.
(officialIcon ? NSColor.black : NSColor(calibratedRed: 0.035, green: 0.051, blue: 0.075, alpha: 1)).setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

let original = logo.size
let frame: NSRect
if officialIcon {
    // The approved square already includes its own black margins.
    frame = NSRect(x: 0, y: 0, width: size, height: size)
} else {
    let maxDimension: CGFloat = 730
    let factor = min(maxDimension / max(original.width, 1),
                     maxDimension / max(original.height, 1))
    let scaled = NSSize(width: original.width * factor, height: original.height * factor)
    frame = NSRect(x: (CGFloat(size) - scaled.width) / 2,
                   y: (CGFloat(size) - scaled.height) / 2,
                   width: scaled.width, height: scaled.height)
}
logo.draw(in: frame, from: NSRect(origin: .zero, size: original),
          operation: .sourceOver, fraction: 1)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("No se pudo exportar el ícono como PNG.")
}
try FileManager.default.createDirectory(
    at: URL(fileURLWithPath: output).deletingLastPathComponent(),
    withIntermediateDirectories: true)
try png.write(to: URL(fileURLWithPath: output), options: .atomic)
print("Ícono oficial ALIGN (1024 x 1024, sin transparencia): \(output)")
