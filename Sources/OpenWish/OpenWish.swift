//
//  OpenWish.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 2/9/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

#if canImport(UIKit)
import UIKit
#endif

import SwiftUI
import WishKitShared
import Combine

public struct OpenWish {
    
    private static let threadLock = NSLock()
    
    private static var subscribers: Set<AnyCancellable> = []

    static var apiKey = "my-fancy-api-key"

    static var _apiUrlOverride: String?

    static var user = User()

    static var _theme = Theme()
    
    static var _config = Configuration()

    public static var theme: Theme {
        get {
            return threadLock.withLock { _theme }
        } set {
            threadLock.withLock { _theme = newValue }
        }
    }

    public static var config: Configuration {
        get {
            return threadLock.withLock { _config }
        } set {
            threadLock.withLock { _config = newValue }
        }
    }

    static var apiUrlOverride: String? {
        get {
            return threadLock.withLock { _apiUrlOverride }
        } set {
            threadLock.withLock { _apiUrlOverride = newValue }
        }
    }

    #if canImport(UIKit) && !os(visionOS)
    /// (UIKit) The WishList viewcontroller.
    public static var viewController: UIViewController {
        UIHostingController(rootView: WishlistViewIOS(wishModel: WishModel()))
    }
    #endif
    
    /// (SwiftUI) The WishList view.
    @available(*, deprecated, message: "Use `OpenWish.FeedbackListView()` instead.")
    public static var view: some View {
        #if os(macOS) || os(visionOS)
            return WishlistContainer(wishModel: WishModel())
        #else
            return WishlistViewIOS(wishModel: WishModel())
        #endif
    }

    public static func configure(with apiKey: String, apiUrl: String? = nil) {
        OpenWish.apiKey = apiKey
        OpenWish.apiUrlOverride = apiUrl
    }

    /// FeedbackView that renders the list of feedback.
    public struct FeedbackListView: View {

        public init () { }

        public var body: some View {
        #if os(macOS) || os(visionOS)
            WishlistContainer(wishModel: WishModel())
        #else
            WishlistViewIOS(wishModel: WishModel())
        #endif
        }
    }

    /// OpenWish bug-report sheet — submit-only.
    #if os(iOS)
    @available(iOS 15.0, *)
    public struct BugReportView: View {

        public init() {}

        public var body: some View {
            BugReportContainer()
        }
    }
    #endif
}

// MARK: - Payment Model

class RoundUp: NSDecimalNumberBehaviors {
    func scale() -> Int16 {
        return 0
    }

    func exceptionDuringOperation(_ operation: Selector, error: NSDecimalNumber.CalculationError, leftOperand: NSDecimalNumber, rightOperand: NSDecimalNumber?) -> NSDecimalNumber? {
        return 0
    }

    func roundingMode() -> NSDecimalNumber.RoundingMode {
        .up
    }
}

public struct Payment {

    let amount: Int

    // MARK: - Weekly

    /// Accepts a price expressed in `Decimal` e.g: 2.99 or 11.49
    public static func weekly(_ amount: Decimal) -> Payment {
        let amount = NSDecimalNumber(decimal: amount * 100).intValue
        let amountPerMonth = amount * 4
        return Payment(amount: amountPerMonth)
    }

    // MARK: - Monthly

    /// Accepts a price expressed in `Decimal` e.g: 6.99 or 19.49
    public static func monthly(_ amount: Decimal) -> Payment {
        let amount = NSDecimalNumber(decimal: amount * 100).intValue
        return Payment(amount: amount)
    }

    // MARK: - Yearly

    /// Accepts a price expressed in `Decimal` e.g: 6.99 or 19.49
    public static func yearly(_ amount: Decimal) -> Payment {
        let amountPerMonth = NSDecimalNumber(decimal: (amount * 100) / 12).rounding(accordingToBehavior: RoundUp()).intValue
        return Payment(amount: amountPerMonth)
    }
}

// MARK: - Update User Logic

extension OpenWish {
    public static func updateUser(customID: String) {
        self.user.customID = customID
        sendUserToBackend()
    }

    public static func updateUser(email: String) {
        self.user.email = email
        sendUserToBackend()
    }

    public static func updateUser(name: String) {
        self.user.name = name
        sendUserToBackend()
    }

    public static func updateUser(payment: Payment) {
        self.user.payment = payment
        sendUserToBackend()
    }

    static func sendUserToBackend() {
        Task {
            let request = user.createRequest()
            let _ = await UserApi.updateUser(userRequest: request)
        }
    }
}
