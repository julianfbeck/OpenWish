//
//  SegmentedView.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 9/15/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import SwiftUI
import WishKitShared

extension WishState: Identifiable {
    public var id: Self { self }

    public var description: String {
        switch self {
        case .approved:
            OpenWish.config.localization.approved
        case .implemented:
            OpenWish.config.localization.implemented
        case .pending:
            OpenWish.config.localization.pending
        case .inReview:
            OpenWish.config.localization.inReview
        case .planned:
            OpenWish.config.localization.planned
        case .inProgress:
            OpenWish.config.localization.inProgress
        case .completed:
            OpenWish.config.localization.completed
        default:
            "Not Supported"
        }
    }
}
