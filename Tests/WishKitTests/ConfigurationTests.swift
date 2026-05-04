import XCTest

@testable import WishKit

final class ConfigurationTests: XCTestCase {

    override func tearDown() {
        WishKit.configure(with: "test-api-key", apiUrl: nil)
        super.tearDown()
    }

    func testExplicitApiUrlOverrideWins() {
        WishKit.configure(with: "test-api-key", apiUrl: "https://openwish.example.com/api")

        XCTAssertEqual(ProjectSettings.apiUrl, "https://openwish.example.com/api")
    }
}
