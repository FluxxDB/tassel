/// Thins a frame stream to a target rate by presentation time, and drops frames while the
/// client is behind.
///
/// Time is cut into turns of 1/fps from the first frame. A frame is emitted when it is the first
/// one sent in its turn, and only while fewer than `maxInFlight` frames are still being sent. A
/// frame dropped for that reason leaves its turn to the next frame, so a busy moment costs a
/// frame, not a turn. The turns start a quarter of a turn ahead of the first frame, which keeps
/// frames at the usual 30 fps away from turn edges, where jitter would make the pace uneven:
/// 30 fps thinned to 15 keeps exactly every other frame.
public struct Pacer: Sendable {
  /// Elapsed time beyond this (about 12.7 days) starts a new run of turns, so the turn
  /// arithmetic can't overflow.
  private static let maxElapsedMicros: UInt64 = 1 << 40
  private static let microsPerSecond: UInt64 = 1_000_000

  private let fps: UInt64
  private let maxInFlight: Int
  private var origin: UInt64?
  private var lastTurn: UInt64?

  /// `fps` is at least 1 (and at most one frame per microsecond); `maxInFlight` is at least 1.
  public init(fps: Int, maxInFlight: Int = 2) {
    self.fps = UInt64(min(max(fps, 1), Int(Self.microsPerSecond)))
    self.maxInFlight = max(maxInFlight, 1)
  }

  public mutating func shouldEmit(ptsMicros: UInt64, inFlight: Int) -> Bool {
    guard inFlight < maxInFlight else { return false }
    let start: UInt64
    if let origin, ptsMicros >= origin, ptsMicros - origin <= Self.maxElapsedMicros {
      start = origin
    } else {
      // The first frame, a clock that went back (a clip starting over) or a huge jump.
      start = ptsMicros
      origin = ptsMicros
      lastTurn = nil
    }
    // turn = floor(elapsed × fps + 1/4), elapsed in seconds, worked in integers.
    let turn = ((ptsMicros - start) * fps + Self.microsPerSecond / 4) / Self.microsPerSecond
    if let lastTurn, turn <= lastTurn { return false }
    lastTurn = turn
    return true
  }
}
