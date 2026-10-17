import DeskViewCore
import Foundation

// Tassel's Desk View helper. Electron spawns it with a per-launch token in TASSEL_HELPER_TOKEN
// (never on argv) and, in tests, TASSEL_HELPER_CLIP: an MJPEG to stream instead of the camera.
// `--tag <value>` is only a label for `pgrep -f`. It prints one line on stdout,
// {"event":"ready","port":<port>,"protocol":1}, logs to stderr, exits 64 when the token is
// missing or malformed, and exits 0 within 1 s of stdin EOF (Electron died) or SIGTERM.

/// Ends the helper once, however many reasons arrive: it releases the camera first, and exits
/// regardless after 800 ms, so a camera that won't stop can't keep it alive.
final class Shutdown: @unchecked Sendable {
  private let lock = NSLock()
  private var started = false
  private let server: Server
  private let queue: DispatchQueue

  init(server: Server, queue: DispatchQueue) {
    self.server = server
    self.queue = queue
  }

  func begin(_ reason: String) {
    let first = lock.withLock {
      defer { started = true }
      return !started
    }
    guard first else { return }
    // _exit: the normal path may be inside exit() by then, and exit() mustn't run twice.
    DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(800)) { _exit(0) }
    queue.async { [server] in
      log("exiting: \(reason)")
      server.shutdown()
      exit(0)
    }
  }
}

func runHelper() -> Never {
  let environment = ProcessInfo.processInfo.environment
  guard let token = environment["TASSEL_HELPER_TOKEN"], isWellFormedToken(token) else {
    log("TASSEL_HELPER_TOKEN is missing or malformed")
    exit(64)
  }
  let arguments = CommandLine.arguments
  if let at = arguments.firstIndex(of: "--tag"), arguments.indices.contains(at + 1) {
    log("tag \(arguments[at + 1])")
  }
  signal(SIGPIPE, SIG_IGN)

  let queue = DispatchQueue(label: "dev.tassel.deskview-helper")
  // With TASSEL_HELPER_CLIP set, even to nothing, no camera is touched: no CameraProducer and no
  // Desk View app. A path that can't be read fails at start.
  let clip = environment["TASSEL_HELPER_CLIP"]
  let producer: any FrameProducer = clip.map { ClipProducer(path: $0) } ?? CameraProducer()
  let setup: any SetupPresenter = clip == nil ? DeskViewSetup() : FakeSetup()
  let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
  let server = Server(
    token: token, producer: producer, setup: setup, helperVersion: version ?? "unknown", queue: queue)
  let shutdown = Shutdown(server: server, queue: queue)

  // Stdin EOF: Electron died, or closed the pipe to stop the helper.
  let stdin = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .global())
  stdin.setEventHandler {
    var buffer = [UInt8](repeating: 0, count: 4096)
    let count = read(STDIN_FILENO, &buffer, buffer.count)
    if count == 0 || (count < 0 && errno != EAGAIN && errno != EINTR) {
      stdin.cancel()
      shutdown.begin("stdin closed")
    }
  }
  stdin.resume()
  let signals = [SIGTERM, SIGINT].map { number in
    signal(number, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
    source.setEventHandler { shutdown.begin(number == SIGTERM ? "SIGTERM" : "SIGINT") }
    source.resume()
    return source
  }

  do {
    try server.start(
      ready: { port in
        log("listening on 127.0.0.1:\(port)\(clip == nil ? "" : " with a test clip")")
        FileHandle.standardOutput.write(Data((readyLine(port: port) + "\n").utf8))
      },
      failed: { message in
        log("listener failed: \(message)")
        exit(1)
      })
  } catch {
    log("can't listen: \(error)")
    exit(1)
  }
  withExtendedLifetime((stdin, signals)) { dispatchMain() }
}

runHelper()
