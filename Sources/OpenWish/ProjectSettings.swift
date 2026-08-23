//
//  ProjectSettings.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 2/10/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import Foundation

struct ProjectSettings {
    static var apiUrl: String {
        if let apiUrlOverride = OpenWish.apiUrlOverride, apiUrlOverride.isEmpty == false {
            return apiUrlOverride
        }

        let wishKitUrl = ProcessInfo.processInfo.environment["wishkit-url"]
        return wishKitUrl ?? "https://www.wishkit.io/api"
    }
    static let sdkVersion = "5.0.0"

    static var shouldTryV2: Bool {
        switch OpenWish.apiVersion {
        case .v1:
            return false
        case .v2:
            return true
        case .automatic:
            // The hosted WishKit service only implements the legacy contract.
            // Custom/self-hosted OpenWish URLs negotiate V2 with V1 fallback.
            return OpenWish.apiUrlOverride?.isEmpty == false
        }
    }
}
