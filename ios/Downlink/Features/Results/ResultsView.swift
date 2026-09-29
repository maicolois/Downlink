import SwiftUI

struct ResultsView: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                HStack(alignment: .top, spacing: 22) {
                    VideoSummaryCard().frame(maxWidth: .infinity)
                    DownloadOptionsCard().frame(maxWidth: .infinity)
                }
            } else {
                VStack(spacing: 14) {
                    VideoSummaryCard()
                    DownloadOptionsCard()
                }
            }
        }
        .frame(maxWidth: 1040)
    }
}

private struct VideoSummaryCard: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator

    var body: some View {
        if let item = coordinator.selectedItem {
            GeometryReader { proxy in
                HStack(spacing: 0) {
                    thumbnail(for: item)
                        .frame(width: proxy.size.width * 0.42)
                    info(for: item)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .frame(height: 132)
            .glassPanel(radius: 24)
        }
    }

    private func thumbnail(for item: MediaItem) -> some View {
        ZStack {
            Color.black.opacity(0.28)
            if let url = URL(string: item.thumbnail) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: Image(systemName: "film").font(.largeTitle).foregroundStyle(.white.opacity(0.3))
                    }
                }
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if !item.durationString.isEmpty && item.duration > 0 {
                Text(item.durationString)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(.white.opacity(0.28), lineWidth: 0.75))
                    .padding(7)
            }
        }
        .overlay(alignment: .bottom) {
            if let info = coordinator.mediaInfo, info.videos.count > 1 {
                HStack(spacing: 4) {
                    carouselButton(symbol: "chevron.left", enabled: coordinator.selectedIndex > 0) {
                        coordinator.selectItem(coordinator.selectedIndex - 1)
                    }
                    Text("\(coordinator.selectedIndex + 1)/\(info.videos.count)")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(minWidth: 40, minHeight: 28)
                        .background(.ultraThinMaterial, in: Capsule())
                    carouselButton(symbol: "chevron.right", enabled: coordinator.selectedIndex + 1 < info.videos.count) {
                        coordinator.selectItem(coordinator.selectedIndex + 1)
                    }
                }
                .padding(.bottom, 7)
            }
        }
        .clipped()
    }

    private func info(for item: MediaItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(3)
                .multilineTextAlignment(.leading)

            Label(item.channel, systemImage: "person.fill")
                .lineLimit(1)

            if let views = item.viewCount {
                Label(views.formatted(.number.notation(.compactName)), systemImage: "eye.fill")
            }

            if coordinator.mediaInfo?.isInstagramStory == true {
                Text("Story disponible mientras siga activa")
                    .font(.system(size: 10))
                    .foregroundStyle(DownlinkTheme.secondaryText)
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(DownlinkTheme.secondaryText)
        .padding(14)
    }

    private func carouselButton(symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .frame(width: 28, height: 28)
                .background(.ultraThinMaterial, in: Circle())
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }
}

private struct DownloadOptionsCard: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator

    private let columns = [GridItem(.adaptive(minimum: 76), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Opciones de descarga", systemImage: "slider.horizontal.3")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white.opacity(0.95))
                .padding(.bottom, 16)

            formatPicker
                .padding(.bottom, 18)

            Text("CALIDAD")
                .font(.system(size: 12, weight: .medium))
                .tracking(1.5)
                .foregroundStyle(DownlinkTheme.secondaryText)
                .padding(.leading, 4)
                .padding(.bottom, 10)

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(coordinator.qualityOptions) { option in
                    QualityButton(option: option, selected: coordinator.selectedQuality == option.value) {
                        guard !coordinator.isDownloading else { return }
                        coordinator.selectedQuality = option.value
                    }
                }
            }
            .padding(.bottom, 18)

            actionArea
        }
        .padding(18)
        .glassPanel(radius: 24)
    }

    private var formatPicker: some View {
        HStack(spacing: 0) {
            formatButton(.mp4, symbol: "film")
            formatButton(.mp3, symbol: "waveform")
        }
        .padding(6)
        .background(Color.black.opacity(0.3), in: Capsule())
    }

    private func formatButton(_ format: DownloadFormat, symbol: String) -> some View {
        Button {
            withAnimation(.spring(response: 0.38, dampingFraction: 0.88)) {
                coordinator.select(format: format)
            }
        } label: {
            Label(format.title, systemImage: symbol)
                .font(.system(size: 14, weight: coordinator.selectedFormat == format ? .semibold : .medium))
                .foregroundStyle(coordinator.selectedFormat == format ? .white : DownlinkTheme.secondaryText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background {
                    if coordinator.selectedFormat == format {
                        Capsule()
                            .fill(.white.opacity(0.15))
                            .shadow(color: .black.opacity(0.15), radius: 6, y: 4)
                            .matchedGeometryEffect(id: "format-selection", in: formatNamespace)
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(coordinator.isDownloading)
    }

    @Namespace private var formatNamespace

    @ViewBuilder
    private var actionArea: some View {
        if coordinator.isDownloading, let progress = coordinator.progress {
            VStack(spacing: 11) {
                HStack {
                    Text(progress.detail)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Spacer()
                    Text(progress.fraction, format: .percent.precision(.fractionLength(0)))
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(DownlinkTheme.secondaryText)
                }
                ProgressView(value: progress.fraction)
                    .tint(DownlinkTheme.accent)
                Button(role: .destructive) { coordinator.cancelDownload() } label: {
                    Text("Cancelar descarga").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .clipShape(Capsule())
            }
        } else if let savedURL = coordinator.savedURL {
            VStack(spacing: 10) {
                Label("Archivo guardado", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DownlinkTheme.success)
                ShareLink(item: savedURL) {
                    Label("Compartir \(coordinator.selectedFormat.title)", systemImage: "square.and.arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(.white, in: Capsule())
                }
            }
        } else {
            Button {
                Task { await coordinator.download() }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "arrow.down")
                    Text("Descargar \(coordinator.selectedFormat.title)")
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(.white, in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}

private struct QualityButton: View {
    let option: VideoQuality
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Text(option.label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text(option.detail)
                    .font(.system(size: 11))
                    .foregroundStyle(DownlinkTheme.secondaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(
                selected ? DownlinkTheme.accent.opacity(0.20) : Color.white.opacity(0.045),
                in: RoundedRectangle(cornerRadius: 15, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(selected ? DownlinkTheme.accent : Color.white.opacity(0.08), lineWidth: selected ? 1.2 : 0.75)
            }
            .shadow(color: selected ? DownlinkTheme.accent.opacity(0.15) : .clear, radius: 10, y: 4)
        }
        .buttonStyle(.plain)
    }
}

