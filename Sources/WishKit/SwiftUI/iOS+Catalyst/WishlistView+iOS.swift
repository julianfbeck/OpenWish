//
//  SwiftUIView.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 9/15/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

#if os(iOS)
import SwiftUI
import WishKitShared
import Combine

extension View {
    // MARK: Public - Wrap in Navigation

    @ViewBuilder
    public func withNavigation() -> some View {
        NavigationView {
            self
        }.navigationViewStyle(.stack)
    }
}

enum LocalWishState: Hashable, Identifiable {
    case all
    case library(WishState)

    var id: String { description }

    var description: String {
        switch self {
        case .all:
            return "All"
        case .library(let wishState):
            return wishState.description
        }
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(description)
    }
}

struct WishlistViewIOS: View {

    @Environment(\.colorScheme)
    private var colorScheme

    @Environment(\.presentationMode)
    private var presentationMode

    @State
    private var selectedWishState: LocalWishState = .all

    @ObservedObject
    var wishModel: WishModel

    @State
    var selectedWish: WishResponse? = nil

    @State
    private var currentWishList: [WishResponse] = []

    private var isInTabBar: Bool {
        let rootViewController = if #available(iOS 15, *) {
            UIApplication
                .shared
                .connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first?
                .rootViewController
        } else {
            UIApplication.shared.windows.first(where: \.isKeyWindow)?.rootViewController
        }

        return rootViewController is UITabBarController
    }

    private var addButtonBottomPadding: CGFloat {
        let basePadding: CGFloat = isInTabBar ? 80 : 30
        switch WishKit.config.buttons.addButton.bottomPadding {
        case .small:
            return basePadding + 15
        case .medium:
            return basePadding + 30
        case .large:
            return basePadding + 60
        }
    }

    private var feedbackStateSelection: [LocalWishState] {
        return [
            .all,
            .library(.pending),
            .library(.inReview),
            .library(.planned),
            .library(.inProgress),
            .library(.completed),
        ]
    }

    private func getList() -> [WishResponse] {
        switch selectedWishState {
        case .all:
            return wishModel.all
        case .library(let state):
            switch state {
            case .pending:
                return wishModel.pendingList
            case .inReview, .approved:
                return wishModel.inReviewList
            case .planned:
                return wishModel.plannedList
            case .inProgress:
                return wishModel.inProgressList
            case .completed, .implemented:
                return wishModel.completedList
            case .rejected:
                return []
            }
        }
    }

    private func getCountFor(state: LocalWishState) -> Int {
        switch state {
        case .all:
            return wishModel.all.count
        case .library(let wishState):
            switch wishState {
            case .pending:
                return wishModel.pendingList.count
            case .inReview, .approved:
                return wishModel.inReviewList.count
            case .planned:
                return wishModel.plannedList.count
            case .inProgress:
                return wishModel.inProgressList.count
            case .completed, .implemented:
                return wishModel.completedList.count
            case .rejected:
                return 0
            }
        }
    }

    var body: some View {
        ZStack {

            if wishModel.isLoading && !wishModel.hasFetched {
                ProgressView()
                    .imageScale(.large)
            }

            if wishModel.hasFetched && !wishModel.isLoading && getList().isEmpty {
                Text("\(selectedWishState.description): \(WishKit.config.localization.noFeatureRequests)")
            }

            ScrollView {
                VStack {

                    if WishKit.config.buttons.segmentedControl.display == .show {
                        Spacer(minLength: 8)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(feedbackStateSelection, id: \.self) { state in
                                    FilterChip(
                                        title: state.description,
                                        count: getCountFor(state: state),
                                        isSelected: selectedWishState == state,
                                        action: {
                                            withAnimation(.easeInOut(duration: 0.15)) {
                                                selectedWishState = state
                                            }
                                        }
                                    )
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                    }

                    Spacer(minLength: 15)

                    if getList().count > 0 {
                        ForEach(getList()) { wish in
                            NavigationLink(destination: {
                                DetailWishView(wishResponse: wish, voteActionCompletion: { wishModel.fetchList() })
                            }, label: {
                                WishView(wishResponse: wish, viewKind: .list, voteActionCompletion: { wishModel.fetchList() })
                                    .padding(.all, 5)
                                    .frame(maxWidth: 700)
                            })
                        }.transition(.opacity)
                    }
                }

                Spacer(minLength: isInTabBar ? 100 : 25)
            }
            .refreshableCompat(action: { await wishModel.fetchList() })
            .padding([.leading, .bottom, .trailing])


            if WishKit.config.buttons.addButton.location == .floating {
                HStack {
                    Spacer()
                    
                    VStack(alignment: .trailing) {
                        VStack {
                            Spacer()
                            
                            if WishKit.config.buttons.addButton.display == .show {
                                NavigationLink(
                                    destination: {
                                        CreateWishView(createActionCompletion: { wishModel.fetchList() })
                                    }, label: {
                                        AddButton(size: CGSize(width: 60, height: 60))
                                    }
                                )
                            }
                        }.padding(.bottom, addButtonBottomPadding)
                    }.padding(.trailing, 20)
                }.frame(maxWidth: 700)
            }
        }
        .frame(maxWidth: .infinity)
        .background(backgroundColor)
        .ignoresSafeArea(edges: [.leading, .bottom, .trailing])
        .navigationTitle(WishKit.config.localization.featureWishlist)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {

            ToolbarItem(placement: .topBarLeading) {
                Button(action: { presentationMode.wrappedValue.dismiss() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.primary)
                }
                .accessibilityLabel("Close")
            }

            ToolbarItem(placement: .topBarTrailing) {
                if WishKit.config.buttons.doneButton.display == .show {
                    Button(WishKit.config.localization.done) {
                        UIApplication.shared.windows.first(where: \.isKeyWindow)?.rootViewController?.dismiss(animated: true)
                    }
                }
                
                if WishKit.config.buttons.addButton.location == .navigationBar {
                    NavigationLink(
                        destination: {
                            CreateWishView(createActionCompletion: { wishModel.fetchList() })
                        }, label: {
                            Text(WishKit.config.localization.addButtonInNavigationBar)
                        }
                    )
                }
            }
        }.onAppear(perform: wishModel.fetchList)
    }

    // MARK: - View

    func getRefreshButton() -> some View {
        if #unavailable(iOS 15) {
            return Button(action: wishModel.fetchList) {
                Image(systemName: "arrow.clockwise")
            }
        } else {
            return EmptyView()
        }
    }
}

private struct FilterChip: View {

    @Environment(\.colorScheme)
    private var colorScheme

    let title: String
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                Text("\(count)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(countTextColor)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule().fill(countBadgeColor)
                    )
            }
            .foregroundColor(textColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule().fill(backgroundColor)
            )
            .overlay(
                Capsule().stroke(borderColor, lineWidth: isSelected ? 0 : 1)
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var primary: Color {
        WishKit.theme.primaryColor
    }

    private var textColor: Color {
        if isSelected {
            return colorScheme == .dark ? .black : .white
        }
        return colorScheme == .dark ? .white : .black
    }

    private var backgroundColor: Color {
        if isSelected {
            return primary
        }
        return Color.clear
    }

    private var borderColor: Color {
        if isSelected {
            return .clear
        }
        return colorScheme == .dark
            ? Color.white.opacity(0.18)
            : Color.black.opacity(0.12)
    }

    private var countBadgeColor: Color {
        if isSelected {
            return colorScheme == .dark
                ? Color.black.opacity(0.18)
                : Color.white.opacity(0.22)
        }
        return colorScheme == .dark
            ? Color.white.opacity(0.12)
            : Color.black.opacity(0.06)
    }

    private var countTextColor: Color {
        if isSelected {
            return colorScheme == .dark ? .black : .white
        }
        return colorScheme == .dark
            ? Color.white.opacity(0.9)
            : Color.black.opacity(0.7)
    }
}

extension WishlistViewIOS {
    var arrowColor: Color {
        let userUUID = UUIDManager.getUUID()
        
        if
            let selectedWish = selectedWish,
            selectedWish.votingUsers.contains(where: { user in user.uuid == userUUID })
        {
            return WishKit.theme.primaryColor
        }

        switch colorScheme {
        case .light:
            return WishKit.config.buttons.voteButton.arrowColor.light
        case .dark:
            return WishKit.config.buttons.voteButton.arrowColor.dark
        }
    }

    var cellBackgroundColor: Color {
        switch colorScheme {
        case .light:
            WishKit.theme.secondaryColor?.light ?? PrivateTheme.elementBackgroundColor.light
        case .dark:
            WishKit.theme.secondaryColor?.dark ?? PrivateTheme.elementBackgroundColor.dark
        }
    }

    var backgroundColor: Color {
        switch colorScheme {
        case .light:
            WishKit.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        case .dark:
            WishKit.theme.tertiaryColor?.dark ?? PrivateTheme.systemBackgroundColor.dark
        }
    }
}
#endif
