import Foundation

/// The origins the WebSocket upgrade accepts: the packaged renderer and the dev renderer. This is
/// defense in depth; the per-launch token is the real guard.
public let allowedOrigins: Set<String> = ["app://tassel", "http://localhost:5173"]

/// Whether an upgrade request's headers carry exactly one allowed `Origin`. The header name is
/// matched in any case; a missing Origin is refused, and so are two (RFC 6454 allows one).
public func originAllowed(_ headers: [(name: String, value: String)]) -> Bool {
  let origins = headers.filter { $0.name.lowercased() == "origin" }
  guard origins.count == 1, let origin = origins.first else { return false }
  return allowedOrigins.contains(origin.value.trimmingCharacters(in: CharacterSet(charactersIn: " \t")))
}

/// Whether a per-launch token has the form Electron gives it: 64 hex characters (32 random
/// bytes). The helper exits 64 at launch otherwise.
public func isWellFormedToken(_ token: String) -> Bool {
  token.utf8.count == 64
    && token.utf8.allSatisfy { (0x30...0x39).contains($0) || (0x41...0x46).contains($0) || (0x61...0x66).contains($0) }
}

public enum AuthDecision: Equatable, Sendable {
  /// The first message was the right `hello`: answer with `welcome`.
  case accepted
  /// Close the connection with this code (4401).
  case rejected(closeCode: UInt16)
  /// A hello was already accepted: pass the message on.
  case authorized
}

/// The handshake for one connection: its first message must be `hello` with the per-launch token
/// and protocol 1, within the deadline (2 s) of the connection opening. Anything else shuts the
/// gate for good.
public struct AuthGate: Sendable {
  /// The close code for a client that fails the handshake.
  public static let rejectedCloseCode: UInt16 = 4401

  private enum State: Sendable {
    case waiting, accepted, rejected
  }

  private let token: [UInt8]
  private let expiry: ContinuousClock.Instant
  private var state = State.waiting

  /// `openedAt` is when the connection opened, so the deadline runs from then.
  public init(
    token: String, deadline: Duration = .seconds(2), openedAt: ContinuousClock.Instant = .now
  ) {
    self.token = Array(token.utf8)
    self.expiry = openedAt + deadline
  }

  public mutating func receive(_ m: ClientMessage, at: ContinuousClock.Instant) -> AuthDecision {
    switch state {
    case .accepted:
      return .authorized
    case .rejected:
      return .rejected(closeCode: Self.rejectedCloseCode)
    case .waiting:
      if case .hello(let offered, let version) = m, version == protocolVersion, at < expiry,
        !token.isEmpty, constantTimeEqual(Array(offered.utf8), token)
      {
        state = .accepted
        return .accepted
      }
      state = .rejected
      return .rejected(closeCode: Self.rejectedCloseCode)
    }
  }

  /// True once the deadline has passed without an accepted hello.
  public func isExpired(at: ContinuousClock.Instant) -> Bool {
    state != .accepted && at >= expiry
  }
}

/// Compares every byte whatever the first difference, so the time taken says nothing about how
/// much of a guess was right. A length difference counts as a difference, not an early return.
private func constantTimeEqual(_ lhs: [UInt8], _ rhs: [UInt8]) -> Bool {
  var difference: UInt8 = lhs.count == rhs.count ? 0 : 1
  for index in 0..<max(lhs.count, rhs.count) {
    let left = index < lhs.count ? lhs[index] : 0
    let right = index < rhs.count ? rhs[index] : 0
    difference |= left ^ right
  }
  return difference == 0
}
