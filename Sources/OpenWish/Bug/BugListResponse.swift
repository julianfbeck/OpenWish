//
//  BugListResponse.swift
//  OpenWish
//
//  Response of `GET /api/bug/list` — bugs filed by the current
//  `x-wishkit-uuid`.
//

import Foundation

public struct BugCommentResponse: Decodable, Identifiable {

    public let id: UUID
    public let userId: UUID
    public let description: String
    public let createdAt: Date
    public let isAdmin: Bool
}

public struct BugDetailResponse: Decodable, Identifiable {

    public let id: UUID
    public let userUUID: String
    public let title: String
    public let description: String
    public let state: String
    public let screenshotKeys: [String]
    public let reporterEmail: String?
    public let commentList: [BugCommentResponse]
    public let createdAt: Date
    public let updatedAt: Date
}

public struct BugListResponse: Decodable {

    public let list: [BugDetailResponse]
}
