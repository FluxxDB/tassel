import AVFoundation
import CoreGraphics
import CoreImage

func log(_ s: String) { print(s); fflush(stdout) }

func ask(_ type: AVMediaType) -> Bool {
    let sem = DispatchSemaphore(value: 0); var ok = false
    AVCaptureDevice.requestAccess(for: type) { granted in ok = granted; sem.signal() }
    sem.wait(); return ok
}

final class Grabber: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var frames = 0; let out: URL; let done = DispatchSemaphore(value: 0)
    init(out: URL) { self.out = out }
    func captureOutput(_ o: AVCaptureOutput, didOutput sb: CMSampleBuffer, from c: AVCaptureConnection) {
        frames += 1
        guard frames == 30, let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        let img = CIImage(cvPixelBuffer: pb)
        if let data = CIContext().jpegRepresentation(of: img, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: [:]) {
            try? data.write(to: out)
            log("deskview: captured \(Int(img.extent.width))x\(Int(img.extent.height)) frame")
        }
        done.signal()
    }
}

let cam = ask(.video); log("camera: \(cam ? "granted" : "denied")")
let mic = ask(.audio); log("microphone: \(mic ? "granted" : "denied")")
if CGPreflightScreenCaptureAccess() { log("screen recording: granted") }
else { _ = CGRequestScreenCaptureAccess(); log("screen recording: requested (enable in System Settings; applies after Claude restarts)") }

guard cam else { exit(0) }
guard let dev = AVCaptureDevice.DiscoverySession(deviceTypes: [.deskViewCamera], mediaType: .video, position: .unspecified).devices.first else {
    log("deskview: no Desk View camera available"); exit(0)
}
log("deskview: opening \(dev.localizedName)")
let session = AVCaptureSession()
do { session.addInput(try AVCaptureDeviceInput(device: dev)) } catch { log("deskview: open failed: \(error)"); exit(1) }
let output = AVCaptureVideoDataOutput()
let grabber = Grabber(out: URL(fileURLWithPath: CommandLine.arguments[1]))
output.setSampleBufferDelegate(grabber, queue: DispatchQueue(label: "capture"))
session.addOutput(output)
session.startRunning()
if grabber.done.wait(timeout: .now() + 30) == .timedOut { log("deskview: no frames within 30 s") }
session.stopRunning()
