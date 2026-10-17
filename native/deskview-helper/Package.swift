// swift-tools-version: 6.0
// Tassel's Desk View helper (macOS only): it streams the Desk View camera to the app over a
// loopback WebSocket, protocol v1. Build and test it with `node scripts/native.mjs build|test`,
// which adds the flags Swift Testing needs under Command Line Tools.
import PackageDescription

let package = Package(
  name: "deskview-helper",
  // The Command Line Tools' Testing.framework is built for macOS 14.
  platforms: [.macOS(.v14)],
  targets: [
    // Protocol v1, auth, pacing and the MJPEG reader: everything that needs no camera or socket.
    .target(
      name: "DeskViewCore",
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    // The helper itself: the WebSocket server, the camera and clip producers, and setup.
    .executableTarget(
      name: "deskview-helper",
      dependencies: ["DeskViewCore"],
      exclude: ["Info.plist"],
      swiftSettings: [.swiftLanguageMode(.v6)],
      // Embeds Info.plist (bundle id and camera usage text) in the binary. The linker's ad-hoc
      // signature leaves it unbound, so `native.mjs build` re-signs the binary to bind it.
      linkerSettings: [
        .unsafeFlags([
          "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
          "-Xlinker", "Sources/deskview-helper/Info.plist",
        ])
      ]
    ),
    .testTarget(
      name: "DeskViewCoreTests",
      dependencies: ["DeskViewCore"],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
    // Spawns the built helper in clip mode, so `swift test` builds the executable first.
    .testTarget(
      name: "DeskViewHelperTests",
      dependencies: ["deskview-helper", "DeskViewCore"],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
