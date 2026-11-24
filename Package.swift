// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "openwish",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v12),
        .iOS(.v14)
    ],
    products: [
        .library(name: "OpenWish", targets: ["OpenWish"])
    ],
    dependencies: [
        .package(url: "https://github.com/wishkit/wishkit-ios-shared.git", exact: "1.5.0")
    ],
    targets: [
        .target(
            name: "OpenWish",
            dependencies: [
                .product(name: "WishKitShared", package: "wishkit-ios-shared")
            ],
            resources: [.process("Resources")]
        ),
        .testTarget(name: "OpenWishTests", dependencies: [.target(name: "OpenWish")]),
    ]
)
