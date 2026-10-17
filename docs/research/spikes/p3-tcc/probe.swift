// The P3 TCC probe (Task 1 spike; not product code). One file, no dependencies.
//
// Build (run.mjs does this):
//   swiftc probe.swift -o .out/probe -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
//   codesign --force --sign - .out/probe      (binds the embedded Info.plist to the ad-hoc signature)
//
// Flags (one per run):
//   --status                  {"check":"status","camera":<raw>}. Never asks for access.
//   --capture <n>             Asks for access only if not determined, opens the first Desk View camera,
//                             counts n frames and prints {"check":"capture","camera":…,"device":…,
//                             "frames":n,"width":…,"height":…,"fps":…}. It writes no image anywhere.
//   --present-setup           AVCaptureDeskViewApplication().present(), then {"check":"present-setup",…}.
//   --write-mjpeg <path> <n>  A synthetic MJPEG: n solid 960×720 frames with a moving bar, through Core
//                             Image. It is not a camera frame, and `pnpm check` refuses to commit it.
//
// "camera" is the raw AVAuthorizationStatus: 0 notDetermined, 1 restricted, 2 denied, 3 authorized.
// TCC answers for the responsible process: the agent's app when an agent's shell started us, and
// Electron when LaunchServices started the Electron that spawned us.
import AVFoundation
import CoreImage
import Foundation
import ImageIO

enum Value {
    case int(Int), double(Double), string(String), bool(Bool), null
}

func quoted(_ text: String) -> String {
    var out = "\""
    for scalar in text.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out + "\""
}

/// Prints one JSON line, keeping the field order given.
func emit(_ fields: KeyValuePairs<String, Value>) {
    let body = fields.map { key, value -> String in
        let text: String
        switch value {
        case .int(let number): text = String(number)
        case .double(let number): text = number.isFinite ? String(number) : "null"
        case .string(let string): text = quoted(string)
        case .bool(let flag): text = flag ? "true" : "false"
        case .null: text = "null"
        }
        return "\(quoted(key)):\(text)"
    }
    print("{\(body.joined(separator: ","))}")
    fflush(stdout)
}

func cameraStatus() -> Int {
    AVCaptureDevice.authorizationStatus(for: .video).rawValue
}

func status() {
    emit(["check": .string("status"), "camera": .int(cameraStatus())])
}

/// Counts frames on the capture queue and keeps nothing but their size and timing.
final class FrameCounter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let target: Int
    let done = DispatchSemaphore(value: 0)
    var frames = 0
    var width = 0
    var height = 0
    var firstPts: CMTime?
    var lastPts: CMTime?

    init(target: Int) { self.target = target }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard frames < target else { return }
        frames += 1
        if let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) {
            width = CVPixelBufferGetWidth(pixels)
            height = CVPixelBufferGetHeight(pixels)
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstPts == nil { firstPts = pts }
        lastPts = pts
        if frames == target { done.signal() }
    }

    var fps: Double {
        guard frames > 1, let first = firstPts, let last = lastPts else { return 0 }
        let seconds = CMTimeGetSeconds(CMTimeSubtract(last, first))
        return seconds > 0 ? (Double(frames - 1) / seconds * 10).rounded() / 10 : 0
    }
}

func capture(_ target: Int) {
    if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
        // A prompt may appear here, for the responsible process. The owner answers it; an agent never does.
        let answered = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .video) { _ in answered.signal() }
        if answered.wait(timeout: .now() + 120) == .timedOut {
            emit(["check": .string("capture"), "camera": .int(cameraStatus()), "error": .string("no-answer")])
            return
        }
    }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "error": .string("not-authorized")])
        return
    }
    let discovery = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.deskViewCamera], mediaType: .video, position: .unspecified)
    guard let device = discovery.devices.first else {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "error": .string("no-device")])
        return
    }
    let session = AVCaptureSession()
    do {
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else { throw NSError(domain: "probe", code: 1) }
        session.addInput(input)
    } catch {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "device": .string(device.localizedName),
              "error": .string("open-failed: \(error.localizedDescription)")])
        return
    }
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    let counter = FrameCounter(target: target)
    let queue = DispatchQueue(label: "dev.tassel.p3-probe.capture")
    output.setSampleBufferDelegate(counter, queue: queue)
    guard session.canAddOutput(output) else {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "device": .string(device.localizedName),
              "error": .string("no-output")])
        return
    }
    session.addOutput(output)
    session.startRunning()
    let timedOut = counter.done.wait(timeout: .now() + 20) == .timedOut
    session.stopRunning()
    // Read the counter on its own queue, after the last delivery.
    let (frames, width, height, fps) = queue.sync { (counter.frames, counter.width, counter.height, counter.fps) }
    if timedOut {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "device": .string(device.localizedName),
              "frames": .int(frames), "width": .int(width), "height": .int(height), "fps": .double(fps),
              "error": .string("timeout")])
    } else {
        emit(["check": .string("capture"), "camera": .int(cameraStatus()), "device": .string(device.localizedName),
              "frames": .int(frames), "width": .int(width), "height": .int(height), "fps": .double(fps)])
    }
}

func presentSetup() {
    let finished = DispatchSemaphore(value: 0)
    var failure: Error?
    // On the main queue, which dispatchMain() serves, in case the API expects the main thread.
    DispatchQueue.main.async {
        AVCaptureDeskViewApplication().present { error in
            failure = error
            finished.signal()
        }
    }
    if finished.wait(timeout: .now() + 30) == .timedOut {
        emit(["check": .string("present-setup"), "result": .string("failed"), "message": .string("no answer in 30 s")])
    } else if let failure {
        emit(["check": .string("present-setup"), "result": .string("failed"),
              "message": .string(failure.localizedDescription)])
    } else {
        emit(["check": .string("present-setup"), "result": .string("presented")])
    }
}

func writeMjpeg(path: String, count: Int) {
    let width = 960, height = 720, bar = 80
    let context = CIContext()
    let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
    let quality = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
    let page = CIImage(color: CIColor(red: 0.93, green: 0.92, blue: 0.89))
        .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
    var data = Data()
    for index in 0..<count {
        let x = (index * 24) % (width - bar)
        let ink = CIImage(color: CIColor(red: 0.16, green: 0.16, blue: 0.22))
            .cropped(to: CGRect(x: x, y: 0, width: bar, height: height))
        guard let jpeg = context.jpegRepresentation(of: ink.composited(over: page), colorSpace: sRGB,
                                                    options: [quality: 0.8]) else {
            emit(["check": .string("write-mjpeg"), "error": .string("jpeg encode failed at frame \(index)")])
            exit(1)
        }
        data.append(jpeg)
    }
    do {
        try data.write(to: URL(fileURLWithPath: path))
    } catch {
        emit(["check": .string("write-mjpeg"), "error": .string(error.localizedDescription)])
        exit(1)
    }
    emit(["check": .string("write-mjpeg"), "path": .string(path), "frames": .int(count), "width": .int(width),
          "height": .int(height), "bytes": .int(data.count)])
}

func usage() -> Never {
    FileHandle.standardError.write(
        "usage: probe --status | --capture <n> | --present-setup | --write-mjpeg <path> <frames>\n".data(using: .utf8)!)
    exit(64)
}

let args = Array(CommandLine.arguments.dropFirst())
let work: () -> Void
switch args.first {
case "--status":
    work = status
case "--capture":
    guard args.count == 2, let target = Int(args[1]), target > 0 else { usage() }
    work = { capture(target) }
case "--present-setup":
    work = presentSetup
case "--write-mjpeg":
    guard args.count == 3, let count = Int(args[2]), count > 0 else { usage() }
    work = { writeMjpeg(path: args[1], count: count) }
default:
    usage()
}

// The work runs off the main thread, so it may block on semaphores while the main queue stays free
// for callbacks that land there.
DispatchQueue.global(qos: .userInitiated).async {
    work()
    exit(0)
}
dispatchMain()
