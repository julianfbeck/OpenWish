import XCTest

@testable import OpenWish

final class ConfigurationTests: XCTestCase {

    override func tearDown() {
        OpenWish.configure(with: "test-api-key", apiUrl: nil)
        super.tearDown()
    }

    func testExplicitApiUrlOverrideWins() {
        OpenWish.configure(with: "test-api-key", apiUrl: "https://openwish.example.com/api")

        XCTAssertEqual(ProjectSettings.apiUrl, "https://openwish.example.com/api")
    }
}
