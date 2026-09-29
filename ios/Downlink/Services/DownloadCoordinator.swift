import Foundation
import UIKit

@MainActor
final class DownloadCoordinator: ObservableObject {
    @Published var input = ""
    @Published private(set) var mediaInfo: MediaInfo?
    @Published var selectedIndex = 0
    @Published var selectedFormat: DownloadFormat = .mp4
    @Published var selectedQuality = "best"
    @Published private(set) var isAnalyzing = false
    @Published private(set) var isDownloading = false
    @Published private(set) var progress: EngineProgress?
    @Published private(set) var savedURL: URL?
    @Published private(set) var downloads: [SavedDownload] = []
    @Published var errorMessage: String?
    @Published var showsInstagramLogin = false
    @Published var showsLibrary = false

    let instagramSession = InstagramSessionStore.shared

    private var progressTask: Task<Void, Never>?
    private var cancellationURL: URL?
    private var workDirectory: URL?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    init() {
        refreshLibrary()
    }

    var selectedItem: MediaItem? {
        guard let mediaInfo, mediaInfo.videos.indices.contains(selectedIndex) else { return nil }
        return mediaInfo.videos[selectedIndex]
    }

    var qualityOptions: [VideoQuality] {
        guard let mediaInfo, let selectedItem else { return [] }
        if selectedFormat == .mp4 { return selectedItem.videoFormats }
        return mediaInfo.audioQualities.map {
            VideoQuality(value: $0.value, label: $0.label, detail: $0.detail)
        }
    }

    func analyze() async {
        guard !isAnalyzing && !isDownloading else { return }
        guard let url = URLInput.normalized(from: input) else {
            errorMessage = "Pega un enlace válido de YouTube, X, Instagram, TikTok, Reddit o Twitch."
            return
        }

        input = url.absoluteString
        errorMessage = nil
        savedURL = nil
        isAnalyzing = true
        defer { isAnalyzing = false }

        do {
            let cookies = URLInput.platformName(for: url) == "Instagram" ? instagramSession.cookieText : nil
            let info = try await PythonEngine.shared.inspect(url: url, cookieText: cookies)
            guard !info.videos.isEmpty else {
                throw PythonEngineError.engine("No hay vídeos accesibles en este enlace.")
            }
            mediaInfo = info
            selectedIndex = 0
            selectedFormat = .mp4
            selectedQuality = info.videos[0].videoFormats.first?.value ?? "best"
        } catch {
            mediaInfo = nil
            errorMessage = friendlyMessage(for: error)
        }
    }

    func select(format: DownloadFormat) {
        guard !isDownloading else { return }
        if format == .mp3, selectedItem?.hasAudio == false {
            errorMessage = "Este elemento no contiene una pista de audio."
            return
        }
        selectedFormat = format
        selectedQuality = qualityOptions.first?.value ?? (format == .mp4 ? "best" : "320")
        savedURL = nil
        errorMessage = nil
    }

    func selectItem(_ index: Int) {
        guard let mediaInfo, mediaInfo.videos.indices.contains(index), !isDownloading else { return }
        selectedIndex = index
        if selectedFormat == .mp3, mediaInfo.videos[index].hasAudio == false {
            selectedFormat = .mp4
            errorMessage = "Este elemento no contiene una pista de audio; se ha seleccionado MP4."
        } else {
            errorMessage = nil
        }
        selectedQuality = qualityOptions.first?.value ?? (selectedFormat == .mp4 ? "best" : "320")
        savedURL = nil
    }

    func download() async {
        guard !isDownloading,
              let info = mediaInfo,
              let item = selectedItem,
              let sourceURL = URL(string: info.url) else { return }

        errorMessage = nil
        savedURL = nil
        progress = .starting
        isDownloading = true
        FFmpegBridgeControl.beginOperation()

        do {
            let directory = try FileStore.makeWorkDirectory()
            let progressURL = directory.appendingPathComponent("progress.json")
            let cancelURL = directory.appendingPathComponent("cancel")
            workDirectory = directory
            cancellationURL = cancelURL
            startProgressPolling(at: progressURL)
            beginBackgroundTime()

            let request = DownloadRequest(
                url: sourceURL.absoluteString,
                format: selectedFormat,
                quality: selectedQuality,
                playlistItem: item.playlistItem,
                videoID: item.id,
                outputDirectory: directory.path,
                cookieText: URLInput.platformName(for: sourceURL) == "Instagram"
                    ? (instagramSession.cookieText ?? "") : ""
            )

            let temporaryURL = try await PythonEngine.shared.download(
                request: request,
                progressURL: progressURL,
                cancellationURL: cancelURL
            )
            let permanentURL = try FileStore.persist(temporaryURL)
            savedURL = permanentURL
            progress = EngineProgress(stage: .finished, fraction: 1, detail: "Listo · \(fileSize(for: permanentURL))")
            refreshLibrary()
            try? FileManager.default.removeItem(at: directory)
        } catch {
            if progress?.stage != .cancelled {
                errorMessage = friendlyMessage(for: error)
                progress = nil
            }
            if let workDirectory { try? FileManager.default.removeItem(at: workDirectory) }
        }

        progressTask?.cancel()
        progressTask = nil
        cancellationURL = nil
        workDirectory = nil
        isDownloading = false
        endBackgroundTime()
    }

    func cancelDownload() {
        guard isDownloading, let cancellationURL else { return }
        try? Data().write(to: cancellationURL, options: .atomic)
        FFmpegBridgeControl.cancel()
        progress = EngineProgress(stage: .cancelled, fraction: 0, detail: "Descarga cancelada")
    }

    func reset() {
        guard !isDownloading else { return }
        mediaInfo = nil
        selectedIndex = 0
        selectedFormat = .mp4
        selectedQuality = "best"
        progress = nil
        savedURL = nil
        errorMessage = nil
    }

    func clearInput() {
        input = ""
        reset()
    }

    func receive(url: URL) {
        guard url.scheme == "downlink",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let value = components.queryItems?.first(where: { $0.name == "url" })?.value else { return }
        input = value
        Task { await analyze() }
    }

    func refreshLibrary() {
        downloads = FileStore.listDownloads()
    }

    func delete(_ download: SavedDownload) {
        try? FileManager.default.removeItem(at: download.url)
        refreshLibrary()
    }

    private func startProgressPolling(at url: URL) {
        progressTask?.cancel()
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                if let data = try? Data(contentsOf: url),
                   let update = try? JSONDecoder().decode(EngineProgress.self, from: data) {
                    self?.progress = update
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
    }

    private func beginBackgroundTime() {
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "DOWNLINK download") { [weak self] in
            Task { @MainActor in self?.cancelDownload() }
        }
    }

    private func endBackgroundTime() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func fileSize(for url: URL) -> String {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
        return ByteCountFormatter.string(fromByteCount: size, countStyle: .file)
    }

    private func friendlyMessage(for error: Error) -> String {
        let raw = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        if raw.localizedCaseInsensitiveContains("cancel") { return "Descarga cancelada" }
        return raw
    }
}
