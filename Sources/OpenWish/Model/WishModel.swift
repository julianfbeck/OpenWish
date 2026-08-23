//
//  WishModel.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 3/11/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import Combine
import WishKitShared
import Foundation
import SwiftUI

final class WishModel: ObservableObject {

    @Published
    @available(*, deprecated, message: "Use `inReviewList` instead.")
    var approvedWishlist: [WishResponse] = []

    @Published
    @available(*, deprecated, message: "Use `completedList` instead.")
    var implementedWishlist: [WishResponse] = []

    @Published
    var all: [WishResponse] = []

    @Published
    var pendingList: [WishResponse] = []

    @Published
    var inReviewList: [WishResponse] = []

    @Published
    var plannedList: [WishResponse] = []

    @Published
    var inProgressList: [WishResponse] = []

    @Published
    var completedList: [WishResponse] = []

    /// All feedback visible to the current user. Pending feedback created by
    /// other users is excluded even when returned by a legacy server.
    @Published
    var fullList: [WishResponse] = []

    @Published
    var shouldShowWatermark: Bool = false

    @Published
    var isLoading: Bool = false

    // Used to differentiate empty list from fetch vs. from initial instance creation.
    @Published
    var hasFetched: Bool = false

    @MainActor
    func fetchList(completion: (() -> ())? = nil) {
        isLoading = true
        
        WishApi.fetchWishList { result in
            switch result {
            case .success(let response):
                DispatchQueue.main.async {
                    let visibleList = response.list.filter {
                        $0.state != .pending || $0.userUUID == UUIDManager.getUUID()
                    }
                    self.updateAllLists(with: visibleList)
                    self.shouldShowWatermark = response.shouldShowWatermark
                    self.fullList = visibleList
                }
            case .failure(let error):
                printError(self, error.reason.description)
            }

            DispatchQueue.main.async {
                self.isLoading = false
                self.hasFetched = true
            }
            
            completion?()
        }
    }

    @MainActor
    func fetchList() {
        fetchList(completion: nil)
    }

    private func updateAllLists(with list: [WishResponse]) {
        let sortedList = list.sorted { $0.votingUsers.count > $1.votingUsers.count }

        self.pendingList = sortedList.filter { wish in wish.state == .pending && wish.userUUID == UUIDManager.getUUID() }
        self.inReviewList = sortedList.filter { wish in wish.state == .inReview || wish.state == .approved }
        self.plannedList = sortedList.filter { wish in wish.state == .planned }
        self.inProgressList = sortedList.filter { wish in wish.state == .inProgress }
        self.completedList = sortedList.filter { wish in wish.state == .completed  || wish.state == .implemented}

        self.all = (self.pendingList + self.inReviewList + self.plannedList + self.inProgressList + self.completedList).sorted { $0.votingUsers.count > $1.votingUsers.count }

        self.implementedWishlist = sortedList
    }
}
