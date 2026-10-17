import DeskViewCore
import Foundation

/// Why a producer couldn't start. Each one reaches the client as an `error` message.
enum ProducerFailure: Error, Equatable {
  case permissionDenied
  case noDevice
  case failed(String)

  var errorCode: ErrorCode {
    switch self {
    case .permissionDenied: .permissionDenied
    case .noDevice: .noDevice
    case .failed: .internalError
    }
  }

  var message: String {
    switch self {
    case .permissionDenied: "camera access is denied"
    case .noDevice: "no Desk View camera"
    case .failed(let reason): reason
    }
  }
}

/// Where frames come from: the Desk View camera, or a test clip. The connection calls it on the
/// helper's queue, and paces what it delivers.
protocol FrameProducer: AnyObject, Sendable {
  /// The camera's authorization as `welcome` reports it: authorized, denied, restricted or
  /// notDetermined.
  var cameraAccess: String { get }
  func devices() -> [DeviceInfo]
  /// onFrame: (jpeg, width, height, ptsMicros). onError ends the stream.
  func start(
    _ options: StartOptions, onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void,
    onError: @escaping @Sendable (ErrorCode, String) -> Void) throws(ProducerFailure)
  /// Stops delivering frames and releases the device before it returns. Safe to call when
  /// stopped.
  func stop()
}
