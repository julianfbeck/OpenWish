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
    public let kind: OpenWishIssueKind
    public let context: [String: OpenWishValue]
    public let card: OpenWishCard?
    public let commentList: [BugCommentResponse]
    public let createdAt: Date
    public let updatedAt: Date

    private enum CodingKeys: String, CodingKey {
        case id, userUUID, title, description, state, screenshotKeys, reporterEmail
        case kind, context, card, commentList, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        userUUID = try container.decode(String.self, forKey: .userUUID)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decode(String.self, forKey: .description)
        state = try container.decode(String.self, forKey: .state)
        screenshotKeys = try container.decode([String].self, forKey: .screenshotKeys)
        reporterEmail = try container.decodeIfPresent(String.self, forKey: .reporterEmail)
        kind = try container.decodeIfPresent(OpenWishIssueKind.self, forKey: .kind) ?? .bug
        context = try container.decodeIfPresent([String: OpenWishValue].self, forKey: .context) ?? [:]
        card = try container.decodeIfPresent(OpenWishCard.self, forKey: .card)
        commentList = try container.decode([BugCommentResponse].self, forKey: .commentList)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }
}

public struct BugListResponse: Decodable {

    public let list: [BugDetailResponse]
}
