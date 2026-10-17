import Foundation

/// The 24-byte big-endian header in front of each frame's JPEG, in the helper's binary messages:
///
/// | Bytes | Field |
/// |---|---|
/// | 0–3 | magic `TSLF` (`54 53 4C 46`) |
/// | 4–5 | version, u16 = 1 |
/// | 6–7 | flags, u16 = 1 |
/// | 8–11 | seq, u32 |
/// | 12–19 | ptsMicros, u64 |
/// | 20–21 | width, u16 |
/// | 22–23 | height, u16 |
public struct FrameHeader: Equatable, Sendable {
  public static let size = 24
  static let magic: [UInt8] = [0x54, 0x53, 0x4C, 0x46]
  static let version: UInt16 = 1
  static let flags: UInt16 = 1

  public var seq: UInt32
  public var ptsMicros: UInt64
  public var width: UInt16
  public var height: UInt16

  public init(seq: UInt32, ptsMicros: UInt64, width: UInt16, height: UInt16) {
    self.seq = seq
    self.ptsMicros = ptsMicros
    self.width = width
    self.height = height
  }

  public func encoded() -> Data {
    var data = Data(capacity: Self.size)
    data.append(contentsOf: Self.magic)
    data.appendBigEndian(Self.version)
    data.appendBigEndian(Self.flags)
    data.appendBigEndian(seq)
    data.appendBigEndian(ptsMicros)
    data.appendBigEndian(width)
    data.appendBigEndian(height)
    return data
  }

  /// Reads the header at the start of `data`, which may go on with the JPEG. It checks the
  /// magic and the version; the flags are left alone, so a later flag doesn't break this reader.
  public static func decode(_ data: Data) throws(HelperError) -> FrameHeader {
    guard data.count >= size else { throw .badFrame }
    let bytes = [UInt8](data.prefix(size))
    guard Array(bytes[0..<4]) == magic, readBigEndian(bytes, at: 4) as UInt16 == version else {
      throw .badFrame
    }
    return FrameHeader(
      seq: readBigEndian(bytes, at: 8),
      ptsMicros: readBigEndian(bytes, at: 12),
      width: readBigEndian(bytes, at: 20),
      height: readBigEndian(bytes, at: 22))
  }
}

/// One binary message: the header, then the JPEG (`FF D8 … FF D9`).
public func frameMessage(_ header: FrameHeader, jpeg: Data) -> Data {
  var message = header.encoded()
  message.append(jpeg)
  return message
}

extension Data {
  fileprivate mutating func appendBigEndian<T: FixedWidthInteger>(_ value: T) {
    Swift.withUnsafeBytes(of: value.bigEndian) { append(contentsOf: $0) }
  }
}

private func readBigEndian<T: FixedWidthInteger>(_ bytes: [UInt8], at offset: Int) -> T {
  bytes[offset..<offset + MemoryLayout<T>.size].reduce(T.zero) { $0 << 8 | T($1) }
}
