import XCTest
@testable import Downlink

final class URLInputTests: XCTestCase {
    func testNormalizesInstagramHandle() {
        XCTAssertEqual(
            URLInput.normalized(from: "@downlink.test")?.absoluteString,
            "https://www.instagram.com/stories/downlink.test/"
        )
    }

    func testExtractsURLFromSharedText() {
        XCTAssertEqual(
            URLInput.normalized(from: "Mira esto https://youtu.be/abc123, gracias")?.absoluteString,
            "https://youtu.be/abc123"
        )
    }

    func testAddsHTTPSWhenTheSharedLinkOmitsItsScheme() {
        XCTAssertEqual(
            URLInput.normalized(from: "instagram.com/downlink.test/reels/ABC-123/")?.absoluteString,
            "https://instagram.com/downlink.test/reels/ABC-123/"
        )
    }

    func testRejectsUnsupportedAndCredentialedURLs() {
        XCTAssertNil(URLInput.normalized(from: "https://example.com/video"))
        XCTAssertNil(URLInput.normalized(from: "https://user:secret@youtube.com/watch?v=abc"))
    }

    func testConvertsInstagramProfileToStories() {
        XCTAssertEqual(
            URLInput.normalized(from: "https://www.instagram.com/downlink.test/")?.absoluteString,
            "https://www.instagram.com/stories/downlink.test/"
        )
    }
}
