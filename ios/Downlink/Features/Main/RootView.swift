import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator

    private var thumbnailURL: URL? {
        coordinator.selectedItem.flatMap { URL(string: $0.thumbnail) }
    }

    var body: some View {
        ZStack {
            if coordinator.mediaInfo == nil {
                AnimatedBackground()
            } else {
                ThumbnailBackground(url: thumbnailURL)
            }

            ScrollView {
                VStack(spacing: 0) {
                    HeaderView(compact: coordinator.mediaInfo != nil)
                    LinkInputView()

                    if coordinator.mediaInfo == nil {
                        HomeIntroView()
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    } else {
                        ResultsView()
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }

                    DownlinkFooter()
                }
                .frame(maxWidth: coordinator.mediaInfo == nil ? 852 : 1040)
                .padding(.horizontal, coordinator.mediaInfo == nil ? 16 : 14)
                .padding(.top, coordinator.mediaInfo == nil ? 20 : 12)
                .padding(.bottom, 20)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .animation(.spring(response: 0.55, dampingFraction: 0.88), value: coordinator.mediaInfo != nil)
        .overlay(alignment: .topTrailing) {
            OptionsMenu()
                .padding(.top, 10)
                .padding(.trailing, 10)
        }
        .sheet(isPresented: $coordinator.showsInstagramLogin) {
            InstagramLoginView(session: coordinator.instagramSession)
        }
        .sheet(isPresented: $coordinator.showsLibrary) {
            LibraryView()
                .environmentObject(coordinator)
        }
        .tint(DownlinkTheme.accent)
    }
}

private struct HeaderView: View {
    let compact: Bool

    var body: some View {
        VStack(spacing: compact ? 0 : 8) {
            DownlinkLogo(compact: compact)
            if !compact {
                Text("Convierte tus vídeos a MP4 & MP3")
                    .font(.system(size: 17))
                    .foregroundStyle(Color(red: 161 / 255, green: 161 / 255, blue: 166 / 255))
                    .tracking(-0.25)
                PlatformStrip()
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, compact ? 12 : 14)
    }
}

private struct PlatformStrip: View {
    private let platforms: [(String, String)] = [
        ("YouTube", "play.rectangle.fill"),
        ("X", "xmark"),
        ("Instagram", "camera"),
        ("TikTok", "music.note"),
        ("Reddit", "bubble.left.and.bubble.right"),
        ("Twitch", "message.fill"),
    ]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 13) {
                Text("Compatible con")
                marks(showNames: true)
            }
            HStack(spacing: 18) { marks(showNames: false) }
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Color(red: 181 / 255, green: 181 / 255, blue: 187 / 255))
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func marks(showNames: Bool) -> some View {
        ForEach(platforms, id: \.0) { name, symbol in
            HStack(spacing: 5) {
                Image(systemName: symbol).frame(width: 17, height: 17)
                if showNames { Text(name) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(name)
        }
    }
}

private struct OptionsMenu: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator
    @ObservedObject private var session = InstagramSessionStore.shared

    var body: some View {
        Menu {
            Button {
                coordinator.showsInstagramLogin = true
            } label: {
                Label(session.isConnected ? "Renovar Instagram" : "Conectar Instagram", systemImage: "camera")
            }

            if session.isConnected {
                Button(role: .destructive) { session.disconnect() } label: {
                    Label("Desconectar Instagram", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }

            Divider()

            Button {
                coordinator.refreshLibrary()
                coordinator.showsLibrary = true
            } label: {
                Label("Descargas", systemImage: "arrow.down.circle")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white.opacity(0.82))
                .frame(width: 42, height: 42)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(.white.opacity(0.13), lineWidth: 0.75))
        }
        .accessibilityLabel("Opciones")
    }
}

struct DownlinkFooter: View {
    var body: some View {
        VStack(spacing: 5) {
            Text("Descarga responsable · Contenido propio o autorizado")
            HStack(spacing: 0) {
                Text("Hecho con cuidado para ")
                Text("DOWNLINK").foregroundStyle(DownlinkTheme.success)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(DownlinkTheme.mutedText)
        .multilineTextAlignment(.center)
        .padding(.top, 18)
    }
}

