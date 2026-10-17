import DeskViewCore
import Testing

private let mac = DeviceInfo(id: "mac-desk", name: "MacBook Pro Desk View Camera", builtIn: true)
private let phone = DeviceInfo(id: "phone-desk", name: "iPhone Desk View Camera", builtIn: false)

@Test func pickDevicePrefersTheRequestedOneThenABuiltInOne() {
  #expect(pickDevice("phone-desk", from: [mac, phone]) == phone)
  #expect(pickDevice(nil, from: [phone, mac]) == mac)
  // A requested device that went away falls back like no request.
  #expect(pickDevice("gone", from: [phone, mac]) == mac)
  // With only Continuity Cameras, the first one.
  let other = DeviceInfo(id: "phone-2", name: "Other iPhone", builtIn: false)
  #expect(pickDevice(nil, from: [phone, other]) == phone)
  #expect(pickDevice(nil, from: []) == nil)
  #expect(pickDevice("phone-desk", from: []) == nil)
}

@Test func scaledSizeNarrowsToMaxWidthAndKeepsTheAspect() {
  #expect(scaledSize(width: 1920, height: 1440, maxWidth: 1920) == (1920, 1440))
  #expect(scaledSize(width: 1920, height: 1440, maxWidth: 1280) == (1280, 960))
  #expect(scaledSize(width: 1920, height: 1440, maxWidth: 320) == (320, 240))
  #expect(scaledSize(width: 1000, height: 333, maxWidth: 320) == (320, 107))
  // Never wider: a small frame keeps its size.
  #expect(scaledSize(width: 640, height: 480, maxWidth: 1920) == (640, 480))
  #expect(scaledSize(width: 4000, height: 1, maxWidth: 320) == (320, 1))
}
