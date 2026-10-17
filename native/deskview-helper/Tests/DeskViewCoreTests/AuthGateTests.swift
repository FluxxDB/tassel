import DeskViewCore
import Testing

/// A per-launch token: 64 hex characters, as Electron makes them.
private let token = String(repeating: "0123456789abcdef", count: 4)

private func hello(_ token: String, protocolVersion: Int = 1) -> ClientMessage {
  .hello(token: token, protocolVersion: protocolVersion)
}

/// Feeds messages to the gate in order (`#expect` can't call a mutating method itself).
private func decisions(
  _ gate: inout AuthGate, _ messages: [(ClientMessage, at: ContinuousClock.Instant)]
) -> [AuthDecision] {
  messages.map { gate.receive($0.0, at: $0.at) }
}

private let rejected = AuthDecision.rejected(closeCode: 4401)

@Test func authAcceptsTheMatchingHello() {
  let opened = ContinuousClock.now
  var gate = AuthGate(token: token, openedAt: opened)
  // After the hello, every message passes on, a repeated hello included.
  let got = decisions(
    &gate,
    [
      (hello(token), at: opened + .milliseconds(1999)),
      (.list, at: opened + .seconds(3)),
      (.start(StartOptions()), at: opened + .seconds(4)),
      (hello(token), at: opened + .seconds(5)),
    ])
  #expect(got == [.accepted, .authorized, .authorized, .authorized])
  // The deadline no longer applies.
  #expect(!gate.isExpired(at: opened + .seconds(60)))
}

@Test func authRejectsAWrongToken() {
  let opened = ContinuousClock.now
  let wrong = [
    String(token.dropLast()) + "0",  // the last character differs
    String(token.dropLast()),  // a prefix
    token + "0",  // longer
    token.uppercased(),  // tokens compare byte for byte
    "",
  ]
  for offered in wrong {
    var gate = AuthGate(token: token, openedAt: opened)
    // Once rejected, the gate stays shut, even for the right token.
    let got = decisions(&gate, [(hello(offered), at: opened), (hello(token), at: opened)])
    #expect(got == [rejected, rejected], "\(offered)")
  }
}

@Test func authRejectsAnotherProtocolVersion() {
  let opened = ContinuousClock.now
  var gate = AuthGate(token: token, openedAt: opened)
  #expect(decisions(&gate, [(hello(token, protocolVersion: 2), at: opened)]) == [rejected])
}

@Test func authNeverAcceptsAnEmptyToken() {
  let opened = ContinuousClock.now
  var gate = AuthGate(token: "", openedAt: opened)
  #expect(decisions(&gate, [(hello(""), at: opened)]) == [rejected])
}

@Test func authRejectsAnythingBeforeHello() {
  let opened = ContinuousClock.now
  for first: ClientMessage in [.list, .start(StartOptions()), .stop, .openSetup] {
    var gate = AuthGate(token: token, openedAt: opened)
    let got = decisions(&gate, [(first, at: opened), (hello(token), at: opened)])
    #expect(got == [rejected, rejected], "\(first)")
  }
}

@Test func authExpiresAfterTwoSeconds() {
  let opened = ContinuousClock.now
  var gate = AuthGate(token: token, openedAt: opened)
  #expect(!gate.isExpired(at: opened))
  #expect(!gate.isExpired(at: opened + .milliseconds(1999)))
  #expect(gate.isExpired(at: opened + .seconds(2)))
  #expect(decisions(&gate, [(hello(token), at: opened + .milliseconds(2001))]) == [rejected])

  // The deadline is a parameter, two seconds by default.
  let patient = AuthGate(token: token, deadline: .seconds(5), openedAt: opened)
  #expect(!patient.isExpired(at: opened + .seconds(4)))
  #expect(patient.isExpired(at: opened + .seconds(5)))
}

@Test func originAllowlist() {
  #expect(allowedOrigins == ["app://tassel", "http://localhost:5173"])
  #expect(originAllowed([(name: "Origin", value: "app://tassel")]))
  #expect(originAllowed([(name: "Origin", value: "http://localhost:5173")]))
  #expect(originAllowed([(name: "origin", value: "app://tassel")]))
  #expect(originAllowed([(name: "ORIGIN", value: "http://localhost:5173")]))
  #expect(originAllowed([(name: "Host", value: "127.0.0.1:5000"), (name: "Origin", value: "app://tassel")]))

  #expect(!originAllowed([(name: "Origin", value: "https://example.com")]))
  #expect(!originAllowed([]))
  #expect(!originAllowed([(name: "Host", value: "127.0.0.1:5000")]))
  #expect(!originAllowed([(name: "Origin", value: "null")]))
  #expect(!originAllowed([(name: "Origin", value: "app://tassel.example.com")]))
  #expect(!originAllowed([(name: "Origin", value: "http://localhost:5174")]))
  // A request carries at most one Origin (RFC 6454), so two are refused, even if both are allowed.
  #expect(
    !originAllowed([(name: "Origin", value: "app://tassel"), (name: "Origin", value: "https://example.com")]))
  #expect(!originAllowed([(name: "Origin", value: "app://tassel"), (name: "origin", value: "app://tassel")]))
}

@Test func aTokenIs64HexCharacters() {
  #expect(isWellFormedToken(token))
  #expect(isWellFormedToken(token.uppercased()))
  #expect(!isWellFormedToken(""))
  #expect(!isWellFormedToken(String(token.dropLast())))
  #expect(!isWellFormedToken(token + "0"))
  #expect(!isWellFormedToken(String(token.dropLast()) + "g"))
  #expect(!isWellFormedToken(String(token.dropLast()) + " "))
  // Non-ASCII digits are not hex, even where Unicode calls them digits.
  #expect(!isWellFormedToken(String(token.dropLast()) + "٣"))
}
