import AVFoundation
import Foundation

/// Answers `openSetup`: presents Desk View's own app, where she turns Desk View on and frames
/// the desk, and reports `presented` or `failed`.
protocol SetupPresenter: Sendable {
  func present(_ done: @escaping @Sendable (_ result: String, _ message: String?) -> Void)
}

/// The Desk View app, through AVCaptureDeskViewApplication (macOS 13+). Task 1's check D passed:
/// called from a helper Electron spawned, it launches the app or brings it to the front.
struct DeskViewSetup: SetupPresenter {
  func present(_ done: @escaping @Sendable (_ result: String, _ message: String?) -> Void) {
    // On the main queue, which dispatchMain() serves, as the spike's probe called it.
    DispatchQueue.main.async {
      AVCaptureDeskViewApplication().present { error in
        if let error {
          done("failed", error.localizedDescription)
        } else {
          done("presented", nil)
        }
      }
    }
  }
}

/// With a test clip, `openSetup` never opens the Desk View app, which would turn a camera on.
struct FakeSetup: SetupPresenter {
  func present(_ done: @escaping @Sendable (_ result: String, _ message: String?) -> Void) {
    log("fake: present Desk View setup")
    done("presented", nil)
  }
}
