import XCTest

@testable import OpenWish

final class LocalizationAndContextTests: XCTestCase {

    override func tearDown() {
        OpenWish.configure(with: "test-api-key", apiUrl: nil)
        super.tearDown()
    }

    // The package must ship its string catalog: a missing resource bundle or a
    // language dropped from the build would silently fall back to English.
    func testPackageShipsEveryAppLanguage() {
        let expected = ["en", "ar", "ca", "de", "es", "fr", "hi", "id", "it", "ja", "ko", "nl", "pl",
                        "pt", "pt-BR", "pt-PT", "ru", "th", "tr", "vi", "zh-Hans", "zh-Hant", "zu"]
        let shipped = Set(Bundle.module.localizations)
        XCTAssertEqual(Set(expected).subtracting(shipped), [], "languages missing from the package bundle")

        for language in expected where language != "en" {
            let bundle = OpenWishStrings.localizedBundle(for: [language])
            let text = bundle.localizedString(forKey: "bug.sendBug", value: "<missing>", table: nil)
            XCTAssertNotEqual(text, "<missing>", language)
            XCTAssertNotEqual(text, "Send bug report", "\(language) is not translated")
        }
    }

    func testLanguageMatchingFollowsTheAppLanguageWithRegionFallback() {
        let german = OpenWishStrings.localizedBundle(for: ["de-AT"])
        XCTAssertEqual(german.localizedString(forKey: "bug.kindBug", value: nil, table: nil),
                       OpenWishStrings.localizedBundle(for: ["de"]).localizedString(forKey: "bug.kindBug", value: nil, table: nil))
        let traditional = OpenWishStrings.localizedBundle(for: ["zh-Hant-TW"])
        XCTAssertTrue(traditional.bundlePath.hasSuffix("zh-Hant.lproj"), traditional.bundlePath)
        // An app language the package does not know falls through to the next
        // preferred language, then to English.
        XCTAssertTrue(OpenWishStrings.localizedBundle(for: ["xx", "fr"]).bundlePath.hasSuffix("fr.lproj"))
        let fallback = OpenWishStrings.localizedBundle(for: ["xx"])
        XCTAssertEqual(fallback.localizedString(forKey: "bug.sendBug", value: "Send bug report", table: nil), "Send bug report")
    }

    func testFormattedStringsKeepTheirCount() {
        let german = OpenWishStrings.localizedBundle(for: ["de"])
        let format = german.localizedString(forKey: "reports.adminRepliedCount", value: nil, table: nil)
        XCTAssertTrue(String(format: format, 3).contains("3"), format)
    }

    func testCardSwitchNeedsACardSearchProvider() {
        OpenWish.configure(with: "test-api-key")
        XCTAssertFalse(OpenWish.showsIssueKindPicker)

        OpenWish.configure(with: "test-api-key", cardSearchProvider: { _ in [] })
        XCTAssertTrue(OpenWish.showsIssueKindPicker)
    }

    func testReportsCarryDeviceContext() {
        let context = OpenWish.issueContext()
        guard case .object(let device)? = context["device"] else {
            return XCTFail("device context missing")
        }
        for key in ["platform", "model", "os", "locale", "timeZone", "preferredLanguages"] {
            XCTAssertNotNil(device[key], key)
        }
        XCTAssertEqual(device["timeZone"], .string(TimeZone.current.identifier))
        guard case .array(let languages)? = device["preferredLanguages"] else {
            return XCTFail("preferredLanguages is not an array")
        }
        XCTAssertLessThanOrEqual(languages.count, 5)
        XCTAssertEqual(context["sdk"], .object(["name": .string("OpenWish"), "version": .string(ProjectSettings.sdkVersion)]))
    }

    #if os(macOS)
    func testMacReportsIdentifyAsMacOS() {
        XCTAssertEqual(DeviceInfo.sdkKind, "macos")
        XCTAssertEqual(DeviceInfo.current.platform, "macOS")
        XCTAssertNotEqual(DeviceInfo.modelIdentifier, "unknown")
    }
    #endif
}
