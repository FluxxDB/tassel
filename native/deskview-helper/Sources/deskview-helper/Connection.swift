import DeskViewCore
import Foundation
import Network

/// One client: the handshake through `AuthGate`, then its messages, and the frames it asked
/// for, sent with `Pacer` backpressure. Everything here runs on the helper's queue.
final class Connection: @unchecked Sendable {
  private let connection: NWConnection
  private let queue: DispatchQueue
  private let producer: any FrameProducer
  private let setup: any SetupPresenter
  private let helperVersion: String
  private let onEnd: (Connection) -> Void
  /// The handshake deadline runs from when the client connected, so a client that never
  /// finishes the upgrade can't hold the helper's one slot either.
  private var gate: AuthGate
  private var authorized = false
  private var ready = false
  private var closing = false
  private var ended = false
  private var stream: Stream?
  /// Tells a stopped stream's late callbacks from the current one's.
  private var generation = 0

  init(
    _ connection: NWConnection, token: String, producer: any FrameProducer, setup: any SetupPresenter,
    helperVersion: String, queue: DispatchQueue, onEnd: @escaping (Connection) -> Void
  ) {
    self.connection = connection
    self.queue = queue
    self.producer = producer
    self.setup = setup
    self.helperVersion = helperVersion
    self.onEnd = onEnd
    gate = AuthGate(token: token)
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in self?.stateChanged(state) }
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + .seconds(2)) { [weak self] in self?.checkDeadline() }
  }

  /// Stops the stream and drops the client, once.
  func end() {
    guard !ended else { return }
    ended = true
    stopStream()
    connection.stateUpdateHandler = nil
    connection.cancel()
    onEnd(self)
  }

  private func stateChanged(_ state: NWConnection.State) {
    switch state {
    case .ready where upgradeWasRefused(connection):
      end()
    case .ready:
      ready = true
      receiveNext()
    case .failed(let error):
      log("client connection failed: \(error)")
      end()
    case .cancelled:
      end()
    default:
      break
    }
  }

  private func checkDeadline() {
    guard !authorized, !ended else { return }
    guard gate.isExpired(at: .now) else {
      queue.asyncAfter(deadline: .now() + .milliseconds(20)) { [weak self] in self?.checkDeadline() }
      return
    }
    log("closed a client that sent no hello within 2 s")
    close(AuthGate.rejectedCloseCode)
  }

  // MARK: Receiving

  private func receiveNext() {
    connection.receiveMessage { [weak self] content, context, _, error in
      self?.received(content, context, error)
    }
  }

  private func received(_ content: Data?, _ context: NWConnection.ContentContext?, _ error: NWError?) {
    guard !ended, !closing else { return }
    if let error {
      // The client went away, or broke the protocol (a message over 64 KiB, say).
      log("client gone: \(error)")
      return end()
    }
    guard
      let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
        as? NWProtocolWebSocket.Metadata
    else {
      // An empty message with no metadata: the client is gone.
      return end()
    }
    switch metadata.opcode {
    case .text:
      handleText(content.flatMap { String(data: $0, encoding: .utf8) })
    case .binary:
      handleBinary()
    case .close:
      return end()
    default:
      break  // pings are answered for us; pongs need nothing
    }
    if !ended, !closing { receiveNext() }
  }

  private func handleText(_ text: String?) {
    let message: ClientMessage
    do {
      message = try decodeClientMessage(text ?? "")
    } catch {
      guard authorized else {
        log("closed a client whose first message wasn't a hello")
        return close(AuthGate.rejectedCloseCode)
      }
      guard case .badMessage(let explanation) = error else { return }
      return send(.error(.badRequest, explanation))
    }
    switch gate.receive(message, at: .now) {
    case .accepted:
      authorized = true
      send(.welcome(helperVersion: helperVersion, camera: producer.cameraAccess))
    case .rejected(let code):
      log("closed a client that failed the handshake")
      close(code)
    case .authorized:
      handle(message)
    }
  }

  private func handleBinary() {
    guard authorized else {
      log("closed a client whose first message wasn't a hello")
      return close(AuthGate.rejectedCloseCode)
    }
    send(.error(.badRequest, "the helper takes no binary messages"))
  }

  private func handle(_ message: ClientMessage) {
    switch message {
    case .hello:
      send(.error(.badRequest, "already said hello"))
    case .list:
      send(.devices(producer.devices()))
    case .start(let options):
      startStream(options)
    case .stop:
      let last = stream
      stopStream()
      send(
        .status(
          state: "stopped", width: Int(last?.width ?? 0), height: Int(last?.height ?? 0),
          fps: last?.options.fps ?? 0))
    case .openSetup:
      setup.present { [weak self] result, message in
        guard let self else { return }
        self.queue.async { self.send(.setup(result: result, message: message)) }
      }
    }
  }

  // MARK: Streaming

  private func startStream(_ options: StartOptions) {
    stopStream()  // a second start replaces the first
    generation += 1
    let generation = self.generation
    do {
      try producer.start(
        options,
        onFrame: { [weak self] jpeg, width, height, pts in
          guard let self else { return }
          self.queue.async { self.frameArrived(generation, jpeg, width, height, pts) }
        },
        onError: { [weak self] code, message in
          guard let self else { return }
          self.queue.async { self.streamFailed(generation, code, message) }
        })
    } catch {
      log("couldn't start: \(error.message)")
      return send(.error(error.errorCode, error.message))
    }
    stream = Stream(generation: generation, options: options)
    log("stream started at \(options.fps) fps")
    send(.status(state: "starting", width: 0, height: 0, fps: options.fps))
  }

  private func stopStream() {
    guard stream != nil else { return }
    stream = nil
    producer.stop()
    log("stream stopped")
  }

  private func frameArrived(
    _ generation: Int, _ jpeg: Data, _ width: UInt16, _ height: UInt16, _ pts: UInt64
  ) {
    guard !ended, !closing, let stream, stream.generation == generation else { return }
    guard stream.pacer.shouldEmit(ptsMicros: pts, inFlight: stream.inFlight) else { return }
    if width != stream.width || height != stream.height {
      // The first frame, or a new size: say so before the frame.
      stream.width = width
      stream.height = height
      send(.status(state: "running", width: Int(width), height: Int(height), fps: stream.options.fps))
    }
    let header = FrameHeader(seq: stream.seq, ptsMicros: pts, width: width, height: height)
    stream.seq &+= 1
    stream.inFlight += 1
    connection.send(
      content: frameMessage(header, jpeg: jpeg), contentContext: webSocketContext(.binary), isComplete: true,
      completion: .contentProcessed { _ in stream.inFlight -= 1 })
  }

  private func streamFailed(_ generation: Int, _ code: ErrorCode, _ message: String) {
    guard !ended, let stream, stream.generation == generation else { return }
    log("stream lost: \(message)")
    stopStream()
    send(.error(code, message))
    send(
      .status(
        state: "stopped", width: Int(stream.width), height: Int(stream.height),
        fps: stream.options.fps))
  }

  // MARK: Sending

  private func send(_ message: ServerMessage) {
    guard ready, !ended, !closing else { return }
    connection.send(
      content: Data(encodeServerMessage(message).utf8), contentContext: webSocketContext(.text),
      isComplete: true,
      completion: .contentProcessed { error in
        if let error { log("send failed: \(error)") }
      })
  }

  /// Sends a close frame with this code, then drops the client.
  private func close(_ code: UInt16) {
    guard !ended, !closing else { return }
    guard ready else { return end() }  // no WebSocket yet, so nothing to send a code on
    closing = true
    connection.send(
      content: nil, contentContext: closeContext(code), isComplete: true,
      completion: .contentProcessed { [weak self] _ in self?.end() })
  }
}

/// A running stream's state. It lives on the helper's queue.
private final class Stream: @unchecked Sendable {
  let generation: Int
  let options: StartOptions
  var pacer: Pacer
  var seq: UInt32 = 0
  var inFlight = 0
  var width: UInt16 = 0
  var height: UInt16 = 0

  init(generation: Int, options: StartOptions) {
    self.generation = generation
    self.options = options
    pacer = Pacer(fps: options.fps)
  }
}
