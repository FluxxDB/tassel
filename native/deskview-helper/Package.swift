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
    .testTarget(
      name: "DeskViewCoreTests",
      dependencies: ["DeskViewCore"],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
