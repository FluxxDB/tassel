import DeskViewCore
import Testing

/// Camera clocks don't start at zero.
private let base: UInt64 = 7_000_000_000

/// The pacer's answer for each frame, given as (pts, frames in flight). `#expect` can't call a
/// mutating method itself, so the tests collect the answers first.
private func decisions(_ pacer: inout Pacer, _ frames: [(pts: UInt64, inFlight: Int)]) -> [Bool] {
  frames.map { pacer.shouldEmit(ptsMicros: $0.pts, inFlight: $0.inFlight) }
}

/// The indexes of the frames emitted, given each frame's pts, with nothing in flight.
private func emitted(_ pacer: inout Pacer, _ pts: [UInt64]) -> [Int] {
  let answers = decisions(&pacer, pts.map { (pts: $0, inFlight: 0) })
  return answers.indices.filter { answers[$0] }
}

/// `count` frames from `start`, `interval` µs apart.
private func frames(_ count: Int, every interval: UInt64, from start: UInt64 = base) -> [UInt64] {
  (0..<UInt64(count)).map { start + $0 * interval }
}

@Test func pacerEmitsFifteenOfThirty() {
  var pacer = Pacer(fps: 15)
  let picked = emitted(&pacer, frames(30, every: 33_333))
  #expect((14...16).contains(picked.count))
  // Evenly: every other frame, never two in a row and then a gap.
  #expect(picked == Array(stride(from: 0, to: 30, by: 2)))

  // A real camera's timestamps wobble by a millisecond or two; the pace holds.
  let jitter: [Int64] = [0, 2_000, -1_500, 1_000, -2_000, 1_500]
  let wobbly = frames(30, every: 33_333).enumerated().map { UInt64(Int64($1) + jitter[$0 % jitter.count]) }
  var steady = Pacer(fps: 15)
  #expect(emitted(&steady, wobbly) == Array(stride(from: 0, to: 30, by: 2)))
}

@Test func pacerKeepsEveryFrameAtTheSourceRate() {
  var pacer = Pacer(fps: 30)
  let atThirty = emitted(&pacer, frames(90, every: 33_333))
  #expect(atThirty.count == 90)
  var slower = Pacer(fps: 30)
  let atTwenty = emitted(&slower, frames(30, every: 50_000))
  #expect(atTwenty.count == 30)
}

@Test func pacerThinsThirtyToTenAndTwenty() {
  var ten = Pacer(fps: 10)
  let atTen = emitted(&ten, frames(90, every: 33_333))
  #expect(atTen.count == 30)
  var twenty = Pacer(fps: 20)
  let atTwenty = emitted(&twenty, frames(90, every: 33_333))
  #expect((59...61).contains(atTwenty.count))
}

@Test func pacerDropsWhileTwoAreInFlight() {
  var pacer = Pacer(fps: 30)
  let got = decisions(
    &pacer, [(base, 0), (base + 33_333, 2), (base + 66_666, 3), (base + 99_999, 1)])
  #expect(got == [true, false, false, true])

  var single = Pacer(fps: 30, maxInFlight: 1)
  #expect(decisions(&single, [(base, 0), (base + 33_333, 1)]) == [true, false])
}

@Test func aFrameDroppedWhileBusyLeavesItsTurnToTheNext() {
  var pacer = Pacer(fps: 15)
  // The second frame is dropped; the third is still inside its 1/15 s, so it goes in its place,
  // and only that one; the fifth starts the next turn.
  let got = decisions(
    &pacer,
    [(base, 0), (base + 66_666, 2), (base + 99_999, 0), (base + 116_666, 0), (base + 133_332, 0)])
  #expect(got == [true, false, true, false, true])
}

@Test func pacerNeverBurstsAfterAGap() {
  var pacer = Pacer(fps: 15)
  let first = emitted(&pacer, [base])
  #expect(first == [0])
  // Five seconds without frames, then 30 fps again: one frame, then the usual pace.
  let picked = emitted(&pacer, frames(10, every: 33_333, from: base + 5_000_000))
  #expect(picked == [0, 2, 4, 6, 8])
}

@Test func pacerStartsOverWhenTheClockGoesBack() {
  var pacer = Pacer(fps: 15)
  let got = decisions(&pacer, [(base + 1_000_000, 0), (base, 0), (base + 33_333, 0), (base + 66_666, 0)])
  #expect(got == [true, true, false, true])
}

@Test func pacerSurvivesExtremeTimestamps() {
  var pacer = Pacer(fps: 30)
  #expect(decisions(&pacer, [(0, 0), (.max, 0), (0, 0)]) == [true, true, true])
  var odd = Pacer(fps: 0, maxInFlight: 0)
  #expect(decisions(&odd, [(base, 0), (base + 500_000, 0), (base + 1_000_000, 0)]) == [true, false, true])
}
