#!/usr/bin/env swift
import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Uso: swift generate-app-icon.swift <logo-fuente.png> <destino.png>\n", stderr)
    exit(2)
}
let input = CommandLine.arguments[1]
let output = CommandLine.arguments[2]
guard let logo = NSImage(contentsOfFile: input) else {
    fputs("No se encontró el logo ALIGN: \(input)\n", stderr)
    exit(2)
}
let size = 1024
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("No se pudo preparar el icono.")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSColor(calibratedRed: 0.035, green: 0.051, blue: 0.075, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

let original = logo.size
let maxDimension: CGFloat = 730
let factor = min(maxDimension / max(original.width, 1),
                 maxDimension / max(original.height, 1))
let scaled = NSSize(width: original.width * factor, height: original.height * factor)
let frame = NSRect(x: (CGFloat(size) - scaled.width) / 2,
                   y: (CGFloat(size) - scaled.height) / 2,
                   width: scaled.width, height: scaled.height)
logo.draw(in: frame, from: NSRect(origin: .zero, size: original),
          operation: .sourceOver, fraction: 1)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("No se pudo exportar la imagen.")
}
try FileManager.default.createDirectory(
    at: URL(fileURLWithPath: output).deletingLastPathComponent(),
    withIntermediateDirectories: true)
try png.write(to: URL(fileURLWithPath: output), options: .atomic)
print("Icono oficial ALIGN generado: \(output)")
