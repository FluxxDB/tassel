import AVFoundation
import CoreImage
import DeskViewCore
import Foundation
import ImageIO

/// The Desk View camera through AVFoundation. Electron's camera grant applies, because TCC
/// answers for the responsible process (Task 1's check H).
///
/// It paces in software with `Pacer`, leaving the device's `activeVideoMinFrameDuration` alone:
/// Desk View has one format, 420v 1920×1440 at 30 fps (WWDC22 10018). Frames are narrowed to
/// `maxWidth` and encoded with one shared CIContext. It never asks for camera access: the app
/// asks first, when `welcome` says notDetermined.
final class CameraProducer: FrameProducer, @unchecked Sendable {
  /// startRunning and stopRunning block, so they run on their own queue.
  private let sessionQueue = DispatchQueue(label: "dev.tassel.deskview-helper.session")
  private let videoQueue = DispatchQueue(label: "dev.tassel.deskview-helper.video")
  private let context = CIContext()
  // Touched only on the helper's queue, from start and stop.
  private var session: AVCaptureSession?
  private var encoder: FrameEncoder?
  private var observers: [any NSObjectProtocol] = []

  var cameraAccess: String {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: "authorized"
    case .denied: "denied"
    case .restricted: "restricted"
    case .notDetermined: "notDetermined"
    @unknown default: "denied"
    }
  }

  func devices() -> [DeviceInfo] {
    deskViewCameras().map(Self.info)
  }

  func start(
    _ options: StartOptions, onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void,
    onError: @escaping @Sendable (ErrorCode, String) -> Void
  ) throws(ProducerFailure) {
    stop()
    // Opening a device without access would make macOS ask; the app asks instead.
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw .permissionDenied
    }
    let cameras = deskViewCameras()
    guard let picked = pickDevice(options.deviceId, from: cameras.map(Self.info)),
      let device = cameras.first(where: { $0.uniqueID == picked.id })
    else { throw .noDevice }

    let session = AVCaptureSession()
    let encoder = FrameEncoder(options: options, context: context, onFrame: onFrame)
    session.beginConfiguration()
    do {
      let input = try AVCaptureDeviceInput(device: device)
      guard session.canAddInput(input) else {
        throw ProducerFailure.failed("can't use \(device.localizedName)")
      }
      session.addInput(input)
      let output = AVCaptureVideoDataOutput()
      output.alwaysDiscardsLateVideoFrames = true
      output.setSampleBufferDelegate(encoder, queue: videoQueue)
      guard session.canAddOutput(output) else {
        throw ProducerFailure.failed("can't read \(device.localizedName)")
      }
      session.addOutput(output)
      session.commitConfiguration()
    } catch let failure as ProducerFailure {
      session.commitConfiguration()
      throw failure
    } catch {
      session.commitConfiguration()
      throw .failed("can't open \(device.localizedName): \(error.localizedDescription)")
    }

    // The iPhone walks away, another app takes the camera, the lid closes: the stream is lost.
    let lost: @Sendable (Notification) -> Void = { notification in
      let reason =
        switch notification.name {
        case AVCaptureDevice.wasDisconnectedNotification: "the Desk View camera was disconnected"
        case AVCaptureSession.wasInterruptedNotification: "the Desk View camera was interrupted"
        default: "the Desk View camera stopped"
        }
      onError(.deviceLost, reason)
    }
    let watch = { (name: Notification.Name, object: AnyObject) in
      NotificationCenter.default.addObserver(forName: name, object: object, queue: nil, using: lost)
    }
    observers = [
      watch(AVCaptureDevice.wasDisconnectedNotification, device),
      watch(AVCaptureSession.runtimeErrorNotification, session),
      watch(AVCaptureSession.wasInterruptedNotification, session),
    ]
    self.session = session
    self.encoder = encoder
    let running = SessionBox(session)
    sessionQueue.async { running.session.startRunning() }
    log("camera: \(picked.builtIn ? "built-in" : "Continuity Camera") Desk View, \(options.fps) fps")
  }

  func stop() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    guard let session else { return }
    self.session = nil
    // Synchronous, so the camera (and its light) is off when stop returns. The output holds its
    // delegate weakly, so the encoder goes only after the last frame.
    let stopping = SessionBox(session)
    sessionQueue.sync { stopping.session.stopRunning() }
    encoder = nil
  }

  private func deskViewCameras() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.deskViewCamera], mediaType: .video, position: .unspecified
    ).devices
  }

  private static func info(_ device: AVCaptureDevice) -> DeviceInfo {
    DeviceInfo(id: device.uniqueID, name: device.localizedName, builtIn: !device.isContinuityCamera)
  }
}

/// Carries the session to its queue. AVCaptureSession isn't Sendable, but its start and stop are
/// called only on `sessionQueue`.
private struct SessionBox: @unchecked Sendable {
  let session: AVCaptureSession
  init(_ session: AVCaptureSession) { self.session = session }
}

/// Turns sample buffers into paced JPEGs no wider than maxWidth. It runs only on the video queue.
private final class FrameEncoder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate,
  @unchecked Sendable
{
  private var pacer: Pacer
  private let maxWidth: Int
  private let quality: Double
  private let context: CIContext
  private let space = CGColorSpace(name: CGColorSpace.sRGB)
  private let onFrame: @Sendable (Data, UInt16, UInt16, UInt64) -> Void

  init(
    options: StartOptions, context: CIContext,
    onFrame: @escaping @Sendable (Data, UInt16, UInt16, UInt64) -> Void
  ) {
    // Thinned before encoding, so frames the connection would drop are never encoded.
    pacer = Pacer(fps: options.fps, maxInFlight: .max)
    maxWidth = options.maxWidth
    quality = options.quality
    self.context = context
    self.onFrame = onFrame
  }

  func captureOutput(
    _ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection
  ) {
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard time.isValid, time.isNumeric else { return }
    let micros = CMTimeConvertScale(time, timescale: 1_000_000, method: .roundHalfAwayFromZero).value
    guard micros >= 0, pacer.shouldEmit(ptsMicros: UInt64(micros), inFlight: 0),
      let pixels = CMSampleBufferGetImageBuffer(sampleBuffer), let space
    else { return }

    var image = CIImage(cvPixelBuffer: pixels)
    let size = scaledSize(
      width: Int(image.extent.width), height: Int(image.extent.height), maxWidth: maxWidth)
    if size.width != Int(image.extent.width) {
      let scale = Double(size.width) / image.extent.width
      image = image.applyingFilter(
        "CILanczosScaleTransform", parameters: [kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0]
      ).cropped(to: CGRect(x: 0, y: 0, width: size.width, height: size.height))
    }
    let qualityKey = CIImageRepresentationOption(
      rawValue: kCGImageDestinationLossyCompressionQuality as String)
    guard let jpeg = context.jpegRepresentation(of: image, colorSpace: space, options: [qualityKey: quality]),
      let width = UInt16(exactly: size.width), let height = UInt16(exactly: size.height)
    else { return }
    onFrame(jpeg, width, height, UInt64(micros))
  }
}
