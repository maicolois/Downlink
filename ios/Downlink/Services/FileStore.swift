import Foundation

enum FileStore {
    static var downloadsDirectory: URL {
        get throws {
            let documents = try FileManager.default.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let directory = documents.appendingPathComponent("Downloads", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = directory
            try? mutable.setResourceValues(values)
            return directory
        }
    }

    static func makeWorkDirectory() throws -> URL {
        let caches = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = caches
            .appendingPathComponent("DownloadJobs", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func persist(_ temporaryURL: URL) throws -> URL {
        let directory = try downloadsDirectory
        let manager = FileManager.default
        let stem = temporaryURL.deletingPathExtension().lastPathComponent
        let ext = temporaryURL.pathExtension
        var destination = directory.appendingPathComponent(temporaryURL.lastPathComponent)
        var copy = 2
        while manager.fileExists(atPath: destination.path) {
            destination = directory.appendingPathComponent("\(stem) (\(copy)).\(ext)")
            copy += 1
        }
        try manager.moveItem(at: temporaryURL, to: destination)
        return destination
    }

    static func listDownloads() -> [SavedDownload] {
        guard let directory = try? downloadsDirectory,
              let urls = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.creationDateKey, .fileSizeKey, .isRegularFileKey],
                options: [.skipsHiddenFiles]
              ) else { return [] }

        return urls.compactMap { url in
            guard let values = try? url.resourceValues(forKeys: [.creationDateKey, .fileSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true else { return nil }
            return SavedDownload(
                url: url,
                createdAt: values.creationDate ?? .distantPast,
                size: Int64(values.fileSize ?? 0)
            )
        }
        .sorted { $0.createdAt > $1.createdAt }
    }
}

