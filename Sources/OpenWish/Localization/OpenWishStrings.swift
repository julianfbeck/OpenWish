import Foundation

/// SDK UI strings from the package's `Localizable.xcstrings` (generated from
/// `localization/strings.json`, 22 languages).
///
/// Lookup order for a key:
/// 1. the app's own `OpenWish` string table (`OpenWish.xcstrings` or
///    `OpenWish.strings` in the main bundle), so apps can override any SDK text
///    without forking;
/// 2. the package's catalog in the language the app itself is running in
///    (`Bundle.main.preferredLocalizations`), so the SDK never shows a
///    language the app does not support;
/// 3. the English text passed in.
///
/// Strings that `OpenWish.config.localization` exposes keep their override
/// there; this type only supplies their defaults.
enum OpenWishStrings {

    static func text(_ key: String, _ english: String) -> String {
        let appOverride = Bundle.main.localizedString(forKey: key, value: missing, table: "OpenWish")
        if appOverride != missing {
            return appOverride
        }
        return bundle.localizedString(forKey: key, value: english, table: nil)
    }

    static func text(_ key: String, _ english: String, _ count: Int) -> String {
        String(format: text(key, english), locale: Locale.current, count)
    }

    private static let missing = "\u{1}openwish-missing\u{1}"

    /// The package catalog's `.lproj` matching the app's current language.
    static let bundle: Bundle = localizedBundle(for: Bundle.main.preferredLocalizations)

    static func localizedBundle(for languages: [String]) -> Bundle {
        let module = Bundle.module
        for language in languages {
            for candidate in candidates(for: language) {
                if let path = module.path(forResource: candidate, ofType: "lproj"), let bundle = Bundle(path: path) {
                    return bundle
                }
            }
        }
        return module
    }

    /// "pt-PT" → ["pt-PT"], "de-AT" → ["de-AT", "de"], "zh-Hant-HK" → ["zh-Hant-HK", "zh-Hant", "zh"].
    private static func candidates(for language: String) -> [String] {
        var parts = language.replacingOccurrences(of: "_", with: "-").split(separator: "-").map(String.init)
        var result: [String] = []
        while !parts.isEmpty {
            result.append(parts.joined(separator: "-"))
            parts.removeLast()
        }
        return result
    }
}
