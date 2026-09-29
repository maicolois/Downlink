import Foundation

enum DownloadFormat: String, Codable, CaseIterable, Identifiable {
    case mp4
    case mp3

    var id: String { rawValue }
    var title: String { rawValue.uppercased() }
}

struct VideoQuality: Codable, Hashable, Identifiable {
    let value: String
    let label: String
    let detail: String

    var id: String { value }
}

struct AudioQuality: Codable, Hashable, Identifiable {
    let value: String
    let label: String
    let detail: String

    var id: String { value }
}

struct MediaItem: Codable, Hashable, Identifiable {
    let id: String
    let playlistItem: Int
    let title: String
    let thumbnail: String
    let duration: Double
    let durationString: String
    let channel: String
    let viewCount: Int64?
    let isLive: Bool
    let hasAudio: Bool
    let videoFormats: [VideoQuality]
}

struct MediaInfo: Codable, Hashable {
    let url: String
    let platform: String
    let contentType: String?
    let videos: [MediaItem]
    let audioQualities: [AudioQuality]

    var first: MediaItem? { videos.first }
    var isInstagramStory: Bool { contentType == "instagram-story" }
}

struct DownloadRequest: Codable, Hashable {
    let url: String
    let format: DownloadFormat
    let quality: String
    let playlistItem: Int
    let videoID: String?
    let outputDirectory: String
    let cookieText: String
}

struct EngineDownloadResult: Codable {
    let ok: Bool
    let path: String?
    let error: String?
}

struct EngineProgress: Codable, Equatable {
    enum Stage: String, Codable {
        case starting
        case downloading
        case converting
        case finished
        case cancelled
        case failed
    }

    let stage: Stage
    let fraction: Double
    let detail: String

    static let starting = EngineProgress(
        stage: .starting,
        fraction: 0,
        detail: "Iniciando preparación…"
    )
}

struct SavedDownload: Identifiable, Hashable {
    let url: URL
    let createdAt: Date
    let size: Int64

    var id: URL { url }
    var name: String { url.lastPathComponent }
    var formattedSize: String { ByteCountFormatter.string(fromByteCount: size, countStyle: .file) }
}

