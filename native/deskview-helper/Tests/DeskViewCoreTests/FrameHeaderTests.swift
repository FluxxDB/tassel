import DeskViewCore
import Foundation
import Testing

/// Bytes from hex digits; spaces are ignored.
private func hexBytes(_ hex: String) -> Data {
  let digits = Array(hex.filter { $0 != " " })
  return Data(stride(from: 0, to: digits.count, by: 2).map { UInt8(String(digits[$0...$0 + 1]), radix: 16)! })
}

/// The contract fixture both languages test (Global Constraints, "Helper protocol v1"): seq 7,
/// pts 1,234,567 µs, 4×3, then the 4-byte stand-in JPEG.
private let contractMessage = hexBytes("54534C46 0001 0001 00000007 000000000012D687 0004 0003 FFD8FFD9")

@Test func headerEncodesToTheContractBytes() throws {
  let header = FrameHeader(seq: 7, ptsMicros: 1_234_567, width: 4, height: 3)
  #expect(FrameHeader.size == 24)
  #expect(header.encoded() == contractMessage.prefix(24))

  let message = frameMessage(header, jpeg: Data([0xFF, 0xD8, 0xFF, 0xD9]))
  #expect(message.count == 28)
  #expect(message == contractMessage)

  #expect(try FrameHeader.decode(message) == header)
  // A slice keeps its parent's indices; decoding must not assume it starts at zero.
  #expect(try FrameHeader.decode((Data([0xAA]) + message).dropFirst()) == header)
}

@Test func headerRoundTripsTheLargestValues() throws {
  let header = FrameHeader(seq: .max, ptsMicros: .max, width: .max, height: .max)
  #expect(try FrameHeader.decode(header.encoded()) == header)
}

@Test func headerRejectsWrongMagicShortDataAndVersion2() {
  var wrongMagic = contractMessage
  wrongMagic[0] = 0x55
  #expect(throws: HelperError.badFrame) { try FrameHeader.decode(wrongMagic) }

  #expect(throws: HelperError.badFrame) { try FrameHeader.decode(contractMessage.prefix(23)) }
  #expect(throws: HelperError.badFrame) { try FrameHeader.decode(Data()) }

  var version2 = contractMessage
  version2[5] = 0x02
  #expect(throws: HelperError.badFrame) { try FrameHeader.decode(version2) }
}
