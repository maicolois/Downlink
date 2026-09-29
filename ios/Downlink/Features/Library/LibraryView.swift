import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if coordinator.downloads.isEmpty {
                    ContentUnavailableView(
                        "Sin descargas",
                        systemImage: "arrow.down.circle",
                        description: Text("Los archivos terminados aparecerán aquí y en la app Archivos.")
                    )
                } else {
                    List {
                        ForEach(coordinator.downloads) { download in
                            HStack(spacing: 12) {
                                Image(systemName: download.url.pathExtension.lowercased() == "mp3" ? "waveform" : "film")
                                    .font(.title3)
                                    .foregroundStyle(DownlinkTheme.accent)
                                    .frame(width: 32)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(download.name).font(.subheadline.weight(.medium)).lineLimit(2)
                                    Text("\(download.formattedSize) · \(download.createdAt.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                ShareLink(item: download.url) {
                                    Image(systemName: "square.and.arrow.up")
                                }
                            }
                            .swipeActions {
                                Button(role: .destructive) { coordinator.delete(download) } label: {
                                    Label("Eliminar", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Descargas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Cerrar") { dismiss() }
                }
            }
            .onAppear { coordinator.refreshLibrary() }
        }
    }
}

