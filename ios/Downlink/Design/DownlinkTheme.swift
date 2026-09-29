import SwiftUI

enum DownlinkTheme {
    static let background = Color(red: 8 / 255, green: 9 / 255, blue: 11 / 255)
    static let accent = Color(red: 10 / 255, green: 132 / 255, blue: 1)
    static let success = Color(red: 48 / 255, green: 209 / 255, blue: 88 / 255)
    static let brand = Color(red: 1, green: 59 / 255, blue: 48 / 255)
    static let secondaryText = Color.white.opacity(0.70)
    static let mutedText = Color.white.opacity(0.46)
}

struct GlassPanel: ViewModifier {
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(red: 20 / 255, green: 20 / 255, blue: 25 / 255).opacity(0.50))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 0.75)
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: .black.opacity(0.40), radius: 24, y: 12)
    }
}

extension View {
    func glassPanel(radius: CGFloat = 24) -> some View {
        modifier(GlassPanel(radius: radius))
    }
}

struct DownlinkLogo: View {
    var compact = false

    var body: some View {
        HStack(spacing: 0) {
            Text("DOWN").foregroundStyle(Color(red: 245 / 255, green: 245 / 255, blue: 247 / 255))
            Text("LINK").foregroundStyle(DownlinkTheme.success)
        }
        .font(.custom("SpicyRice-Regular", size: compact ? 31 : 52, relativeTo: .largeTitle))
        .tracking(-2.2)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .scaleEffect(x: 1.08, y: 1, anchor: .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("DOWNLINK")
    }
}

