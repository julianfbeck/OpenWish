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

    func testAutomaticV2NegotiationKeepsHostedWishKitOnV1() {
        OpenWish.configure(with: "test-api-key", apiUrl: nil, apiVersion: .automatic)
        XCTAssertFalse(ProjectSettings.shouldTryV2)

        OpenWish.configure(
            with: "test-api-key",
            apiUrl: "https://openwish.example.com/api",
            apiVersion: .automatic
        )
        XCTAssertTrue(ProjectSettings.shouldTryV2)
    }

    func testV2IssueContextMergesBuiltInAndAppMetrics() {
        OpenWish.configure(
            with: "test-api-key",
            issueContextProvider: {
                ["metrics": .object(["cardsScanned": .number(42)])]
            }
        )

        let context = OpenWish.issueContext()
        XCTAssertNotNil(context["sdk"])
        XCTAssertNotNil(context["app"])
        XCTAssertEqual(context["metrics"], .object(["cardsScanned": .number(42)]))
    }

    func testV2CardIssueEncodesStructuredPayload() throws {
        let request = CreateBugRequest(
            title: "Wrong card",
            description: "Alternate art was selected.",
            kind: .cardData,
            context: ["scans": .number(12)],
            card: OpenWishCard(id: "OP01-001", name: "Zoro")
        )
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]

        XCTAssertEqual(object?["kind"] as? String, "cardData")
        XCTAssertEqual((object?["card"] as? [String: Any])?["id"] as? String, "OP01-001")
        XCTAssertEqual(object?["scans"] as? Double, nil)
        XCTAssertEqual((object?["context"] as? [String: Any])?["scans"] as? Double, 12)
    }
}
