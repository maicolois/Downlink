import Foundation
import PythonKit

enum PythonEngineError: LocalizedError {
    case missingRuntime
    case invalidResponse
    case engine(String)

    var errorDescription: String? {
        switch self {
        case .missingRuntime:
            return "El motor local no está incluido. Ejecuta Scripts/bootstrap.sh y vuelve a compilar."
        case .invalidResponse:
            return "El motor local devolvió una respuesta no válida."
        case .engine(let message):
            return message
        }
    }
}

final class PythonEngine {
    static let shared = PythonEngine()

    private let executor = PythonExecutor()
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private init() {}

    func inspect(url: URL, cookieText: String?) async throws -> MediaInfo {
        let raw = try await executor.run {
            let module = try Self.loadModule()
            let function = try Self.member(module, named: "inspect_json")
            let result = try function.throwing.dynamicallyCall(
                withArguments: [url.absoluteString, cookieText ?? ""]
            )
            return String(result) ?? ""
        }

        guard let data = raw.data(using: .utf8) else { throw PythonEngineError.invalidResponse }
        do {
            return try decoder.decode(MediaInfo.self, from: data)
        } catch {
            if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = payload["error"] as? String {
                throw PythonEngineError.engine(message)
            }
            throw PythonEngineError.invalidResponse
        }
    }

    func download(
        request: DownloadRequest,
        progressURL: URL,
        cancellationURL: URL
    ) async throws -> URL {
        let requestData = try encoder.encode(request)
        guard let requestJSON = String(data: requestData, encoding: .utf8) else {
            throw PythonEngineError.invalidResponse
        }

        let raw = try await executor.run {
            let module = try Self.loadModule()
            let function = try Self.member(module, named: "download_json")
            let result = try function.throwing.dynamicallyCall(
                withArguments: [requestJSON, progressURL.path, cancellationURL.path]
            )
            return String(result) ?? ""
        }

        guard let data = raw.data(using: .utf8),
              let response = try? decoder.decode(EngineDownloadResult.self, from: data) else {
            throw PythonEngineError.invalidResponse
        }
        guard response.ok, let path = response.path else {
            throw PythonEngineError.engine(response.error ?? "No se pudo completar la descarga.")
        }
        return URL(fileURLWithPath: path)
    }

    private static func loadModule() throws -> PythonObject {
        guard Bundle.main.url(forResource: "Python", withExtension: nil) != nil else {
            throw PythonEngineError.missingRuntime
        }
        return try Python.attemptImport("downlink_engine")
    }

    private static func member(_ object: PythonObject, named name: String) throws -> PythonObject {
        guard let member = object.checking[dynamicMember: name] else {
            throw PythonEngineError.engine("Falta la función local \(name).")
        }
        return member
    }
}

private final class PythonExecutor: NSObject {
    private let ready = DispatchSemaphore(value: 0)
    private var thread: Thread!

    override init() {
        super.init()
        thread = Thread(target: self, selector: #selector(threadMain), object: nil)
        thread.name = "app.downlink.python"
        thread.qualityOfService = .userInitiated
        thread.stackSize = 8 * 1024 * 1024
        thread.start()
        ready.wait()
    }

    @objc private func threadMain() {
        autoreleasepool {
            // PythonKit initializes CPython on first access. Keep that initialization
            // and every later Python call on this dedicated thread.
            _ = Python.version
            let runLoop = RunLoop.current
            runLoop.add(Port(), forMode: .default)
            ready.signal()
            while !Thread.current.isCancelled {
                runLoop.run(mode: .default, before: .distantFuture)
            }
        }
    }

    @objc private func execute(_ item: PythonWorkItem) {
        item.execute()
    }

    func run<T>(_ work: @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            let item = PythonWorkItem {
                do { continuation.resume(returning: try work()) }
                catch { continuation.resume(throwing: error) }
            }
            perform(#selector(execute(_:)), on: thread, with: item, waitUntilDone: false)
        }
    }
}

private final class PythonWorkItem: NSObject {
    private let block: () -> Void

    init(_ block: @escaping () -> Void) {
        self.block = block
    }

    @objc func execute() { block() }
}
