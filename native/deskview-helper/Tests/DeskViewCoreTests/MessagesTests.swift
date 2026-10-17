import DeskViewCore
import Foundation
import Testing

/// The start options a decoded `start` message carries; nil for any other message.
private func startOptions(_ text: String) throws -> StartOptions? {
  guard case .start(let options) = try decodeClientMessage(text) else { return nil }
  return options
}

/// True when decoding fails with `badMessage`, whatever its explanation.
private func isBadMessage(_ text: String) -> Bool {
  do {
    _ = try decodeClientMessage(text)
    return false
  } catch {
    guard case .badMessage = error else { return false }
    return true
  }
}

@Test func clientMessagesDecode() throws {
  #expect(
    try decodeClientMessage(#"{"type":"hello","token":"abc123","protocol":1}"#)
      == .hello(token: "abc123", protocolVersion: 1))
  #expect(try decodeClientMessage(#"{"type":"list"}"#) == .list)
  #expect(try decodeClientMessage(#"{"type":"stop"}"#) == .stop)
  #expect(try decodeClientMessage(#"{"type":"openSetup"}"#) == .openSetup)
  #expect(try decodeClientMessage(#"{"type":"list","extra":true}"#) == .list)

  let options = try #require(
    try startOptions(#"{"type":"start","deviceId":"desk-1","fps":10,"maxWidth":1280,"quality":0.7}"#))
  #expect(options.deviceId == "desk-1")
  #expect(options.fps == 10)
  #expect(options.maxWidth == 1280)
  #expect(options.quality == 0.7)
}

@Test func startDecodesDefaultsAndClamps() throws {
  let high = try #require(try startOptions(#"{"type":"start","fps":60,"maxWidth":99999}"#))
  #expect(high.fps == 30)
  #expect(high.maxWidth == 1920)
  #expect(high.quality == 0.85)
  #expect(high.deviceId == nil)

  let low = try #require(try startOptions(#"{"type":"start","fps":0,"maxWidth":10,"quality":0.1}"#))
  #expect(low.fps == 1)
  #expect(low.maxWidth == 320)
  #expect(low.quality == 0.5)

  #expect(try startOptions(#"{"type":"start","quality":2}"#)?.quality == 0.95)

  let defaults = try #require(try startOptions(#"{"type":"start","deviceId":null}"#))
  #expect(defaults == StartOptions(deviceId: nil, fps: 15, maxWidth: 1920, quality: 0.85))
  #expect(defaults == StartOptions())
}

@Test func unknownTypeIsBadMessage() {
  #expect(isBadMessage(#"{"type":"dance"}"#))
  #expect(isBadMessage(#"{"type":"Hello","token":"abc123","protocol":1}"#))
}

@Test func malformedMessagesAreBadMessages() {
  for text in [
    "", "nope", "{}", "[]", #""list""#, #"{"type":5}"#,
    #"{"type":"hello"}"#, #"{"type":"hello","token":"abc123"}"#,
    #"{"type":"hello","token":7,"protocol":1}"#, #"{"type":"hello","token":"abc123","protocol":"1"}"#,
    #"{"type":"start","fps":"fast"}"#, #"{"type":"start","fps":15.5}"#, #"{"type":"start","deviceId":7}"#,
  ] {
    #expect(isBadMessage(text), "\(text)")
  }
}

@Test func errorEncodesKebabCode() {
  #expect(
    encodeServerMessage(.error(.permissionDenied, "x"))
      == #"{"code":"permission-denied","message":"x","type":"error"}"#)

  let codes: [ErrorCode] = [.auth, .permissionDenied, .noDevice, .deviceLost, .busy, .badRequest, .internalError]
  #expect(
    codes.map(\.rawValue)
      == ["auth", "permission-denied", "no-device", "device-lost", "busy", "bad-request", "internal"])
}

@Test func serverMessagesEncodeAsCompactJsonWithSortedKeys() throws {
  #expect(
    encodeServerMessage(.welcome(helperVersion: "0.1.0", camera: "authorized"))
      == #"{"camera":"authorized","helperVersion":"0.1.0","protocol":1,"type":"welcome"}"#)
  #expect(
    encodeServerMessage(.devices([DeviceInfo(id: "clip", name: "Test clip", builtIn: true)]))
      == #"{"devices":[{"builtIn":true,"id":"clip","name":"Test clip"}],"type":"devices"}"#)
  #expect(encodeServerMessage(.devices([])) == #"{"devices":[],"type":"devices"}"#)
  #expect(
    encodeServerMessage(.status(state: "running", width: 1920, height: 1440, fps: 15))
      == #"{"fps":15,"height":1440,"state":"running","type":"status","width":1920}"#)
  #expect(
    encodeServerMessage(.setup(result: "presented", message: nil))
      == #"{"result":"presented","type":"setup"}"#)
  #expect(
    encodeServerMessage(.setup(result: "failed", message: "Desk View is unavailable"))
      == #"{"message":"Desk View is unavailable","result":"failed","type":"setup"}"#)

  // Quotes and newlines are escaped, so any message stays one valid JSON line.
  let text = encodeServerMessage(.error(.internalError, "said \"no\"/twice\n"))
  #expect(text == #"{"code":"internal","message":"said \"no\"/twice\n","type":"error"}"#)
  let parsed = try #require(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: String])
  #expect(parsed["message"] == "said \"no\"/twice\n")
}

@Test func readyLineIsTheContractLine() {
  #expect(readyLine(port: 54_321) == #"{"event":"ready","port":54321,"protocol":1}"#)
}
