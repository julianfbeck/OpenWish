//
//  Configuration+Localization.swift
//  wishkit-ios
//
//  Created by Martin Lasek on 4/13/23.
//  Copyright © 2023 Martin Lasek. All rights reserved.
//

extension Configuration {

    public struct Localization {

        public var requested: String

        public var pending: String

        public var approved: String

        public var implemented: String

        public var inReview: String

        public var planned: String

        public var inProgress: String

        public var completed: String

        public var wishlist: String

        public var save: String

        public var title: String

        public var description: String

        public var upvote: String

        public var info: String

        public var youCanOnlyVoteOnce: String

        public var youCanNotVoteForAnImplementedWish: String

        public var youCanNotVoteForYourOwnWish: String

        public var poweredBy: String

        public var successfullyCreated: String

        public var done: String

        public var detail: String

        public var featureWishlist: String

        public var confirm: String

        public var cancel: String

        public var ok: String

        public var titleOfWish: String

        public var titleDescriptionCannotBeEmpty: String

        public var votes: String

        public var close: String

        public var createWish: String

        public var optional: String

        public var required: String

        public var emailRequiredText: String

        public var emailFormatWrongText: String

        public var comments: String

        public var writeAComment: String

        public var admin: String

        public var user: String

        public var noFeatureRequests: String

        public var emailOptional: String

        public var emailRequired: String

        public var discardEnteredInformation: String
        
        public var addButtonInNavigationBar: String

        public var refresh: String

        public var refreshing: String

        public init(
            requested: String = Localization.default().requested,
            pending: String = Localization.default().pending,
            approved: String = Localization.default().approved,
            implemented: String = Localization.default().implemented,
            inReview: String = Localization.default().inReview,
            planned: String = Localization.default().planned,
            inProgress: String = Localization.default().inProgress,
            completed: String = Localization.default().completed,
            wishlist: String = Localization.default().wishlist,
            save: String = Localization.default().save,
            title: String = Localization.default().title,
            description: String = Localization.default().description,
            upvote: String = Localization.default().upvote,
            info: String = Localization.default().info,
            youCanOnlyVoteOnce: String = Localization.default().youCanOnlyVoteOnce,
            youCanNotVoteForAnImplementedWish: String = Localization.default().youCanNotVoteForAnImplementedWish,
            youCanNotVoteForYourOwnWish: String = Localization.default().youCanNotVoteForYourOwnWish,
            poweredBy: String = Localization.default().poweredBy,
            successfullyCreated: String = Localization.default().successfullyCreated,
            done: String = Localization.default().done,
            detail: String = Localization.default().detail,
            featureWishlist: String = Localization.default().featureWishlist,
            confirm: String = Localization.default().confirm,
            cancel: String = Localization.default().cancel,
            ok: String = Localization.default().ok,
            titleOfWish: String = Localization.default().titleOfWish,
            titleDescriptionCannotBeEmpty: String = Localization.default().titleDescriptionCannotBeEmpty,
            votes: String = Localization.default().votes,
            close: String = Localization.default().close,
            createWish: String = Localization.default().createWish,
            optional: String = Localization.default().optional,
            required: String = Localization.default().required,
            emailRequiredText: String = Localization.default().emailRequiredText,
            emailFormatWrongText: String = Localization.default().emailFormatWrongText,
            comments: String = Localization.default().comments,
            writeAComment: String = Localization.default().writeAComment,
            admin: String = Localization.default().admin,
            user: String = Localization.default().user,
            noFeatureRequests: String = Localization.default().noFeatureRequests,
            emailOptional: String = Localization.default().emailOptional,
            emailRequired: String = Localization.default().emailRequired,
            discardEnteredInformation: String = Localization.default().discardEnteredInformation,
            addButtonInNavigationBar: String = Localization.default().addButtonInNavigationBar,
            refresh: String = Localization.default().refresh,
            refreshing: String = Localization.default().refreshing
        ) {
            self.requested = requested
            self.pending = pending
            self.approved = approved
            self.implemented = implemented
            self.inReview = inReview
            self.planned = planned
            self.inProgress = inProgress
            self.completed = completed
            self.wishlist = wishlist
            self.save = save
            self.title = title
            self.description = description
            self.upvote = upvote
            self.info = info
            self.youCanOnlyVoteOnce = youCanOnlyVoteOnce
            self.youCanNotVoteForAnImplementedWish = youCanNotVoteForAnImplementedWish
            self.youCanNotVoteForYourOwnWish = youCanNotVoteForYourOwnWish
            self.poweredBy = poweredBy
            self.successfullyCreated = successfullyCreated
            self.done = done
            self.detail = detail
            self.featureWishlist = featureWishlist
            self.confirm = confirm
            self.cancel = cancel
            self.ok = ok
            self.titleOfWish = titleOfWish
            self.titleDescriptionCannotBeEmpty = titleDescriptionCannotBeEmpty
            self.votes = votes
            self.close = close
            self.createWish = createWish
            self.optional = optional
            self.required = required
            self.emailRequiredText = emailRequiredText
            self.emailFormatWrongText = emailFormatWrongText
            self.comments = comments
            self.writeAComment = writeAComment
            self.admin = admin
            self.user = user
            self.noFeatureRequests = noFeatureRequests
            self.emailOptional = emailOptional
            self.emailRequired = emailRequired
            self.discardEnteredInformation = discardEnteredInformation
            self.addButtonInNavigationBar = addButtonInNavigationBar
            self.refresh = refresh
            self.refreshing = refreshing
        }

        /// Defaults in the app's language (22 languages ship with the package).
        /// Override single fields through `OpenWish.config.localization`, or
        /// any key through an `OpenWish` string table in the app.
        public static func `default`() -> Localization {
            appLanguageDefault
        }

        // Built once: every defaulted init parameter calls `default()`. The app
        // language only changes with a relaunch.
        private static let appLanguageDefault = Localization(
                requested: OpenWishStrings.text("wish.requested", "Requested"),
                pending: OpenWishStrings.text("wish.pending", "Pending"),
                approved: OpenWishStrings.text("wish.approved", "In Review"),
                implemented: OpenWishStrings.text("wish.implemented", "Completed"),
                inReview: OpenWishStrings.text("wish.inReview", "In Review"),
                planned: OpenWishStrings.text("wish.planned", "Planned"),
                inProgress: OpenWishStrings.text("wish.inProgress", "In Progress"),
                completed: OpenWishStrings.text("wish.completed", "Completed"),
                wishlist: OpenWishStrings.text("wish.wishlist", "Feature Requests"),
                save: OpenWishStrings.text("wish.save", "Save"),
                title: OpenWishStrings.text("wish.title", "Title"),
                description: OpenWishStrings.text("wish.description", "Description"),
                upvote: OpenWishStrings.text("wish.upvote", "Upvote"),
                info: OpenWishStrings.text("wish.info", "Info"),
                youCanOnlyVoteOnce: OpenWishStrings.text("wish.youCanOnlyVoteOnce", "You can only vote once."),
                youCanNotVoteForAnImplementedWish: OpenWishStrings.text("wish.youCanNotVoteForAnImplementedWish", "You can not vote for a feature that is already implemented."),
                youCanNotVoteForYourOwnWish: OpenWishStrings.text("wish.youCanNotVoteForYourOwnWish", "You cannot vote for your own feature request."),
                poweredBy: OpenWishStrings.text("wish.poweredBy", "Powered by"),
                successfullyCreated: OpenWishStrings.text("wish.successfullyCreated", "Successfully created"),
                done: OpenWishStrings.text("wish.done", "Done"),
                detail: OpenWishStrings.text("wish.detail", "Detail"),
                featureWishlist: OpenWishStrings.text("wish.featureWishlist", "Feature Requests"),
                confirm: OpenWishStrings.text("wish.confirm", "Confirm"),
                cancel: OpenWishStrings.text("wish.cancel", "Cancel"),
                ok: OpenWishStrings.text("wish.ok", "Ok"),
                titleOfWish: OpenWishStrings.text("wish.titleOfWish", "Title of the feature.."),
                titleDescriptionCannotBeEmpty: OpenWishStrings.text("wish.titleDescriptionCannotBeEmpty", "Title/Description cannot be empty."),
                votes: OpenWishStrings.text("wish.votes", "Votes"),
                close: OpenWishStrings.text("wish.close", "Close"),
                createWish: OpenWishStrings.text("wish.createWish", "Create Feature"),
                optional: OpenWishStrings.text("wish.optional", "optional"),
                required: OpenWishStrings.text("wish.required", "required"),
                emailRequiredText: OpenWishStrings.text("wish.emailRequiredText", "Please enter your email address."),
                emailFormatWrongText: OpenWishStrings.text("wish.emailFormatWrongText", "Wrong email format."),
                comments: OpenWishStrings.text("wish.comments", "Comments"),
                writeAComment: OpenWishStrings.text("wish.writeAComment", "Write a comment.."),
                admin: OpenWishStrings.text("wish.admin", "Admin"),
                user: OpenWishStrings.text("wish.user", "User"),
                noFeatureRequests: OpenWishStrings.text("wish.noFeatureRequests", "No feature requests, yet ✨"),
                emailOptional: OpenWishStrings.text("wish.emailOptional", "Email (optional)"),
                emailRequired: OpenWishStrings.text("wish.emailRequired", "Email (required)"),
                discardEnteredInformation: OpenWishStrings.text("wish.discardEnteredInformation", "Discard entered information?"),
                addButtonInNavigationBar: OpenWishStrings.text("wish.addButtonInNavigationBar", "Create"),
                refresh: OpenWishStrings.text("wish.refresh", "Refresh"),
                refreshing: OpenWishStrings.text("wish.refreshing", "Refreshing..")
            )
    }
}
