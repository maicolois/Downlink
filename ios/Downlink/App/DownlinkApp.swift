import SwiftUI

@main
struct DownlinkApp: App {
    @StateObject private var coordinator = DownloadCoordinator()

    init() {
        retainFFmpegBridgeExports()
        PythonRuntimeBootstrap.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(coordinator)
                .preferredColorScheme(.dark)
                .onOpenURL { coordinator.receive(url: $0) }
        }
    }
}

