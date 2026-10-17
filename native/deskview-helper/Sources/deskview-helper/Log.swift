import Foundation

/// One line on stderr, with the helper's prefix. Stdout carries only the ready line. Never log
/// the token.
func log(_ message: String) {
  FileHandle.standardError.write(Data("[deskview-helper] \(message)\n".utf8))
}
