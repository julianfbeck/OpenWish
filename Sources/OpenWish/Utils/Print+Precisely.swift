//
//  Print+Precisely.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 2/9/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import os

/// More verbose SUCCESS message print function.
internal func printSuccess<T>(_ type: T, _ text: String, line: Int = #line) {
  printu(.success, type, line, text)
}

/// More verbose ERROR message print function.
internal func printError<T>(_ type: T, _ text: String, line: Int = #line) {
  printu(.error, type, line, text)
}

/// More verbose INFO message print function.
internal func printInfo<T>(_ type: T, _ text: String, line: Int = #line) {
  printu(.info, type, line, text)
}

/// More verbose WARNING message print function.
internal func printWarning<T>(_ type: T, _ text: String, line: Int = #line) {
  printu(.warning, type, line, text)
}

/// More verbose DEBUG message print function.
internal func printDebug<T>(_ type: T, _ text: String, line: Int = #line) {
  printu(.debug, type, line, text)
}

/// Debug-level unified logging instead of `print`: nothing reaches the host
/// app's console unless debug logging for the "OpenWish" subsystem is enabled,
/// and the message (it can contain server responses) is private.
fileprivate func printu<T>(_ kind: Kind, _ type: T, _ line: Int, _ text: String) {
  let typeName = cleanUp(type: T.self)
  openWishLogger.debug("\(kind.rawValue, privacy: .public) \(typeName, privacy: .public):\(line, privacy: .public) \(text, privacy: .private)")
}

let openWishLogger = Logger(subsystem: "OpenWish", category: "sdk")

fileprivate enum Kind: String {
  case success = "✅"
  case info = "🗒"
  case warning = "⚠️"
  case error = "❌"
  case debug = "🐛"
}

/// Makes sure in case of "WishlistVC" and "WishlistVC.Type"
/// that in both cases "WishlistVC" is returned.
fileprivate func cleanUp<T>(type: T) -> String {
  let uncleanedType = String(describing: T.self)
  let typeWordList = uncleanedType.split(separator: ".")
  return String(describing: typeWordList[0])
}

