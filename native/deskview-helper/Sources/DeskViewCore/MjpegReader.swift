import Foundation

/// The JPEGs in an MJPEG file (concatenated JPEGs), each from its SOI to its EOI.
///
/// It walks each JPEG's segments by their lengths up to SOS, then scans the entropy-coded data
/// for `FF xx` where `xx` is neither `00` (a stuffed byte) nor `D0`–`D7` (a restart marker); that
/// marker ends the scan, and the walk goes on (a progressive JPEG has several scans) until EOI.
/// It never searches for `FF D9` alone, because an EXIF thumbnail inside APP1 can contain one.
/// Bytes between JPEGs are skipped, and so is an SOI not followed by a marker. A JPEG cut off by
/// the end of the data is dropped, along with anything after it.
public struct MjpegReader: Sequence, Sendable {
  private let data: Data

  public init(data: Data) {
    self.data = data
  }

  public func makeIterator() -> Iterator {
    Iterator(data: data)
  }

  public struct Iterator: IteratorProtocol, Sendable {
    private let data: Data
    /// Where the search for the next JPEG starts, counted from `data.startIndex`.
    private var offset = 0

    init(data: Data) {
      self.data = data
    }

    /// The next JPEG, as its own `Data` indexed from zero.
    public mutating func next() -> Data? {
      let from = offset
      let found = data.withUnsafeBytes { nextJpeg(in: $0, from: from) }
      guard let found else {
        offset = data.count
        return nil
      }
      offset = found.upperBound
      let start = data.startIndex
      return Data(data[(start + found.lowerBound)..<(start + found.upperBound)])
    }
  }
}

/// A JPEG marker is FF, then its code.
private enum Marker {
  static let prefix: UInt8 = 0xFF
  static let soi: UInt8 = 0xD8
  static let eoi: UInt8 = 0xD9
  static let sos: UInt8 = 0xDA
  static let tem: UInt8 = 0x01
  static let restarts: ClosedRange<UInt8> = 0xD0...0xD7
}

private enum Parse {
  case complete(end: Int)
  /// Not a JPEG after all: look for the next SOI.
  case invalid
  /// The data ends inside this JPEG.
  case truncated
}

/// The range of the next complete JPEG at or after `from`, or nil when there is none.
private func nextJpeg(in bytes: UnsafeRawBufferPointer, from: Int) -> Range<Int>? {
  var search = from
  while let start = findSoi(in: bytes, from: search) {
    switch parseJpeg(in: bytes, at: start) {
    case .complete(let end):
      return start..<end
    case .invalid:
      search = start + 2
    case .truncated:
      return nil
    }
  }
  return nil
}

private func findSoi(in bytes: UnsafeRawBufferPointer, from: Int) -> Int? {
  var index = from
  while index + 1 < bytes.count {
    if bytes[index] == Marker.prefix, bytes[index + 1] == Marker.soi { return index }
    index += 1
  }
  return nil
}

private func parseJpeg(in bytes: UnsafeRawBufferPointer, at start: Int) -> Parse {
  let count = bytes.count
  var index = start + 2
  while true {
    // A marker: FF, any number of FF fill bytes, then its code.
    guard index < count else { return .truncated }
    guard bytes[index] == Marker.prefix else { return .invalid }
    while index < count, bytes[index] == Marker.prefix { index += 1 }
    guard index < count else { return .truncated }
    let code = bytes[index]
    index += 1

    if code == Marker.eoi { return .complete(end: index) }
    if code == Marker.soi || code == 0x00 { return .invalid }
    if code == Marker.tem || Marker.restarts.contains(code) { continue }  // standalone, no length

    // A segment: a big-endian length that counts itself, then its payload.
    guard index + 2 <= count else { return .truncated }
    let length = Int(bytes[index]) << 8 | Int(bytes[index + 1])
    guard length >= 2 else { return .invalid }
    guard index + length <= count else { return .truncated }
    index += length

    if code == Marker.sos {
      // Entropy-coded data, up to the first FF that isn't a stuffed byte or a restart marker.
      while true {
        while index < count, bytes[index] != Marker.prefix { index += 1 }
        guard index + 1 < count else { return .truncated }
        let next = bytes[index + 1]
        if next == 0x00 || Marker.restarts.contains(next) {
          index += 2
        } else {
          break  // a marker (FF fill bytes included): the walk above reads it
        }
      }
    }
  }
}
