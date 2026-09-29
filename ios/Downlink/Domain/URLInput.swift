import Foundation

enum URLInput {
    private static let supportedHosts = [
        "youtube.com", "youtu.be", "x.com", "twitter.com", "instagram.com",
        "tiktok.com", "reddit.com", "redditmedia.com", "redd.it", "twitch.tv"
    ]

    static func normalized(from input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.range(of: #"^@[A-Za-z0-9._]{1,30}$"#, options: .regularExpression) != nil {
            return URL(string: "https://www.instagram.com/stories/\(trimmed.dropFirst())/")
        }

        var candidate: String
        if let range = trimmed.range(of: #"https?://[^\s<>\"\u{0000}-\u{001F}]+"#, options: [.regularExpression, .caseInsensitive]) {
            candidate = String(trimmed[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,)] ;"))
        } else {
            candidate = trimmed
        }

        if candidate.range(of: #"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:/|$)"#, options: .regularExpression) != nil {
            candidate = "https://\(candidate)"
        }

        guard var components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host?.lowercased(),
              supportedHosts.contains(where: { host == $0 || host.hasSuffix(".\($0)") }),
              components.user == nil,
              components.password == nil else {
            return nil
        }

        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if (host == "instagram.com" || host.hasSuffix(".instagram.com")),
           path.range(of: #"^[A-Za-z0-9._]{1,30}$"#, options: .regularExpression) != nil,
           !["explore", "accounts", "direct", "p", "reel", "reels", "stories", "tv", "share", "about", "privacy"].contains(path.lowercased()) {
            components.path = "/stories/\(path)/"
            components.query = nil
            components.fragment = nil
        }

        return components.url
    }

    static func platformName(for url: URL) -> String {
        let host = url.host?.lowercased().replacingOccurrences(of: "www.", with: "") ?? ""
        if host == "youtu.be" || host == "youtube.com" || host.hasSuffix(".youtube.com") { return "YouTube" }
        if host == "instagram.com" || host.hasSuffix(".instagram.com") { return "Instagram" }
        if host == "tiktok.com" || host.hasSuffix(".tiktok.com") { return "TikTok" }
        if host == "x.com" || host == "twitter.com" || host.hasSuffix(".x.com") || host.hasSuffix(".twitter.com") { return "X" }
        if host == "reddit.com" || host == "redditmedia.com" || host == "redd.it" || host.hasSuffix(".reddit.com") || host.hasSuffix(".redditmedia.com") { return "Reddit" }
        if host == "twitch.tv" || host.hasSuffix(".twitch.tv") { return "Twitch" }
        return host
    }
}
