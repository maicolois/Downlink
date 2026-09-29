import SwiftUI

struct HomeIntroView: View {
    var body: some View {
        VStack(spacing: 0) {
            (Text("Un enlace. ").foregroundStyle(Color(red: 238 / 255, green: 238 / 255, blue: 240 / 255))
             + Text("Dos posibilidades.").foregroundStyle(Color(red: 134 / 255, green: 134 / 255, blue: 142 / 255)))
                .font(.system(size: 23, weight: .medium))
                .tracking(-0.7)
                .multilineTextAlignment(.center)
                .padding(.bottom, 14)

            HStack(spacing: 12) {
                FormatPreviewCard(
                    title: "Vídeo MP4",
                    detail: "Conserva imagen y sonido en la calidad que elijas.",
                    kind: .video
                )
                FormatPreviewCard(
                    title: "Audio MP3",
                    detail: "Extrae solo el audio y elige el bitrate final.",
                    kind: .audio
                )
            }

            HStack(spacing: 12) {
                StepBadge(number: 1, title: "Pega el enlace")
                StepBadge(number: 2, title: "Elige formato")
                StepBadge(number: 3, title: "Descarga")
            }
            .padding(.top, 16)
        }
        .frame(maxWidth: 852)
    }
}

private struct FormatPreviewCard: View {
    enum Kind { case video, audio }

    let title: String
    let detail: String
    let kind: Kind

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            preview
                .frame(maxWidth: .infinity)
                .frame(height: 57)

            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(red: 220 / 255, green: 220 / 255, blue: 225 / 255))
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Color(red: 146 / 255, green: 146 / 255, blue: 154 / 255))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(
                colors: [.white.opacity(0.035), .white.opacity(0.012)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.white.opacity(0.075), lineWidth: 1))
    }

    @ViewBuilder
    private var preview: some View {
        switch kind {
        case .video:
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(LinearGradient(colors: [Color(red: 72 / 255, green: 77 / 255, blue: 88 / 255), Color(red: 32 / 255, green: 35 / 255, blue: 41 / 255)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 217 / 255, green: 228 / 255, blue: 246 / 255).opacity(0.25)))
                    .frame(width: 86, height: 57)
                    .rotationEffect(.degrees(-7))
                    .overlay(Image(systemName: "play.fill").foregroundStyle(Color(red: 227 / 255, green: 230 / 255, blue: 237 / 255)))
                Text("MP4")
                    .font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 7).padding(.vertical, 4)
                    .background(Color(red: 40 / 255, green: 42 / 255, blue: 48 / 255), in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white.opacity(0.16)))
            }
        case .audio:
            HStack(alignment: .center, spacing: 4) {
                ForEach(Array([18, 34, 50, 28, 44, 22, 38].enumerated()), id: \.offset) { _, value in
                    Capsule()
                        .fill(LinearGradient(colors: [Color(red: 183 / 255, green: 196 / 255, blue: 216 / 255), Color(red: 101 / 255, green: 109 / 255, blue: 124 / 255)], startPoint: .top, endPoint: .bottom))
                        .frame(width: 4, height: CGFloat(value))
                }
            }
        }
    }
}

private struct StepBadge: View {
    let number: Int
    let title: String

    var body: some View {
        HStack(spacing: 5) {
            Text(String(number))
                .font(.system(size: 10))
                .frame(width: 21, height: 21)
                .overlay(Circle().stroke(.white.opacity(0.12)))
            Text(title).lineLimit(1)
        }
        .font(.system(size: 10.5))
        .foregroundStyle(Color(red: 155 / 255, green: 155 / 255, blue: 163 / 255))
        .frame(maxWidth: .infinity)
    }
}

