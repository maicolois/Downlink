import Foundation
import SwiftFFmpeg

private struct FFmpegRequest: Decodable {
    let tool: String
    let args: [String]
}

private struct FFmpegResponse: Encodable {
    let ok: Bool
    let executed: Bool
    let exitCode: Int
    let stdout: String
    let stderr: String
    let error: String?

    enum CodingKeys: String, CodingKey {
        case ok, executed, stdout, stderr, error
        case exitCode = "exit_code"
    }
}

enum FFmpegBridgeControl {
    private static let lock = NSLock()
    private static var cancellationRequested = false

    static func beginOperation() {
        lock.lock()
        cancellationRequested = false
        lock.unlock()
    }

    static func cancel() {
        lock.lock()
        cancellationRequested = true
        SwiftFFmpeg.requestCancel()
        lock.unlock()
    }

    static var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancellationRequested
    }
}

@_cdecl("downlink_ffmpeg_bridge_run")
func downlinkFFmpegBridgeRun(_ json: UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>? {
    guard let json else {
        return makeFFmpegCString(.init(ok: false, executed: false, exitCode: 1, stdout: "", stderr: "", error: "missing payload"))
    }

    do {
        let request = try JSONDecoder().decode(FFmpegRequest.self, from: Data(bytes: json, count: strlen(json)))
        guard !FFmpegBridgeControl.isCancelled else {
            return makeFFmpegCString(.init(ok: false, executed: false, exitCode: 130, stdout: "", stderr: "", error: "cancel requested"))
        }

        let tool: FFmpegTool
        switch request.tool {
        case "ffmpeg": tool = .ffmpeg
        case "ffprobe": tool = .ffprobe
        default:
            return makeFFmpegCString(.init(ok: false, executed: false, exitCode: 1, stdout: "", stderr: "", error: "unsupported tool"))
        }

        do {
            let result = try SwiftFFmpeg.executeDetailed(request.args, tool: tool)
            return makeFFmpegCString(.init(
                ok: result.exitCode == 0,
                executed: true,
                exitCode: Int(result.exitCode),
                stdout: result.stdout,
                stderr: result.stderr,
                error: result.exitCode == 0 ? nil : "FFmpeg terminó con código \(result.exitCode)"
            ))
        } catch {
            if let swiftError = error as? SwiftFFmpegError,
               case let .executionFailed(code, output, errorOutput) = swiftError {
                return makeFFmpegCString(.init(
                    ok: false,
                    executed: true,
                    exitCode: Int(code),
                    stdout: output,
                    stderr: errorOutput,
                    error: String(describing: error)
                ))
            }
            return makeFFmpegCString(.init(ok: false, executed: false, exitCode: 1, stdout: "", stderr: "", error: String(describing: error)))
        }
    } catch {
        return makeFFmpegCString(.init(ok: false, executed: false, exitCode: 1, stdout: "", stderr: "", error: "invalid payload: \(error)"))
    }
}

@_cdecl("downlink_ffmpeg_bridge_free")
func downlinkFFmpegBridgeFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}

private var ffmpegRunAnchor: ((UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?)?
private var ffmpegFreeAnchor: ((UnsafeMutablePointer<CChar>?) -> Void)?

func retainFFmpegBridgeExports() {
    ffmpegRunAnchor = downlinkFFmpegBridgeRun
    ffmpegFreeAnchor = downlinkFFmpegBridgeFree
}

private func makeFFmpegCString(_ response: FFmpegResponse) -> UnsafeMutablePointer<CChar>? {
    guard let data = try? JSONEncoder().encode(response),
          let value = String(data: data, encoding: .utf8) else {
        return strdup("{\"ok\":false,\"executed\":false,\"exit_code\":1,\"stdout\":\"\",\"stderr\":\"\",\"error\":\"encoding failed\"}")
    }
    return strdup(value)
}

