import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

struct MemberQRScreen: View {
    @EnvironmentObject private var session: MemberSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isSceneCaptured) private var isSceneCaptured
    @State private var selectedToken = ""
    @State private var refreshID = 0
    @State private var qr: QRResponse?
    @State private var failure: String?
    @State private var loading = false
    @State private var isCardVisible = false
    @State private var showScreenshotNotice = false

    private var selectedCard: MemberCard? {
        session.cards.first { $0.token == selectedToken }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text("TU IDENTIDAD ALIGN")
                        .font(.system(size: 11, design: .monospaced))
                        .tracking(2.5)
                        .foregroundStyle(ALIGNStyle.gold)

                    Text("Tu tarjeta.")
                        .font(.system(size: 43, design: .serif))
                        .foregroundStyle(ALIGNStyle.ivory)

                    if session.cards.count > 1 {
                        Picker("Integrante", selection: $selectedToken) {
                            ForEach(session.cards) { card in
                                Text(card.name).tag(card.token)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(ALIGNStyle.ivory)
                    }

                    if let selectedCard {
                        VStack(spacing: 17) {
                            Text("ALIGN")
                                .font(.system(size: 30, design: .serif))
                                .tracking(4)
                                .foregroundStyle(ALIGNStyle.ivory)

                            Text("MEMBERSHIP CARD")
                                .font(.system(size: 11, design: .monospaced))
                                .tracking(2.5)
                                .foregroundStyle(ALIGNStyle.gold)

                            Text(selectedCard.name.uppercased())
                                .font(.system(size: 18, weight: .medium))
                                .tracking(1.3)
                                .foregroundStyle(ALIGNStyle.ivory)

                            Text(selectedCard.level + " · " + selectedCard.memberCode)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(ALIGNStyle.muted)

                            if isSceneCaptured {
                                Label("QR oculto durante grabación o duplicación de pantalla",
                                      systemImage: "eye.slash")
                                    .font(.subheadline)
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(ALIGNStyle.gold)
                                    .frame(height: 270)
                                    .accessibilityIdentifier("qr.screenCaptureProtected")
                            } else if let qr {
                                // The QR must disappear immediately upon expiration, even if
                                // networking stalls. A 1-second timeline drives this safety gate.
                                TimelineView(.periodic(from: .now, by: 1)) { context in
                                    if let validUntil = expiryDate(qr.qrValidUntil),
                                       context.date < validUntil && scenePhase == .active {
                                        VStack(spacing: 8) {
                                            QRCodeImage(text: qr.validationUrl)
                                                .frame(width: 246, height: 246)
                                                .padding(12)
                                                .background(.white)
                                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                                .privacySensitive()
                                                .accessibilityLabel("Código QR temporal de tu membresía")
                                            Text("Vence a las " + validUntil.formatted(date: .omitted, time: .shortened))
                                                .font(.caption)
                                                .foregroundStyle(ALIGNStyle.muted)
                                        }
                                    } else {
                                        Label("Renovando el código seguro…", systemImage: "arrow.clockwise")
                                            .frame(height: 270)
                                            .foregroundStyle(ALIGNStyle.muted)
                                    }
                                }
                            } else if loading {
                                ProgressView("Generando QR vigente…")
                                    .tint(ALIGNStyle.gold)
                                    .frame(height: 270)
                            } else {
                                Image(systemName: "qrcode")
                                    .font(.system(size: 86))
                                    .foregroundStyle(ALIGNStyle.muted)
                                    .frame(height: 270)
                            }

                            Text(qr != nil ? "Renovación automática · cada 15 minutos" : "QR no disponible en este momento")
                                .font(.caption)
                                .foregroundStyle(ALIGNStyle.muted)

                            Button("Actualizar QR") { refreshID += 1 }
                                .buttonStyle(.bordered)
                                .tint(ALIGNStyle.gold)
                        }
                        .padding(28)
                        .frame(maxWidth: .infinity)
                        .background(
                            LinearGradient(colors: [ALIGNStyle.night, ALIGNStyle.navy],
                                           startPoint: .top, endPoint: .bottom)
                        )
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(ALIGNStyle.blue))
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                    }

                    if let failure {
                        Text(failure)
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }

                    Label("La grabación y duplicación de pantalla ocultan el QR. iOS no permite impedir capturas de pantalla: no compartas fotografías del código. El aliado siempre debe validar al titular.", systemImage: "shield.lefthalf.filled")
                        .font(.footnote)
                        .foregroundStyle(ALIGNStyle.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if selectedCard?.isOwner == true {
                        Text("Tu tarjeta Apple Wallet permanece independiente y exclusiva para el propietario. No se emiten pases Wallet para otros socios.")
                            .font(.caption)
                            .foregroundStyle(ALIGNStyle.gold)
                    }
                }
                .padding(22)
                .padding(.bottom, 88)
            }
            .background(ALIGNStyle.night.ignoresSafeArea())
            .navigationTitle("Mi tarjeta")
            .onAppear {
                isCardVisible = true
                if selectedToken.isEmpty { selectedToken = session.primary?.token ?? "" }
            }
            .onDisappear {
                isCardVisible = false
                showScreenshotNotice = false
            }
            // Apple notifies apps AFTER a screenshot has already been taken.
            // This is a deterrence notice; it cannot retroactively block the saved image.
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
                if isCardVisible && scenePhase == .active {
                    showScreenshotNotice = true
                }
            }
            .alert("Captura de pantalla detectada", isPresented: $showScreenshotNotice) {
                Button("Entendido", role: .cancel) {}
            } message: {
                Text("Esta tarjeta es personal. Por seguridad, evita compartir capturas de tu QR. El aliado debe verificar tu identidad y la vigencia del código.")
            }
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .active { refreshID += 1 }
            }
            .onChange(of: isSceneCaptured) { _, captured in
                if !captured { refreshID += 1 }
            }
            .task(id: selectedToken + ":" + String(refreshID) + ":" + String(describing: scenePhase)) {
                await continuallyRefreshQR()
            }
        }
    }

    private func expiryDate(_ text: String) -> Date? {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.date(from: text)
    }

    @MainActor private func continuallyRefreshQR() async {
        guard scenePhase == .active, let card = selectedCard else {
            qr = nil
            return
        }
        qr = nil
        failure = nil
        while !Task.isCancelled && scenePhase == .active {
            loading = true
            do {
                let status = try await ALIGNAPI.shared.status(for: card)
                guard status.active else {
                    qr = nil
                    loading = false
                    failure = "La membresía está inactiva o vencida."
                    return
                }
                let next = try await ALIGNAPI.shared.qr(for: card)
                guard !Task.isCancelled else { return }
                qr = next
                failure = nil
                loading = false
                // Wait until the backend's actual 15-minute window ends.
                // Do not repeatedly fetch the same signed QR before expiry.
                let seconds = max(1.0, min(900.0, next.refreshAfterMs / 1000.0 + 0.25))
                try await Task.sleep(for: .seconds(seconds))
            } catch is CancellationError {
                return
            } catch {
                qr = nil
                loading = false
                failure = error.localizedDescription
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }
}

private struct QRCodeImage: View {
    let text: String

    var body: some View {
        if let image = generate() {
            Image(uiImage: image)
                .resizable()
                .interpolation(.none)
                .scaledToFit()
        } else {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.red)
        }
    }

    private func generate() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let ci = filter.outputImage,
              let cg = CIContext().createCGImage(ci, from: ci.extent)
        else { return nil }
        return UIImage(cgImage: cg)
    }
}
