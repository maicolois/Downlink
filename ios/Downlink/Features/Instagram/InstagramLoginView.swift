import SwiftUI
import WebKit

@MainActor
private final class InstagramBrowser: ObservableObject {
    let webView: WKWebView

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "DOWNLINK iOS"
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: URL(string: "https://www.instagram.com/accounts/login/")!))
    }

    func cookies() async -> [HTTPCookie] {
        await withCheckedContinuation { continuation in
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies {
                continuation.resume(returning: $0)
            }
        }
    }
}

struct InstagramLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var session: InstagramSessionStore
    @StateObject private var browser = InstagramBrowser()
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                InstagramWebView(webView: browser.webView)
                VStack(alignment: .leading, spacing: 8) {
                    Label("Privacidad", systemImage: "lock.fill")
                        .font(.caption.weight(.semibold))
                    Text("La sesión se cifra en el llavero de este iPhone, caduca a las 8 horas y solo se entrega temporalmente a yt-dlp.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let error {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color.black.opacity(0.94))
            }
            .background(Color.black)
            .navigationTitle("Cuenta de Instagram")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Guardando…" : "Guardar sesión") {
                        saveSession()
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func saveSession() {
        isSaving = true
        error = nil
        Task {
            do {
                try session.connect(cookies: await browser.cookies())
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            isSaving = false
        }
    }
}

private struct InstagramWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

