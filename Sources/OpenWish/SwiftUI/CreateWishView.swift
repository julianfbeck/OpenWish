//
//  CreateWishView.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 8/26/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

import SwiftUI
import Combine
import WishKitShared

struct CreateWishView: View {

    @Environment(\.presentationMode)
    var presentationMode

    @Environment(\.colorScheme)
    private var colorScheme

    @ObservedObject
    private var alertModel = AlertModel()

    @State
    private var titleCharCount = 0

    @State
    private var titleText = ""

    @State
    private var emailText = ""

    @State
    private var descriptionText = ""

    @State
    private var isButtonDisabled = true

    @State
    private var isButtonLoading: Bool? = false

    @State
    private var showConfirmationAlert = false

    let createActionCompletion: () -> Void

    var closeAction: (() -> Void)? = nil

    var saveButtonSize: CGSize {
        #if os(macOS) || os(visionOS)
            return CGSize(width: 100, height: 30)
        #else
            return CGSize(width: 200, height: 45)
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            if showCloseButton() {
                HStack {
                    Spacer()
                    CloseButton(closeAction: dismissViewAction)
                        .alert(isPresented: $showConfirmationAlert) {
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok), action: crossPlatformDismiss)
                            
                            return Alert(
                                title: Text(OpenWish.config.localization.info),
                                message: Text(OpenWish.config.localization.discardEnteredInformation),
                                primaryButton: button,
                                secondaryButton: .cancel()
                            )
                        }
                }
            }

            ScrollView {
                VStack(spacing: 15) {
                    VStack(spacing: 0) {
                        HStack {
                            Text(OpenWish.config.localization.title)
                            Spacer()
                            Text("\(titleText.count)/50")
                        }
                        .font(.caption2)
                        .padding([.leading, .trailing, .bottom], 5)

                        TextField("", text: $titleText)
                            .padding(10)
                            .textFieldStyle(.plain)
                            .foregroundColor(textColor)
                            .background(fieldBackgroundColor)
                            .clipShape(RoundedRectangle(cornerRadius: OpenWish.config.cornerRadius, style: .continuous))
                            .onReceive(Just(titleText)) { _ in handleTitleAndDescriptionChange() }
                    }

                    VStack(spacing: 0) {
                        HStack {
                            Text(OpenWish.config.localization.description)
                            Spacer()
                            Text("\(descriptionText.count)/500")
                        }
                        .font(.caption2)
                        .padding([.leading, .trailing, .bottom], 5)

                        TextEditor(text: $descriptionText)
                            .padding([.leading, .trailing], 5)
                            .padding([.top, .bottom], 10)
                            .lineSpacing(3)
                            .frame(height: 200)
                            .foregroundColor(textColor)
                            .scrollContentBackgroundCompat(.hidden)
                            .background(fieldBackgroundColor)
                            .clipShape(RoundedRectangle(cornerRadius: OpenWish.config.cornerRadius, style: .continuous))
                            .onReceive(Just(descriptionText)) { _ in handleTitleAndDescriptionChange() }
                    }

                    if OpenWish.config.emailField != .none {
                        VStack(spacing: 0) {
                            HStack {
                                if OpenWish.config.emailField == .optional {
                                    Text(OpenWish.config.localization.emailOptional)
                                        .font(.caption2)
                                        .padding([.leading, .trailing, .bottom], 5)
                                }

                                if OpenWish.config.emailField == .required {
                                    Text(OpenWish.config.localization.emailRequired)
                                        .font(.caption2)
                                        .padding([.leading, .trailing, .bottom], 5)
                                }

                                Spacer()
                            }

                            TextField("", text: $emailText)
                                .padding(10)
                                .textFieldStyle(.plain)
                                .foregroundColor(textColor)
                                .background(fieldBackgroundColor)
                                .clipShape(RoundedRectangle(cornerRadius: OpenWish.config.cornerRadius, style: .continuous))
                        }
                    }

                    #if os(macOS) || os(visionOS)
                    Spacer()
                    #endif

                    WKButton(
                        text: OpenWish.config.localization.save,
                        action: submitAction,
                        style: .primary,
                        isLoading: $isButtonLoading,
                        size: saveButtonSize
                    )
                    .disabled(isButtonDisabled)
                    .alert(isPresented: $alertModel.showAlert) {

                        switch alertModel.alertReason {
                        case .successfullyCreated:
                            let button = Alert.Button.default(
                                Text(OpenWish.config.localization.ok),
                                action: {
                                    createActionCompletion()
                                    dismissAction()
                                }
                            )

                            return Alert(
                                title: Text(OpenWish.config.localization.info),
                                message: Text(OpenWish.config.localization.successfullyCreated),
                                dismissButton: button
                            )
                        case .createReturnedError(let errorText):
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok))

                            return Alert(
                                title: Text(OpenWish.config.localization.info),
                                message: Text(errorText),
                                dismissButton: button
                            )
                        case .emailRequired:
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok))

                            return Alert(
                                title: Text(OpenWish.config.localization.info),
                                message: Text(OpenWish.config.localization.emailRequiredText),
                                dismissButton: button
                            )
                        case .emailFormatWrong:
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok))

                            return Alert(
                                title: Text(OpenWish.config.localization.info),
                                message: Text(OpenWish.config.localization.emailFormatWrongText),
                                dismissButton: button
                            )
                        case .none:
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok))
                            return Alert(title: Text(""), dismissButton: button)
                        default:
                            let button = Alert.Button.default(Text(OpenWish.config.localization.ok))
                            return Alert(title: Text(""), dismissButton: button)
                        }

                    }
                }
                .frame(maxWidth: 700)
                .padding()

                #if os(iOS)
                Spacer()
                #endif
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundColor)
        .ignoresSafeArea(edges: [.leading, .trailing])
        .toolbarKeyboardDoneButton()
    }

    private func showCloseButton() -> Bool {
        #if os(macOS) || os(visionOS)
            return true
        #else
            return false
        #endif
    }

    private func handleTitleAndDescriptionChange() {

        // Keep characters within limits
        let titleLimit = 50
        let descriptionLimit = 500

        if titleText.count > titleLimit {
            titleText = String(titleText.prefix(titleLimit))
        }

        if descriptionText.count > descriptionLimit {
            descriptionText = String(descriptionText.prefix(descriptionLimit))
        }

        // Enable/Disable button
        isButtonDisabled = titleText.isEmpty || descriptionText.isEmpty
    }

    private func submitAction() {

        if OpenWish.config.emailField == .required && emailText.isEmpty {
            alertModel.alertReason = .emailRequired
            alertModel.showAlert = true
            return
        }

        let isInvalidEmailFormat = (emailText.count < 6 || !emailText.contains("@") || !emailText.contains("."))
        if !emailText.isEmpty && isInvalidEmailFormat {
            alertModel.alertReason = .emailFormatWrong
            alertModel.showAlert = true
            return
        }

        isButtonLoading = true

        let createRequest = CreateWishRequest(title: titleText, description: descriptionText, email: emailText)
        WishApi.createWish(createRequest: createRequest) { result in
            Task { @MainActor in
                isButtonLoading = false
                switch result {
                case .success:
                    alertModel.alertReason = .successfullyCreated
                    alertModel.showAlert = true
                case .failure(let error):
                    alertModel.alertReason = .createReturnedError(error.reason.description)
                    alertModel.showAlert = true
                }
            }
        }
    }

    private func dismissViewAction() {
        if !titleText.isEmpty || !descriptionText.isEmpty || !emailText.isEmpty {
            showConfirmationAlert = true
        } else {
            crossPlatformDismiss()
        }
    }

    private func crossPlatformDismiss() {
        #if os(macOS) || os(visionOS)
        closeAction?()
        #else
        dismissAction()
        #endif
    }

    private func dismissAction() {
        presentationMode.wrappedValue.dismiss()
    }
}

// MARK: - Color Scheme

extension CreateWishView {

    var textColor: Color {
        switch colorScheme {
        case .light:
            OpenWish.theme.textColor?.light ?? .black
        case .dark:
            OpenWish.theme.textColor?.dark ?? .white
        @unknown default:
            OpenWish.theme.textColor?.light ?? .black
        }
    }

    var backgroundColor: Color {
        switch colorScheme {
        case .light:
            OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        case .dark:
            OpenWish.theme.tertiaryColor?.dark ?? PrivateTheme.systemBackgroundColor.dark
        @unknown default:
            OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        }
    }

    var fieldBackgroundColor: Color {
        switch colorScheme {
        case .light:
            OpenWish.theme.secondaryColor?.light ?? PrivateTheme.elementBackgroundColor.light
        case .dark:
            OpenWish.theme.secondaryColor?.dark ?? PrivateTheme.elementBackgroundColor.dark
        @unknown default:
            OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        }
    }
}
