import DeskViewCore
import Foundation
import Network

/// The helper's WebSocket server, on 127.0.0.1 only, for one client at a time.
///
/// `requiredLocalEndpoint` binds loopback alone (`requiredInterfaceType = .loopback` would bind
/// `*`). The WebSocket options go first in the application protocols (Quinn, forum 693799), and
/// their client request handler refuses an upgrade whose `Origin` isn't the app's. Every client
/// must then pass `AuthGate`.
final class Server: @unchecked Sendable {
  /// A second client hears `error busy`, then this close code.
  static let busyCloseCode: UInt16 = 4409

  private let queue: DispatchQueue
  private let token: String
  private let producer: any FrameProducer
  private let setup: any SetupPresenter
  private let helperVersion: String
  // Touched only on `queue`.
  private var listener: NWListener?
  private var client: Connection?

  init(
    token: String, producer: any FrameProducer, setup: any SetupPresenter, helperVersion: String,
    queue: DispatchQueue
  ) {
    self.token = token
    self.producer = producer
    self.setup = setup
    self.helperVersion = helperVersion
    self.queue = queue
  }

  /// Starts listening at a free port; `ready` gets the port once the listener has it.
  func start(
    ready: @escaping @Sendable (UInt16) -> Void, failed: @escaping @Sendable (String) -> Void
  ) throws {
    let webSocket = NWProtocolWebSocket.Options(.version13)
    webSocket.autoReplyPing = true
    webSocket.maximumMessageSize = 65_536
    webSocket.setClientRequestHandler(queue) { _, headers in
      guard originAllowed(headers) else {
        log("refused an upgrade without the app's Origin")
        return NWProtocolWebSocket.Response(
          status: .reject, subprotocol: nil, additionalHeaders: [refusedMarker])
      }
      return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil)
    }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    parameters.defaultProtocolStack.applicationProtocols.insert(webSocket, at: 0)

    let listener = try NWListener(using: parameters)
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.stateUpdateHandler = { [weak listener] state in
      switch state {
      case .ready:
        if let port = listener?.port?.rawValue { ready(port) }
      case .failed(let error):
        failed("\(error)")
      default:
        break
      }
    }
    self.listener = listener
    listener.start(queue: queue)
  }

  /// Ends the client (stopping its stream) and stops listening. Call it on `queue`.
  func shutdown() {
    client?.end()
    listener?.cancel()
  }

  private func accept(_ connection: NWConnection) {
    guard client == nil else { return refuseBusy(connection) }
    let client = Connection(
      connection, token: token, producer: producer, setup: setup, helperVersion: helperVersion, queue: queue
    ) { [weak self] ended in
      if self?.client === ended { self?.client = nil }
    }
    self.client = client
    client.start()
  }

  /// Answers a second client with `error busy` and close 4409.
  private func refuseBusy(_ connection: NWConnection) {
    log("refused a second client: busy")
    connection.stateUpdateHandler = { state in
      switch state {
      case .ready where upgradeWasRefused(connection):
        connection.cancel()
      case .ready:
        let busy = encodeServerMessage(.error(.busy, "another client is connected"))
        connection.send(
          content: Data(busy.utf8), contentContext: webSocketContext(.text), isComplete: true,
          completion: .idempotent)
        connection.send(
          content: nil, contentContext: closeContext(Server.busyCloseCode), isComplete: true,
          completion: .contentProcessed { _ in connection.cancel() })
      case .failed, .cancelled:
        connection.stateUpdateHandler = nil
      default:
        break
      }
    }
    connection.start(queue: queue)
    // An upgrade that never completes doesn't linger.
    queue.asyncAfter(deadline: .now() + .seconds(2)) { connection.cancel() }
  }
}

/// Marks the response to a refused upgrade. Network.framework answers it with a bare 400 but
/// still reports the connection ready, and leaves the socket open: a client reading the 400's
/// body (it has no Content-Length) would wait on it. The marker isn't sent; it comes back in the
/// connection's own metadata, which is how the helper knows to hang up at once.
let refusedMarker = (name: "X-Tassel-Refused", value: "origin")

/// Whether this upgrade was refused. See `refusedMarker`.
func upgradeWasRefused(_ connection: NWConnection) -> Bool {
  let metadata =
    connection.metadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
  return metadata?.additionalServerHeaders?.contains { $0.0 == refusedMarker.name } ?? false
}

/// A context that sends one whole WebSocket message of this kind.
func webSocketContext(_ opcode: NWProtocolWebSocket.Opcode) -> NWConnection.ContentContext {
  NWConnection.ContentContext(
    identifier: "\(opcode)", metadata: [NWProtocolWebSocket.Metadata(opcode: opcode)])
}

/// A context that sends a close frame with one of the protocol's private codes (4401, 4409).
func closeContext(_ code: UInt16) -> NWConnection.ContentContext {
  let metadata = NWProtocolWebSocket.Metadata(opcode: .close)
  metadata.closeCode = .privateCode(code)
  return NWConnection.ContentContext(identifier: "close", metadata: [metadata])
}
