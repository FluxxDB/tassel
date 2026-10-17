import Foundation

/// The helper protocol's version: `hello` must carry it, and `welcome` reports it.
public let protocolVersion = 1

public enum HelperError: Error, Equatable {
  /// A binary frame whose header is short, has the wrong magic, or another version.
  case badFrame
  /// A text message the protocol doesn't allow. The explanation never repeats the message's
  /// values, so it can go to the client or the log without leaking a token.
  case badMessage(String)
}

/// What `start` asks for. The values are clamped to what the helper supports: fps 1–30,
/// maxWidth 320–1920 and quality 0.5–0.95.
public struct StartOptions: Codable, Equatable, Sendable {
  public var deviceId: String?
  public var fps: Int
  public var maxWidth: Int
  public var quality: Double

  static let fpsRange = 1...30
  static let maxWidthRange = 320...1920
  static let qualityRange = 0.5...0.95

  public init(deviceId: String? = nil, fps: Int = 15, maxWidth: Int = 1920, quality: Double = 0.85) {
    self.deviceId = deviceId
    self.fps = fps.clamped(to: Self.fpsRange)
    self.maxWidth = maxWidth.clamped(to: Self.maxWidthRange)
    self.quality = quality.isNaN ? 0.85 : quality.clamped(to: Self.qualityRange)
  }

  /// A missing or null field takes its default; every value is clamped.
  public init(from decoder: any Decoder) throws {
    let fields = try decoder.container(keyedBy: CodingKeys.self)
    let defaults = StartOptions()
    self.init(
      deviceId: try fields.decodeIfPresent(String.self, forKey: .deviceId),
      fps: try fields.decodeIfPresent(Int.self, forKey: .fps) ?? defaults.fps,
      maxWidth: try fields.decodeIfPresent(Int.self, forKey: .maxWidth) ?? defaults.maxWidth,
      quality: try fields.decodeIfPresent(Double.self, forKey: .quality) ?? defaults.quality)
  }

  private enum CodingKeys: String, CodingKey {
    case deviceId, fps, maxWidth, quality
  }
}

/// A text message from the app, after `decodeClientMessage`.
public enum ClientMessage: Equatable, Sendable {
  case hello(token: String, protocolVersion: Int)
  case list
  case start(StartOptions)
  case stop
  case openSetup
}

public struct DeviceInfo: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var builtIn: Bool

  public init(id: String, name: String, builtIn: Bool) {
    self.id = id
    self.name = name
    self.builtIn = builtIn
  }
}

public enum ErrorCode: String, Codable, Sendable {
  case auth
  case permissionDenied = "permission-denied"
  case noDevice = "no-device"
  case deviceLost = "device-lost"
  case busy
  case badRequest = "bad-request"
  case internalError = "internal"
}

/// A text message to the app. `state` is starting, running or stopped; `camera` is authorized,
/// denied, restricted or notDetermined; a setup `result` is presented or failed.
public enum ServerMessage: Equatable, Sendable {
  case welcome(helperVersion: String, camera: String)
  case devices([DeviceInfo])
  case status(state: String, width: Int, height: Int, fps: Int)
  case error(ErrorCode, String)
  case setup(result: String, message: String?)
}

/// Decodes one text message: a JSON object whose `type` names the message. Fields it doesn't
/// know are ignored.
public func decodeClientMessage(_ text: String) throws(HelperError) -> ClientMessage {
  let data = Data(text.utf8)
  let decoder = JSONDecoder()
  let type: String
  do {
    type = try decoder.decode(Envelope.self, from: data).type
  } catch {
    throw .badMessage("expected a JSON object with a string type")
  }
  switch type {
  case "hello":
    do {
      let hello = try decoder.decode(Hello.self, from: data)
      return .hello(token: hello.token, protocolVersion: hello.protocol)
    } catch {
      throw .badMessage("hello needs a string token and an integer protocol")
    }
  case "list":
    return .list
  case "start":
    do {
      return .start(try decoder.decode(StartOptions.self, from: data))
    } catch {
      throw .badMessage("start needs a string or null deviceId, integer fps and maxWidth, and a number quality")
    }
  case "stop":
    return .stop
  case "openSetup":
    return .openSetup
  default:
    throw .badMessage("unknown message type")
  }
}

/// Encodes one text message as compact JSON with sorted keys; `welcome` carries `"protocol":1`.
public func encodeServerMessage(_ message: ServerMessage) -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  // Strings, integers and booleans always encode, so the fallback is never expected.
  guard let data = try? encoder.encode(OutgoingMessage(message)),
    let text = String(data: data, encoding: .utf8)
  else {
    return #"{"code":"internal","message":"encoding failed","type":"error"}"#
  }
  return text
}

private struct Envelope: Decodable {
  let type: String
}

private struct Hello: Decodable {
  let token: String
  let `protocol`: Int
}

private struct OutgoingMessage: Encodable {
  let message: ServerMessage

  init(_ message: ServerMessage) {
    self.message = message
  }

  private enum Keys: String, CodingKey {
    case type, `protocol`, helperVersion, camera, devices, state, width, height, fps, code, message,
      result
  }

  func encode(to encoder: any Encoder) throws {
    var fields = encoder.container(keyedBy: Keys.self)
    switch message {
    case .welcome(let helperVersion, let camera):
      try fields.encode("welcome", forKey: .type)
      try fields.encode(protocolVersion, forKey: .protocol)
      try fields.encode(helperVersion, forKey: .helperVersion)
      try fields.encode(camera, forKey: .camera)
    case .devices(let devices):
      try fields.encode("devices", forKey: .type)
      try fields.encode(devices, forKey: .devices)
    case .status(let state, let width, let height, let fps):
      try fields.encode("status", forKey: .type)
      try fields.encode(state, forKey: .state)
      try fields.encode(width, forKey: .width)
      try fields.encode(height, forKey: .height)
      try fields.encode(fps, forKey: .fps)
    case .error(let code, let text):
      try fields.encode("error", forKey: .type)
      try fields.encode(code, forKey: .code)
      try fields.encode(text, forKey: .message)
    case .setup(let result, let text):
      try fields.encode("setup", forKey: .type)
      try fields.encode(result, forKey: .result)
      try fields.encodeIfPresent(text, forKey: .message)
    }
  }
}

extension Comparable {
  fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
