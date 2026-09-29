import SwiftUI
import UIKit

struct LinkInputView: View {
    @EnvironmentObject private var coordinator: DownloadCoordinator
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color(red: 134 / 255, green: 134 / 255, blue: 141 / 255))

                TextField("Pega un enlace de vídeo", text: $coordinator.input)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .focused($isFocused)
                    .disabled(coordinator.isAnalyzing || coordinator.isDownloading)
                    .onSubmit { Task { await coordinator.analyze() } }

                if coordinator.input.isEmpty {
                    Button {
                        if let value = UIPasteboard.general.string {
                            coordinator.input = value
                            Task { await coordinator.analyze() }
                        }
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Pegar")
                } else {
                    Button { coordinator.clearInput() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Borrar enlace")
                }
            }
            .font(.system(size: 16))
            .foregroundStyle(.white)
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .frame(minHeight: 52)
            .background(Color.white.opacity(0.012), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(isFocused ? 0.40 : 0.28), lineWidth: 0.75))
            .shadow(color: .black.opacity(0.16), radius: 18, y: 8)

            if coordinator.isAnalyzing {
                HStack(spacing: 9) {
                    ProgressView().controlSize(.small).tint(DownlinkTheme.accent)
                    Text(coordinator.input.contains("/stories/") ? "Buscando stories…" : "Analizando enlace…")
                }
                .font(.system(size: 14))
                .foregroundStyle(DownlinkTheme.secondaryText)
                .padding(.top, 13)
            } else if let error = coordinator.errorMessage {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(red: 1, green: 125 / 255, blue: 118 / 255).opacity(0.92))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)
                    .padding(.top, 11)
            } else if coordinator.mediaInfo == nil {
                Text("También puedes escribir @usuario para descargar stories de Instagram")
                    .font(.system(size: 12))
                    .foregroundStyle(Color(red: 142 / 255, green: 142 / 255, blue: 150 / 255))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: 820)
        .padding(.vertical, coordinator.mediaInfo == nil ? 8 : 0)
        .padding(.bottom, coordinator.mediaInfo == nil ? 18 : 14)
    }
}

