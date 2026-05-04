//
//  BugReportView.swift
//  OpenWish
//
//  OpenWish bug report sheet — submit-only.
//

import SwiftUI
#if canImport(PhotosUI)
import PhotosUI
#endif

#if os(iOS)

@available(iOS 15.0, *)
struct BugComposeView: View {

    @Environment(\.dismiss)
    private var dismiss

    @Environment(\.colorScheme)
    private var colorScheme

    var onSubmitted: (() -> Void)? = nil

    @State
    private var title: String = ""

    @State
    private var description: String = ""

    @State
    private var email: String = ""

    @State
    private var attachments: [BugAttachment] = []

    @State
    private var pendingUploads: Int = 0

    @State
    private var isSubmitting: Bool = false

    @State
    private var errorMessage: String? = nil

    private let titleLimit = 80
    private let descriptionLimit = 2_000
    private let emailLimit = 254
    private let attachmentLimit = 4

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                titleField

                descriptionField

                emailField

                screenshotsSection

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(.red)
                }

                submitButton
            }
            .padding(20)
        }
        .background(backgroundColor.ignoresSafeArea())
        .navigationTitle("Report a bug")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(textColor)
                }
                .accessibilityLabel("Close")
                .disabled(isSubmitting)
            }
        }
    }

    // MARK: - Sub-views

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Title")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(textColor)
                Spacer()
                Text("\(title.count) / \(titleLimit)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            TextField("", text: $title, prompt: Text("What went wrong?").foregroundColor(placeholderColor))
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(fieldBackgroundColor)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(borderColor, lineWidth: 1)
                )
                .foregroundColor(textColor)
                .onChange(of: title) { newValue in
                    if newValue.count > titleLimit {
                        title = String(newValue.prefix(titleLimit))
                    }
                }
        }
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Description")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(textColor)
                Spacer()
                Text("\(description.count) / \(descriptionLimit)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            ZStack(alignment: .topLeading) {
                if description.isEmpty {
                    Text("Steps to reproduce, what you expected, what actually happened…")
                        .font(.body)
                        .foregroundColor(placeholderColor)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 16)
                        .allowsHitTesting(false)
                }
                Group {
                    if #available(iOS 16.0, *) {
                        TextEditor(text: $description)
                            .scrollContentBackground(.hidden)
                    } else {
                        TextEditor(text: $description)
                    }
                }
                .frame(minHeight: 140)
                .padding(8)
                .foregroundColor(textColor)
            }
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(fieldBackgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            )
            .onChange(of: description) { newValue in
                if newValue.count > descriptionLimit {
                    description = String(newValue.prefix(descriptionLimit))
                }
            }
        }
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Email")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(textColor)
                Text("optional")
                    .font(.caption.weight(.regular))
                    .foregroundColor(.secondary)
                Spacer()
            }
            ZStack(alignment: .leading) {
                if email.isEmpty {
                    Text("you@example.com")
                        .foregroundColor(placeholderColor)
                        .padding(.horizontal, 12)
                        .allowsHitTesting(false)
                }
                TextField("", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .foregroundColor(textColor)
                    .tint(textColor)
                    .padding(.horizontal, 12)
            }
            .frame(height: 44)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(fieldBackgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(borderColor, lineWidth: 1)
            )
            .onChange(of: email) { newValue in
                if newValue.count > emailLimit {
                    email = String(newValue.prefix(emailLimit))
                }
            }
            if !trimmedEmail.isEmpty && !emailIsValid {
                Text("That doesn't look like an email address.")
                    .font(.caption2)
                    .foregroundColor(.red)
            } else {
                Text("So we can follow up on this report.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var screenshotsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Screenshots")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(textColor)
                Spacer()
                Text("\(attachments.count) / \(attachmentLimit)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(attachments) { attachment in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: attachment.preview)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 96, height: 96)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .stroke(Color.gray.opacity(0.25), lineWidth: 1)
                                    )
                                Button {
                                    attachments.removeAll { $0.id == attachment.id }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 20))
                                        .foregroundColor(.white)
                                        .background(Circle().fill(Color.black.opacity(0.6)))
                                }
                                .padding(4)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            if pendingUploads > 0 {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Uploading \(pendingUploads)…")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            if #available(iOS 16.0, *) {
                BugScreenshotPicker(
                    isDisabled: attachments.count >= attachmentLimit,
                    remaining: attachmentLimit - attachments.count,
                    onPick: handlePickedItem(data:image:)
                )
            } else {
                Text("Screenshot uploads require iOS 16 or newer.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack {
                Spacer()
                if isSubmitting {
                    ProgressView()
                        .tint(submitTextColor)
                } else {
                    Text("Send bug report")
                        .fontWeight(.semibold)
                        .foregroundColor(submitTextColor)
                }
                Spacer()
            }
            .frame(height: 46)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(OpenWish.theme.primaryColor.opacity(canSubmit ? 1 : 0.5))
            )
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
    }

    // MARK: - Logic

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var emailIsValid: Bool {
        guard !trimmedEmail.isEmpty else { return true }
        // Lightweight RFC 5322-ish check: something@something.something
        let pattern = #"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$"#
        return trimmedEmail.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private var canSubmit: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && emailIsValid
            && pendingUploads == 0
            && !isSubmitting
    }

    private func handlePickedItem(data: Data, image: UIImage) {
        guard attachments.count < attachmentLimit else {
            return
        }
        pendingUploads += 1
        Task {
            let contentType = pickContentType(for: data)
            let result = await BugApi.uploadScreenshot(data: data, contentType: contentType)
            await MainActor.run {
                pendingUploads = max(0, pendingUploads - 1)
                switch result {
                case .success(let response):
                    attachments.append(
                        BugAttachment(
                            id: UUID(),
                            preview: image,
                            storageKey: response.key
                        )
                    )
                case .failure:
                    errorMessage = "Could not upload screenshot."
                }
            }
        }
    }

    private func pickContentType(for data: Data) -> String {
        // Quick magic-number sniffing so we send what the server expects.
        guard data.count >= 4 else {
            return "image/jpeg"
        }
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) {
            return "image/png"
        }
        if data.count >= 12,
           data[0] == 0x52, data[1] == 0x49, data[2] == 0x46, data[3] == 0x46,
           data[8] == 0x57, data[9] == 0x45, data[10] == 0x42, data[11] == 0x50 {
            return "image/webp"
        }
        if data.count >= 12,
           data[4] == 0x66, data[5] == 0x74, data[6] == 0x79, data[7] == 0x70 {
            return "image/heic"
        }
        return "image/jpeg"
    }

    private func submit() async {
        isSubmitting = true
        errorMessage = nil

        let payload = CreateBugRequest(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            email: (emailIsValid && !trimmedEmail.isEmpty) ? trimmedEmail : nil,
            screenshotKeys: attachments.map { $0.storageKey }
        )

        let result = await BugApi.createBug(request: payload)
        await MainActor.run {
            isSubmitting = false
            switch result {
            case .success:
                onSubmitted?()
                dismiss()
            case .failure:
                errorMessage = "Could not send bug report. Please try again."
            }
        }
    }

    // MARK: - Theming

    private var textColor: Color {
        Color.primary
    }

    private var placeholderColor: Color {
        switch colorScheme {
        case .dark: return Color.white.opacity(0.35)
        default: return Color.black.opacity(0.35)
        }
    }

    private var borderColor: Color {
        switch colorScheme {
        case .dark: return Color.white.opacity(0.18)
        default: return Color.black.opacity(0.15)
        }
    }

    private var closeButtonBackground: Color {
        switch colorScheme {
        case .dark: return Color.white.opacity(0.10)
        default: return Color.black.opacity(0.08)
        }
    }

    private var fieldBackgroundColor: Color {
        switch colorScheme {
        case .dark: return Color.white.opacity(0.06)
        default: return Color.white
        }
    }

    private var backgroundColor: Color {
        switch colorScheme {
        case .light:
            return OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        case .dark:
            return OpenWish.theme.tertiaryColor?.dark ?? PrivateTheme.systemBackgroundColor.dark
        @unknown default:
            return Color.gray.opacity(0.05)
        }
    }

    private var submitTextColor: Color {
        // White text reads on the primary color in both schemes for the OpenWish theme.
        Color.white
    }
}

@available(iOS 15.0, *)
struct BugAttachment: Identifiable, Equatable {
    let id: UUID
    let preview: UIImage
    let storageKey: String

    static func == (lhs: BugAttachment, rhs: BugAttachment) -> Bool {
        lhs.id == rhs.id
    }
}

@available(iOS 16.0, *)
private struct BugScreenshotPicker: View {

    let isDisabled: Bool
    let remaining: Int
    let onPick: (Data, UIImage) -> Void

    @State
    private var selection: [PhotosPickerItem] = []

    var body: some View {
        PhotosPicker(
            selection: $selection,
            maxSelectionCount: max(remaining, 1),
            matching: .images
        ) {
            HStack {
                Image(systemName: "photo.on.rectangle.angled")
                Text(remaining == 0 ? "Limit reached" : "Add screenshot")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.gray.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [4]))
            )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .onChange(of: selection) { items in
            guard !items.isEmpty else { return }
            for item in items {
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        await MainActor.run {
                            onPick(data, image)
                        }
                    }
                }
            }
            selection = []
        }
    }
}

// MARK: - List & detail

@available(iOS 15.0, *)
struct BugReportContainer: View {

    @Environment(\.dismiss)
    private var dismiss

    @Environment(\.colorScheme)
    private var colorScheme

    @State
    private var bugs: [BugDetailResponse] = []

    @State
    private var isLoading: Bool = true

    @State
    private var loadError: String? = nil

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            content
            NavigationLink(destination: BugComposeView(onSubmitted: { Task { await loadBugs() } })) {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 56, height: 56)
                    .background(
                        Circle().fill(OpenWish.theme.primaryColor)
                    )
                    .shadow(color: Color.black.opacity(0.25), radius: 6, y: 3)
            }
            .padding(20)
            .accessibilityLabel("Report a new bug")
        }
        .background(backgroundColor.ignoresSafeArea())
        .navigationTitle("Bug reports")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(textColor)
                }
                .accessibilityLabel("Close")
            }
        }
        .task { await loadBugs() }
        .refreshable { await loadBugs() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && bugs.isEmpty {
            VStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else if let loadError, bugs.isEmpty {
            VStack(spacing: 12) {
                Spacer()
                Text(loadError)
                    .font(.footnote)
                    .foregroundColor(.red)
                Button("Retry") { Task { await loadBugs() } }
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else if bugs.isEmpty {
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "ladybug")
                    .font(.system(size: 40))
                    .foregroundColor(.secondary)
                Text("No bug reports yet.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                Text("Tap the + to send your first one.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(bugs) { bug in
                        NavigationLink(destination: BugDetailScreen(bug: bug)) {
                            BugRowView(bug: bug)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
                .padding(.bottom, 90)
            }
        }
    }

    @MainActor
    private func loadBugs() async {
        isLoading = true
        loadError = nil
        let result = await BugApi.listBugs()
        switch result {
        case .success(let payload):
            bugs = payload.list
        case .failure:
            if bugs.isEmpty {
                loadError = "Could not load your bug reports."
            }
        }
        isLoading = false
    }

    private var textColor: Color { Color.primary }
    private var backgroundColor: Color {
        switch colorScheme {
        case .light:
            return OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        case .dark:
            return OpenWish.theme.tertiaryColor?.dark ?? PrivateTheme.systemBackgroundColor.dark
        @unknown default:
            return Color.gray.opacity(0.05)
        }
    }
}

@available(iOS 15.0, *)
private struct BugRowView: View {

    @Environment(\.colorScheme)
    private var colorScheme

    let bug: BugDetailResponse

    private var adminReplies: [BugCommentResponse] {
        bug.commentList.filter { $0.isAdmin }
    }

    private var hasAdminReply: Bool {
        !adminReplies.isEmpty
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(hasAdminReply ? OpenWish.theme.primaryColor : Color.clear)
                .frame(width: hasAdminReply ? 3 : 0)

            VStack(alignment: .leading, spacing: 6) {
                if hasAdminReply {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.bubble.fill")
                            .font(.system(size: 10, weight: .semibold))
                        Text(adminReplyLabel)
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        Capsule().fill(OpenWish.theme.primaryColor)
                    )
                }

                HStack(spacing: 8) {
                    Text(bug.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    StatusPill(state: bug.state)
                }
                Text(bug.description)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                HStack(spacing: 12) {
                    Label("\(bug.commentList.count)", systemImage: "bubble.left")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    if !bug.screenshotKeys.isEmpty {
                        Label("\(bug.screenshotKeys.count)", systemImage: "photo")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Text(bug.createdAt, style: .date)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(14)
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(rowBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(borderColor, lineWidth: 1)
        )
    }

    private var adminReplyLabel: String {
        if adminReplies.count == 1 {
            return "Admin replied"
        }
        return "Admin replied · \(adminReplies.count)"
    }

    private var rowBackground: Color {
        if hasAdminReply {
            return OpenWish.theme.primaryColor.opacity(colorScheme == .dark ? 0.10 : 0.08)
        }
        switch colorScheme {
        case .dark: return Color.white.opacity(0.06)
        default: return Color.white
        }
    }

    private var borderColor: Color {
        switch colorScheme {
        case .dark: return Color.white.opacity(0.10)
        default: return Color.black.opacity(0.08)
        }
    }
}

@available(iOS 15.0, *)
struct BugDetailScreen: View {

    @Environment(\.colorScheme)
    private var colorScheme

    let bug: BugDetailResponse

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        StatusPill(state: bug.state)
                        Spacer()
                        Text(bug.createdAt, style: .date)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Text(bug.title)
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.primary)
                }

                Text(bug.description)
                    .font(.body)
                    .foregroundColor(.primary)

                if !bug.commentList.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Conversation")
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.primary)

                        ForEach(bug.commentList) { comment in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 6) {
                                    Text(comment.isAdmin ? "Admin" : "You")
                                        .font(.caption.weight(.semibold))
                                        .foregroundColor(comment.isAdmin ? OpenWish.theme.primaryColor : .secondary)
                                    Text(comment.createdAt, style: .relative)
                                        .font(.caption2)
                                        .foregroundColor(.secondary)
                                }
                                Text(comment.description)
                                    .font(.footnote)
                                    .foregroundColor(.primary)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(bubbleColor(isAdmin: comment.isAdmin))
                                    )
                            }
                        }
                    }
                } else {
                    Text("No replies yet. We'll respond here once we look into it.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.vertical, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(backgroundColor.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func bubbleColor(isAdmin: Bool) -> Color {
        if isAdmin {
            return OpenWish.theme.primaryColor.opacity(0.15)
        }
        switch colorScheme {
        case .dark: return Color.white.opacity(0.06)
        default: return Color.black.opacity(0.04)
        }
    }

    private var backgroundColor: Color {
        switch colorScheme {
        case .light:
            return OpenWish.theme.tertiaryColor?.light ?? PrivateTheme.systemBackgroundColor.light
        case .dark:
            return OpenWish.theme.tertiaryColor?.dark ?? PrivateTheme.systemBackgroundColor.dark
        @unknown default:
            return Color.gray.opacity(0.05)
        }
    }
}

@available(iOS 15.0, *)
private struct StatusPill: View {

    let state: String

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(color)
            )
    }

    private var label: String {
        switch state {
        case "open": return "Open"
        case "confirmed": return "Confirmed"
        case "inProgress": return "In progress"
        case "fixed": return "Fixed"
        case "wontFix": return "Won't fix"
        case "duplicate": return "Duplicate"
        default: return state.capitalized
        }
    }

    private var color: Color {
        switch state {
        case "open": return Color.orange
        case "confirmed": return Color.blue
        case "inProgress": return Color.purple
        case "fixed": return Color.green
        case "wontFix": return Color.gray
        case "duplicate": return Color.gray
        default: return Color.gray
        }
    }
}

#endif
