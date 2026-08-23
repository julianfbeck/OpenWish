//
//  CreateBugRequest.swift
//  OpenWish
//
//  OpenWish bug-report payload sent to /api/bug/create.
//

import Foundation

public struct CreateBugRequest: Encodable {

    public let title: String
    public let description: String
    public let email: String?
    public let screenshotKeys: [String]
    public let kind: OpenWishIssueKind
    public let context: [String: OpenWishValue]
    public let card: OpenWishCard?

    public init(
        title: String,
        description: String,
        email: String? = nil,
        screenshotKeys: [String] = [],
        kind: OpenWishIssueKind = .bug,
        context: [String: OpenWishValue] = [:],
        card: OpenWishCard? = nil
    ) {
        self.title = title
        self.description = description
        self.email = email
        self.screenshotKeys = screenshotKeys
        self.kind = kind
        self.context = context
        self.card = card
    }
}
