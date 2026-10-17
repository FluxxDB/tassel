import CoreImage
import DeskViewCore
import Foundation
import Testing

// These tests spawn the built helper in clip mode (TASSEL_HELPER_CLIP), so they never touch a
// camera, and talk to it over URLSessionWebSocketTask with an `Origin` header, as the app does.

/// The helper `swift test` builds first, since this target depends on it.
private let helperBinary = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()  // DeskViewHelperTests
  .deletingLastPathComponent()  // Tests
  .deletingLastPathComponent()  // the package
  .appendingPathComponent(".build/debug/deskview-helper")

@Suite(.serialized, .timeLimit(.minutes(1)))
struct HelperProcessTests {
  @Test func printsReadyThenStreamsFrames() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let client = Client(port: try await helper.readyPort())
    defer { client.cancel() }

    try await client.send(hello(token))
    let welcome = try await client.receiveJSON()
    #expect(welcome["type"] as? String == "welcome")
    #expect(welcome["protocol"] as? Int == 1)
    #expect(welcome["camera"] as? String == "authorized")
    // The version comes from the Info.plist embedded in the binary.
    #expect(welcome["helperVersion"] as? String == "0.1.0")

    try await client.send(#"{"type":"list"}"#)
    let devices = try await client.receiveJSON()
    #expect(devices["type"] as? String == "devices")
    let listed = devices["devices"] as? [[String: Any]]
    #expect(listed?.count == 1)
    #expect(listed?.first?["id"] as? String == "clip")
    #expect(listed?.first?["name"] as? String == "Test clip")
    #expect(listed?.first?["builtIn"] as? Bool == true)

    try await client.send(#"{"type":"start","fps":10}"#)
    let running = try await client.receiveStatus("running")
    #expect(running["width"] as? Int == 64)
    #expect(running["height"] as? Int == 48)
    #expect(running["fps"] as? Int == 10)

    var seqs: [UInt32] = []
    for _ in 0..<5 {
      let frame = try await client.receiveBinary()
      let header = try FrameHeader.decode(frame)
      #expect(header.width == 64)
      #expect(header.height == 48)
      #expect(clip.jpegs.contains(Data(frame.dropFirst(FrameHeader.size))))
      seqs.append(header.seq)
    }
    #expect(zip(seqs, seqs.dropFirst()).allSatisfy { $1 == $0 + 1 }, "\(seqs)")

    try await client.send(#"{"type":"stop"}"#)
    _ = try await client.receiveStatus("stopped")
  }

  @Test func startAfterStopStreamsAgain() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let client = Client(port: try await helper.readyPort())
    defer { client.cancel() }
    try await client.send(hello(token))
    _ = try await client.receiveJSON()

    for _ in 0..<2 {
      try await client.send(#"{"type":"start","fps":15}"#)
      _ = try await client.receiveStatus("running")
      // Each stream counts its frames from 0.
      #expect(try FrameHeader.decode(try await client.receiveBinary()).seq == 0)
      try await client.send(#"{"type":"stop"}"#)
      _ = try await client.receiveStatus("stopped")
    }
  }

  @Test func clipPlaysAtItsOwnRate() async throws {
    let clip = try Clip(frames: 30)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let client = Client(port: try await helper.readyPort())
    defer { client.cancel() }
    try await client.send(hello(token))
    _ = try await client.receiveJSON()
    try await client.send(#"{"type":"start","fps":30}"#)
    _ = try await client.receiveStatus("running")

    // Frame 0 plays first, and again once the clip has played through: after 1 s at 30 fps.
    var firstAt: ContinuousClock.Instant?
    var loopedAfter: Duration?
    var frames = 0
    while loopedAfter == nil {
      let jpeg = Data(try await client.receiveBinary().dropFirst(FrameHeader.size))
      frames += 1
      guard jpeg == clip.jpegs[0] else { continue }
      if let firstAt { loopedAfter = .now - firstAt } else { firstAt = .now }
    }
    let after = try #require(loopedAfter)
    #expect(after > .milliseconds(800) && after < .milliseconds(1400), "\(after)")
    #expect((28...31).contains(frames), "\(frames) frames")
  }

  @Test func wrongTokenClosesWith4401() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let helper = try Helper(token: freshToken(), clip: clip.url)
    defer { helper.stop() }
    let client = Client(port: try await helper.readyPort())
    defer { client.cancel() }

    try await client.send(hello(freshToken()))
    let ending = try await client.ending()
    #expect(ending.closeCode == 4401)
    #expect(ending.received.isEmpty)
  }

  @Test func foreignOriginIsRefusedAtUpgrade() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let port = try await helper.readyPort()

    for origin in ["https://example.com", "null", nil] {
      let client = Client(port: port, origin: origin)
      defer { client.cancel() }
      let error = await #expect(throws: (any Error).self) { try await client.receive() }
      #expect(!(error is TimedOut), "\(origin ?? "no Origin")")
      #expect(!client.opened, "\(origin ?? "no Origin")")
    }

    // The helper is still there for the app.
    let allowed = Client(port: port)
    defer { allowed.cancel() }
    try await allowed.send(hello(token))
    #expect(try await allowed.receiveJSON()["type"] as? String == "welcome")
  }

  @Test func oversizedMessageClosesTheConnection() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let port = try await helper.readyPort()
    let client = Client(port: port)
    defer { client.cancel() }
    try await client.send(hello(token))
    _ = try await client.receiveJSON()

    // 70 KiB, over the 64 KiB cap. The send itself may fail as the helper drops the socket.
    try? await client.send(String(repeating: "x", count: 70 * 1024))
    _ = try await client.ending()

    // The next client gets in.
    let next = try await connectWhenFree(port: port, token: token)
    next.cancel()
  }

  @Test func silentClientClosesAfterTwoSeconds() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let helper = try Helper(token: freshToken(), clip: clip.url)
    defer { helper.stop() }
    let port = try await helper.readyPort()

    let connected = ContinuousClock.now
    let client = Client(port: port)
    defer { client.cancel() }
    let ending = try await client.ending()
    let after = ContinuousClock.now - connected
    #expect(ending.closeCode == 4401)
    #expect(ending.received.isEmpty)
    #expect(after > .milliseconds(1800) && after < .milliseconds(3500), "\(after)")
  }

  @Test func secondClientGetsBusy() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let port = try await helper.readyPort()
    let first = Client(port: port)
    defer { first.cancel() }
    try await first.send(hello(token))
    _ = try await first.receiveJSON()

    let second = Client(port: port)
    defer { second.cancel() }
    let busy = try await second.receiveJSON()
    #expect(busy["type"] as? String == "error")
    #expect(busy["code"] as? String == "busy")
    #expect(try await second.ending().closeCode == 4409)

    // The first client carries on, and once it leaves, the next one gets in.
    try await first.send(#"{"type":"list"}"#)
    #expect(try await first.receiveJSON()["type"] as? String == "devices")
    first.cancel()
    let third = try await connectWhenFree(port: port, token: token)
    third.cancel()
  }

  @Test func exitsWithinOneSecondOfStdinEOF() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let token = freshToken()
    let helper = try Helper(token: token, clip: clip.url)
    defer { helper.stop() }
    let client = Client(port: try await helper.readyPort())
    defer { client.cancel() }
    // Mid-stream, as when Electron dies during a session.
    try await client.send(hello(token))
    _ = try await client.receiveJSON()
    try await client.send(#"{"type":"start","fps":15}"#)
    _ = try await client.receiveStatus("running")
    _ = try await client.receiveBinary()

    let closed = ContinuousClock.now
    try helper.closeStdin()
    #expect(try await helper.exitStatus(within: .milliseconds(1500)) == 0)
    #expect(ContinuousClock.now - closed < .milliseconds(1500))
  }

  @Test func sigtermExitsZero() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    let helper = try Helper(token: freshToken(), clip: clip.url)
    defer { helper.stop() }
    _ = try await helper.readyPort()
    helper.process.terminate()
    #expect(try await helper.exitStatus(within: .seconds(1)) == 0)
  }

  @Test func missingTokenExits64() async throws {
    let clip = try Clip(frames: 3)
    defer { clip.remove() }
    for token in [nil, "", "abc123", String(repeating: "g", count: 64)] {
      let helper = try Helper(token: token, clip: clip.url)
      defer { helper.stop() }
      #expect(try await helper.exitStatus(within: .seconds(5)) == 64, "\(token ?? "no token")")
      // It never got as far as listening.
      #expect(helper.remainingOutput().isEmpty)
    }
  }
}

// MARK: - Support

private struct TimedOut: Error {}

private struct Unexpected: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

/// A fresh per-launch token, as Electron makes them: 32 random bytes in hex.
private func freshToken() -> String {
  (0..<32).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
}

private func hello(_ token: String) -> String {
  #"{"type":"hello","token":"\#(token)","protocol":1}"#
}

/// Connects and says hello, retrying while the helper still answers busy (it frees its one slot
/// when it sees the last client's close, which can lag a new connection).
private func connectWhenFree(port: Int, token: String) async throws -> Client {
  for _ in 0..<20 {
    let client = Client(port: port)
    try await client.send(hello(token))
    let reply = try await client.receiveJSON()
    if reply["type"] as? String == "welcome" { return client }
    client.cancel()
    try await Task.sleep(for: .milliseconds(100))
  }
  throw Unexpected("the helper stayed busy")
}

/// Settles with whichever comes first, the callback's result or the timeout, and ignores the
/// other. Unlike a task group, it never waits on work that ignores cancellation.
private func settle<T: Sendable>(
  within timeout: Duration, _ start: (@escaping @Sendable (Result<T, any Error>) -> Void) -> Void
) async throws -> T {
  try await withCheckedThrowingContinuation { continuation in
    let once = Once(continuation)
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout.seconds) {
      once.resume(with: .failure(TimedOut()))
    }
    start { once.resume(with: $0) }
  }
}

private final class Once<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, any Error>?

  init(_ continuation: CheckedContinuation<T, any Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<T, any Error>) {
    let continuation = lock.withLock {
      defer { self.continuation = nil }
      return self.continuation
    }
    continuation?.resume(with: result)
  }
}

extension Duration {
  fileprivate var seconds: Double {
    Double(components.seconds) + Double(components.attoseconds) / 1e18
  }
}

/// A synthetic MJPEG in the temporary directory: solid grey frames, each a different level.
private struct Clip {
  let url: URL
  let jpegs: [Data]

  init(frames: Int, width: Int = 64, height: Int = 48) throws {
    let context = CIContext()
    let space = try #require(CGColorSpace(name: CGColorSpace.sRGB))
    jpegs = try (0..<frames).map { index in
      let level = Double(index) / Double(frames)
      let image = CIImage(color: CIColor(red: level, green: level, blue: level))
        .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
      return try #require(context.jpegRepresentation(of: image, colorSpace: space, options: [:]))
    }
    #expect(Set(jpegs).count == frames, "every frame must differ")
    url = FileManager.default.temporaryDirectory
      .appendingPathComponent("deskview-helper-test-\(UUID().uuidString).mjpeg")
    try jpegs.reduce(Data(), +).write(to: url)
  }

  func remove() {
    try? FileManager.default.removeItem(at: url)
  }
}

/// The helper as a child process, with a pipe for stdin (closing it is Electron dying) and one
/// for stdout (the ready line). Its stderr log goes to the test's.
private final class Helper: @unchecked Sendable {
  let process = Process()
  private let input = Pipe()
  private let output = Pipe()

  init(token: String?, clip: URL?) throws {
    process.executableURL = helperBinary
    process.arguments = ["--tag", "deskview-helper-tests"]
    var environment = [
      "PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "TMPDIR": NSTemporaryDirectory(),
    ]
    environment["TASSEL_HELPER_TOKEN"] = token
    environment["TASSEL_HELPER_CLIP"] = clip?.path
    process.environment = environment
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.standardError
    try process.run()
  }

  /// The port from the first stdout line, which must be the ready line.
  func readyPort() async throws -> Int {
    let line = try await firstLine()
    let ready = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
    guard ready?["event"] as? String == "ready", ready?["protocol"] as? Int == 1,
      let port = ready?["port"] as? Int, port > 0
    else { throw Unexpected("not a ready line: \(line)") }
    return port
  }

  private func firstLine() async throws -> String {
    let handle = output.fileHandleForReading
    return try await settle(within: .seconds(10)) { done in
      DispatchQueue.global().async {
        var data = Data()
        while true {
          let chunk = handle.availableData
          if chunk.isEmpty {
            return done(.failure(Unexpected("stdout ended before a line")))
          }
          data.append(chunk)
          if let newline = data.firstIndex(of: 0x0A) {
            return done(.success(String(decoding: data[..<newline], as: UTF8.self)))
          }
        }
      }
    }
  }

  /// Whatever stdout still holds, once the process has ended.
  func remainingOutput() -> Data {
    output.fileHandleForReading.readDataToEndOfFile()
  }

  func closeStdin() throws {
    try input.fileHandleForWriting.close()
  }

  func exitStatus(within timeout: Duration) async throws -> Int32 {
    let deadline = ContinuousClock.now + timeout
    while process.isRunning {
      guard ContinuousClock.now < deadline else { throw TimedOut() }
      try await Task.sleep(for: .milliseconds(10))
    }
    return process.terminationStatus
  }

  func stop() {
    guard process.isRunning else { return }
    kill(process.processIdentifier, SIGKILL)
    process.waitUntilExit()
  }
}

private enum Received: Sendable {
  case text(String)
  case binary(Data)
}

/// A WebSocket client on URLSessionWebSocketTask, as the app's renderer would be.
private final class Client: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var didOpen = false
  private var session: URLSession!
  private var task: URLSessionWebSocketTask!

  init(port: Int, origin: String? = "app://tassel") {
    super.init()
    var request = URLRequest(url: URL(string: "ws://127.0.0.1:\(port)")!)
    if let origin { request.setValue(origin, forHTTPHeaderField: "Origin") }
    session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
    task = session.webSocketTask(with: request)
    task.resume()
  }

  /// Whether the upgrade ever succeeded.
  var opened: Bool { lock.withLock { didOpen } }

  func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
  ) {
    lock.withLock { didOpen = true }
  }

  func send(_ text: String) async throws {
    let task = self.task!
    try await settle(within: .seconds(5)) { done in
      task.send(.string(text)) { error in done(error.map { .failure($0) } ?? .success(())) }
    }
  }

  func receive(within timeout: Duration = .seconds(5)) async throws -> Received {
    let task = self.task!
    return try await settle(within: timeout) { done in
      task.receive { result in
        done(
          result.flatMap { message in
            switch message {
            case .string(let text): .success(.text(text))
            case .data(let data): .success(.binary(data))
            @unknown default: .failure(Unexpected("an unknown message kind"))
            }
          })
      }
    }
  }

  /// The next text message, parsed; frames in between are skipped.
  func receiveJSON() async throws -> [String: Any] {
    while true {
      guard case .text(let text) = try await receive() else { continue }
      guard let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
      else { throw Unexpected("not a JSON object: \(text)") }
      return object
    }
  }

  /// The next `status` message, which must have this state.
  func receiveStatus(_ state: String) async throws -> [String: Any] {
    var status = try await receiveJSON()
    if state == "running", status["state"] as? String == "starting" {
      status = try await receiveJSON()
    }
    guard status["type"] as? String == "status", status["state"] as? String == state else {
      throw Unexpected("expected status \(state), got \(status)")
    }
    return status
  }

  func receiveBinary() async throws -> Data {
    switch try await receive() {
    case .binary(let data): return data
    case .text(let text): throw Unexpected("expected a frame, got \(text)")
    }
  }

  /// Reads until the connection ends, then gives the close code the server sent (URLSession
  /// reports 0 when none came) and what arrived before it.
  func ending(within timeout: Duration = .seconds(5)) async throws -> (closeCode: Int, received: [Received]) {
    let deadline = ContinuousClock.now + timeout
    var received: [Received] = []
    while true {
      do {
        received.append(try await receive(within: deadline - .now))
      } catch is TimedOut {
        throw TimedOut()
      } catch {
        return (task.closeCode.rawValue, received)
      }
    }
  }

  func cancel() {
    task.cancel(with: .normalClosure, reason: nil)
    session.invalidateAndCancel()
  }
}
