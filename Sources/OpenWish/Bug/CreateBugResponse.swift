//
//  CreateBugResponse.swift
//  OpenWish
//
//  Response of /api/bug/create.
//

import Foundation

public struct CreateBugResponse: Decodable {

    public let id: UUID
    public let state: String
    public let createdAt: Date
}
