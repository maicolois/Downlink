import Foundation

enum PythonRuntimeBootstrap {
    static func configure() {
        let bundle = Bundle.main
        let pythonRoot = bundle.bundleURL.appendingPathComponent("python", isDirectory: true)
        let libRoot = pythonRoot.appendingPathComponent("lib", isDirectory: true)
        let packages = bundle.bundleURL.appendingPathComponent("python-packages", isDirectory: true)
        let scripts = bundle.bundleURL.appendingPathComponent("Python", isDirectory: true)

        guard let versionDirectory = try? FileManager.default.contentsOfDirectory(atPath: libRoot.path)
            .first(where: { $0.hasPrefix("python3.") }) else {
            return
        }

        let standardLibrary = libRoot.appendingPathComponent(versionDirectory, isDirectory: true)
        let dynamicLibraries = standardLibrary.appendingPathComponent("lib-dynload", isDirectory: true)
        let pythonPath = [packages.path, scripts.path, standardLibrary.path, dynamicLibraries.path]
            .joined(separator: ":")

        setenv("PYTHONHOME", pythonRoot.path, 1)
        setenv("PYTHONPATH", pythonPath, 1)
        setenv("PYTHONUTF8", "1", 1)
        setenv("PYTHONUNBUFFERED", "1", 1)
        setenv("PYTHONDONTWRITEBYTECODE", "1", 1)
        setenv("DOWNLINK_EXECUTABLE_PATH", bundle.executableURL?.path ?? "", 1)
        setenv("SSL_CERT_FILE", packages.appendingPathComponent("certifi/cacert.pem").path, 1)
        setenv("REQUESTS_CA_BUNDLE", packages.appendingPathComponent("certifi/cacert.pem").path, 1)
    }
}
