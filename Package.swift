// swift-tools-version:5.6
import PackageDescription

let package = Package(
    name: "openwish",
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
        .target(name: "OpenWish", dependencies: [
            .product(name: "WishKitShared", package: "wishkit-ios-shared")
        ]),
        .testTarget(name: "OpenWishTests", dependencies: [.target(name: "OpenWish")]),
    ]
)
