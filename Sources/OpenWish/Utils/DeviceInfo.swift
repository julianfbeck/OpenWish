import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Device facts attached to every report as `context.device` (dashboard and
/// MCP only; the SDK never shows them). No identifiers: model, OS, platform,
/// locale, time zone and preferred languages.
struct DeviceInfo: Equatable {
    var platform: String
    var model: String
    var os: String
    var locale: String
    var timeZone: String
    var preferredLanguages: [String]

    var contextFields: [String: OpenWishValue] {
        [
            "platform": .string(platform),
            "model": .string(model),
            "os": .string(os),
            "locale": .string(locale),
            "timeZone": .string(timeZone),
            "preferredLanguages": .array(preferredLanguages.map(OpenWishValue.string))
        ]
    }

    static var current: DeviceInfo {
        DeviceInfo(
            platform: platformName,
            model: modelIdentifier,
            os: ProcessInfo.processInfo.operatingSystemVersionString,
            locale: Locale.current.identifier,
            timeZone: TimeZone.current.identifier,
            preferredLanguages: Array(Locale.preferredLanguages.prefix(5))
        )
    }

    /// `x-wishkit-sdk-kind`: `macos` for Mac apps (native, Catalyst, or an
    /// iPhone/iPad app running on a Mac), `ios` otherwise. Backends before
    /// OpenWish 1.2 ignore unknown kinds and fall back to the context.
    static var sdkKind: String {
        isMac ? "macos" : "ios"
    }

    static var isMac: Bool {
        #if os(macOS) || targetEnvironment(macCatalyst)
        return true
        #else
        return ProcessInfo.processInfo.isiOSAppOnMac
        #endif
    }

    static var platformName: String {
        #if os(macOS) || targetEnvironment(macCatalyst)
        return "macOS"
        #elseif os(visionOS)
        return "visionOS"
        #elseif os(iOS)
        if ProcessInfo.processInfo.isiOSAppOnMac { return "macOS" }
        return UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS"
        #else
        return "unknown"
        #endif
    }

    /// Hardware model identifier, e.g. "iPhone17,1" or "Mac15,6".
    static var modelIdentifier: String {
        #if targetEnvironment(simulator)
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return "\(simulated) (Simulator)"
        }
        #endif
        #if os(macOS) || targetEnvironment(macCatalyst)
        var size = 0
        sysctlbyname("hw.model", nil, &size, nil, 0)
        guard size > 0 else { return "unknown" }
        var buffer = [CChar](repeating: 0, count: size)
        sysctlbyname("hw.model", &buffer, &size, nil, 0)
        return String(cString: buffer)
        #else
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafeBytes(of: &systemInfo.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return machine.isEmpty ? "unknown" : machine
        #endif
    }
}
