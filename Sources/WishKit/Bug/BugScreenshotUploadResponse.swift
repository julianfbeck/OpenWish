//
//  BugScreenshotUploadResponse.swift
//  WishKit
//
//  Response of /api/bug/screenshot — the storage key the SDK references when
//  creating the bug.
//

import Foundation

public struct BugScreenshotUploadResponse: Decodable {

    public let key: String
}
