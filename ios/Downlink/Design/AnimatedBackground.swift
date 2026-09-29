import SwiftUI

struct AnimatedBackground: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let time = CGFloat(timeline.date.timeIntervalSinceReferenceDate)
                let center = size.height * 0.37

                for line in 0..<22 {
                    var path = Path()
                    let offset = CGFloat(line - 11) * 11
                    for x in stride(from: CGFloat.zero, through: size.width, by: 5) {
                        let normalized = x / max(size.width, 1)
                        let envelope = sin(normalized * .pi)
                        let wave = sin(normalized * 18 + time * 0.42 + CGFloat(line) * 0.26)
                        let fine = sin(normalized * 39 - time * 0.22 + CGFloat(line) * 0.11)
                        let y = center + offset + (wave * 22 + fine * 5) * envelope
                        if x == 0 { path.move(to: CGPoint(x: x, y: y)) }
                        else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                    let opacity = 0.035 + (1 - abs(Double(line - 11)) / 12) * 0.06
                    context.stroke(path, with: .color(.white.opacity(opacity)), lineWidth: 0.7)
                }
            }
        }
        .background(DownlinkTheme.background)
        .overlay {
            RadialGradient(
                colors: [DownlinkTheme.background.opacity(0.10), DownlinkTheme.background.opacity(0.78)],
                center: UnitPoint(x: 0.5, y: 0.27),
                startRadius: 20,
                endRadius: 470
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

struct ThumbnailBackground: View {
    let url: URL?

    var body: some View {
        ZStack {
            DownlinkTheme.background
            if let url {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .scaledToFill()
                            .saturation(1.8)
                            .brightness(-0.42)
                            .blur(radius: 58)
                            .scaleEffect(1.35)
                    }
                }
            }
            Color.black.opacity(0.22)
        }
        .ignoresSafeArea()
        .clipped()
        .accessibilityHidden(true)
    }
}
