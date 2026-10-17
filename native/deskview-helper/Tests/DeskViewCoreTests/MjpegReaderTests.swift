import CoreImage
import DeskViewCore
import Foundation
import Testing

/// A small JPEG of one solid colour, encoded by Core Image.
private func solidJpeg(_ color: CIColor) throws -> Data {
  let image = CIImage(color: color).cropped(to: CGRect(x: 0, y: 0, width: 16, height: 12))
  let space = try #require(CGColorSpace(name: CGColorSpace.sRGB))
  return try #require(CIContext().jpegRepresentation(of: image, colorSpace: space, options: [:]))
}

@Test func mjpegReaderSplitsThreeJpegsAndIgnoresTrailingBytes() throws {
  let jpegs = try [CIColor.red, CIColor.green, CIColor.blue].map(solidJpeg)
  for jpeg in jpegs {
    #expect(jpeg.prefix(2) == Data([0xFF, 0xD8]))
    #expect(jpeg.suffix(2) == Data([0xFF, 0xD9]))
  }
  // Junk, then a JPEG cut off right after its SOI.
  let trailing = Data([0x00, 0x13, 0xFF, 0xD8, 0xFF])
  let stream = jpegs.reduce(Data(), +) + trailing
  #expect(Array(MjpegReader(data: stream)) == jpegs)

  // A slice keeps its parent's indices; reading must not assume it starts at zero.
  #expect(Array(MjpegReader(data: (Data([0xAB]) + stream).dropFirst())) == jpegs)
  // Each JPEG comes out on its own, indexed from zero.
  #expect(Array(MjpegReader(data: stream)).allSatisfy { $0.startIndex == 0 })

  #expect(Array(MjpegReader(data: Data())).isEmpty)
  #expect(Array(MjpegReader(data: trailing)).isEmpty)
}

@Test func mjpegReaderSkipsAnEoiInsideApp1() throws {
  let jpeg = try solidJpeg(.red)
  // An APP1 (EXIF) segment whose payload holds an EOI, then a whole thumbnail, as EXIF can.
  let payload = Data("Exif\0\0".utf8) + Data([0x01, 0xFF, 0xD9, 0x02, 0xFF, 0xD8, 0xFF, 0xD9, 0x03])
  let length = payload.count + 2
  let app1 = Data([0xFF, 0xE1, UInt8(length >> 8), UInt8(length & 0xFF)]) + payload
  let withExif = jpeg.prefix(2) + app1 + jpeg.dropFirst(2)
  let next = try solidJpeg(.blue)
  #expect(Array(MjpegReader(data: withExif + next)) == [withExif, next])
}

@Test func mjpegReaderScansEntropyDataPastStuffedBytesAndRestartMarkers() {
  // Two scans, as a progressive JPEG has: entropy-coded data with a stuffed FF00 and an RST3, a
  // table between the scans whose payload holds FFD9, and a fill byte before the EOI.
  let jpeg = Data([
    0xFF, 0xD8,  // SOI
    0xFF, 0xDB, 0x00, 0x04, 0x01, 0x02,  // DQT with 2 payload bytes
    0xFF, 0xDA, 0x00, 0x03, 0x03,  // SOS with 1 payload byte
    0x11, 0xFF, 0x00, 0x22, 0xFF, 0xD3, 0x33,  // entropy-coded data
    0xFF, 0xC4, 0x00, 0x04, 0xFF, 0xD9,  // DHT whose payload is FFD9
    0xFF, 0xDA, 0x00, 0x03, 0x04,  // the second SOS
    0x44, 0xFF, 0x00, 0x55,  // entropy-coded data
    0xFF, 0xFF, 0xD9,  // a fill byte, then EOI
  ])
  // An SOI with no marker after it is junk, not the start of a JPEG.
  let junk = Data([0x00, 0xFF, 0xD8, 0x12])
  #expect(Array(MjpegReader(data: junk + jpeg + junk + jpeg)) == [jpeg, jpeg])

  // Cut anywhere before its EOI, the JPEG is incomplete, so nothing comes out.
  for end in 2..<jpeg.count {
    #expect(Array(MjpegReader(data: jpeg.prefix(end))).isEmpty, "cut at \(end)")
  }
}
