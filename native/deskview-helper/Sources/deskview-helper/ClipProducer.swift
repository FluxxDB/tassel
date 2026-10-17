import DeskViewCore
import Foundation
import ImageIO

/// Plays an MJPEG file in place of the camera (`TASSEL_HELPER_CLIP`): its own timeline at
/// 30 frames per second, as Chromium plays one, looping at the end. A late tick skips ahead
/// rather than slowing the clip, and the connection's Pacer thins it to the requested fps. It
/// sends the clip's JPEGs as they are (maxWidth and quality are for the camera), and it never
/// touches a camera or asks for camera access.
final class ClipProducer: FrameProducer, @unchecked Sendable {
  struct Frame: Sendable {
    let jpeg: Data
    let width: UInt16
    let height: UInt16
  }

  private let path: String
  private let queue = DispatchQueue(label: "dev.tassel.deskview-helper.clip")
  // Touched only on the helper's queue, from start and stop.
  private var frames: [Frame]?
  private var timer: (any DispatchSourceTimer)?

  init(path: String) {
    self.path = path
  }

  var cameraAccess: String { "authorized" }

  func devices() -> [DeviceInfo] {
    [DeviceInfo(id: "clip", name: "Test clip", builtIn: true)]
  }

  func start(
    _ options: StartOptions, onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void,
    onError: @escaping @Sendable (ErrorCode, String) -> Void
  ) throws(ProducerFailure) {
    let playback = Playback(frames: try loadFrames(), onFrame: onFrame)
    stop()
    let started = DispatchTime.now().uptimeNanoseconds
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(
      deadline: .now(), repeating: .nanoseconds(Int(Playback.nanosPerFrame)), leeway: .milliseconds(1))
    timer.setEventHandler {
      playback.tick(elapsedNanos: DispatchTime.now().uptimeNanoseconds - started)
    }
    timer.resume()
    self.timer = timer
  }

  func stop() {
    timer?.cancel()
    timer = nil
  }

  /// Splits the clip once, on its first start.
  private func loadFrames() throws(ProducerFailure) -> [Frame] {
    if let frames { return frames }
    guard let data = FileManager.default.contents(atPath: path) else {
      throw .failed("can't read the clip")
    }
    let frames = MjpegReader(data: data).compactMap(Frame.init(jpeg:))
    guard let first = frames.first else { throw .failed("the clip holds no JPEG frames") }
    log("clip: \(frames.count) frames, \(first.width)x\(first.height)")
    self.frames = frames
    return frames
  }
}

extension ClipProducer.Frame {
  /// A frame with the JPEG's own pixel size, which ImageIO reads from its header.
  init?(jpeg: Data) {
    guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = (properties[kCGImagePropertyPixelWidth] as? Int).flatMap(UInt16.init(exactly:)),
      let height = (properties[kCGImagePropertyPixelHeight] as? Int).flatMap(UInt16.init(exactly:))
    else { return nil }
    self.init(jpeg: jpeg, width: width, height: height)
  }
}

/// One run of the clip. At each tick it sends the frame due by elapsed time, once; its state is
/// touched only on the clip's queue.
private final class Playback: @unchecked Sendable {
  static let framesPerSecond: UInt64 = 30
  static let nanosPerFrame: UInt64 = 1_000_000_000 / framesPerSecond

  private let frames: [ClipProducer.Frame]
  private let onFrame: @Sendable (Data, UInt16, UInt16, UInt64) -> Void
  private var last: UInt64?

  init(frames: [ClipProducer.Frame], onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void) {
    self.frames = frames
    self.onFrame = onFrame
  }

  func tick(elapsedNanos: UInt64) {
    // The nearest frame time, so a tick a little early or late still lands on its own frame.
    let index = (elapsedNanos * Self.framesPerSecond + 500_000_000) / 1_000_000_000
    if let last, index <= last { return }
    last = index
    let frame = frames[Int(index % UInt64(frames.count))]
    onFrame(frame.jpeg, frame.width, frame.height, index * 1_000_000 / Self.framesPerSecond)
  }
}
