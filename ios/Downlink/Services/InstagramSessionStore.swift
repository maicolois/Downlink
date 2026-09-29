import Foundation
import WebKit

@MainActor
final class InstagramSessionStore: ObservableObject {
    static let shared = InstagramSessionStore()

    @Published private(set) var isConnected = false
    @Published private(set) var expiresAt: Date?

    private let keychainAccount = "instagram-session-v1"
    private var payload: Payload?

    private struct Payload: Codable {
        let cookieText: String
        let expiresAt: Date
    }

    private init() {
        restore()
    }

    var cookieText: String? {
        guard let payload, payload.expiresAt > Date() else {
            if payload != nil { disconnect() }
            return nil
        }
        return payload.cookieText
    }

    func connect(cookies: [HTTPCookie]) throws {
        let instagramCookies = cookies.filter { cookie in
            let domain = cookie.domain.lowercased()
            return domain == "instagram.com" || domain.hasSuffix(".instagram.com")
        }
        guard instagramCookies.contains(where: { $0.name == "sessionid" }) else {
            throw SessionError.missingSession
        }

        let expiration = Date().addingTimeInterval(8 * 60 * 60)
        let header = "# Netscape HTTP Cookie File\n# Generated locally by DOWNLINK for iOS\n"
        let rows = instagramCookies.map { cookie -> String in
            let includeSubdomains = cookie.domain.hasPrefix(".") ? "TRUE" : "FALSE"
            let secure = cookie.isSecure ? "TRUE" : "FALSE"
            let expires = Int(cookie.expiresDate?.timeIntervalSince1970 ?? expiration.timeIntervalSince1970)
            return [cookie.domain, includeSubdomains, cookie.path, secure, String(expires), cookie.name, cookie.value]
                .joined(separator: "\t")
        }
        let newPayload = Payload(cookieText: header + rows.joined(separator: "\n") + "\n", expiresAt: expiration)
        let data = try JSONEncoder().encode(newPayload)
        try KeychainStore.save(data, account: keychainAccount)
        payload = newPayload
        expiresAt = expiration
        isConnected = true
    }

    func disconnect() {
        KeychainStore.delete(account: keychainAccount)
        payload = nil
        expiresAt = nil
        isConnected = false
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
            for cookie in cookies where cookie.domain.lowercased().contains("instagram.com") {
                WKWebsiteDataStore.default().httpCookieStore.delete(cookie)
            }
        }
    }

    private func restore() {
        guard let data = KeychainStore.read(account: keychainAccount),
              let decoded = try? JSONDecoder().decode(Payload.self, from: data),
              decoded.expiresAt > Date() else {
            KeychainStore.delete(account: keychainAccount)
            return
        }
        payload = decoded
        expiresAt = decoded.expiresAt
        isConnected = true
    }

    enum SessionError: LocalizedError {
        case missingSession

        var errorDescription: String? {
            "No se encontró una sesión iniciada. Entra en Instagram antes de pulsar Guardar sesión."
        }
    }
}
