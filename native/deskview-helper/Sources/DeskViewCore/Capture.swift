/// The device to open: the requested one, else the first that isn't a Continuity Camera (an
/// iPhone's, which can walk away), else the first. Nil when there is none.
public func pickDevice(_ requested: String?, from devices: [DeviceInfo]) -> DeviceInfo? {
  if let requested, let match = devices.first(where: { $0.id == requested }) { return match }
  return devices.first(where: \.builtIn) ?? devices.first
}

/// The size a frame is encoded at: its own, or narrowed to `maxWidth` with its aspect ratio kept
/// (the height rounded, at least 1). Frames are never made wider.
public func scaledSize(width: Int, height: Int, maxWidth: Int) -> (width: Int, height: Int) {
  guard width > maxWidth, maxWidth > 0 else { return (width, height) }
  let scaled = (Double(height) * Double(maxWidth) / Double(width)).rounded()
  return (maxWidth, max(1, Int(scaled)))
}
