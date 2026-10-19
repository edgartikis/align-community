import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

// TEMPORARY App Review exception for the owner's card in official Release.
// Flip to false in the first post-review iOS update. Preview and Debug
// remain capture-protected, as do all paying members in every build.
private enum AppReviewCapturePolicy {
    #if DEBUG || ALIGN_PREVIEW
    static let allowFounderRecording = false
    #else
    static let allowFounderRecording = true
    #endif
}

struct MemberQRScreen: View {
    @EnvironmentObject private var session: MemberSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isSceneCaptured) private var isSceneCaptured
    @State private var selectedToken = ""
    @State private var refreshID = 0
    @State private var qr: QRResponse?
    @State private var failure: String?
    @State private var cardUnavailable = false
    @State private var loading = false
    @State private var isCardVisible = false
    @State private var showScreenshotNotice = false
    @State private var screenshotNoticeText = ""
    @State private var rotationInProgress = false
    @State private var pendingRotationCode: String?
    // iOS may deliver the screenshot notification during a SwiftUI QR refresh,
    // when 'qr' is momentarily nil. Keep the last issued protected code for
    // this card, without ever persisting it or exposing it in diagnostics.
    @State private var lastProtectedQRCode: String?
    @State private var lastProtectedToken: String?

    private var selectedCard: MemberCard? {
        session.cards.first { $0.token == selectedToken }
    }

    // Only the known Founder Lifetime card may remain visible during
    // iOS screen recording in the official release review build.
    // Expiration, account validation and inactive-scene shielding still apply.
    private var shouldMaskScreenCapture: Bool {
        isSceneCaptured && !(AppReviewCapturePolicy.allowFounderRecording && selectedCard?.isOwner == true)
    }

    var body: some View {
        NavigationStack {
            observedCardView
        }
    }

    private var cardContentView: some View {
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

                    membershipCard

                    if let failure {
                        Text(failure)
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                        if cardUnavailable {
                            Button("Volver a iniciar sesión") {
                                session.signOut()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(ALIGNStyle.blue)
                            .accessibilityIdentifier("memberCard.signInAgain")
                        }
                    }

                    Label(shouldMaskScreenCapture
                          ? "La grabación o duplicación de pantalla oculta el QR. No compartas imágenes del código; el aliado debe validar al titular."
                          : "Tu QR es temporal. No compartas grabaciones ni capturas que muestren el código; el aliado siempre debe validar al titular.",
                          systemImage: "shield.lefthalf.filled")
                        .font(.footnote)
                        .foregroundStyle(ALIGNStyle.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)

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
            // Apple reports screenshots AFTER the capture. Only the separately
            // enabled app-QR backend can invalidate the previous image.
    }

    private var screenshotNoticeView: some View {
        cardContentView
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
                guard isCardVisible && scenePhase == .active else { return }
                // A screenshot can overlap SwiftUI's scene/QR refresh. Use
                // the last issued *protected* code if the visible state was
                // briefly cleared; do not mistake that race for legacy mode.
                guard !rotationInProgress && pendingRotationCode == nil else { return }
                let lastCode = lastProtectedToken == selectedToken ? lastProtectedQRCode : nil
                let code = qr?.currentAppCode ?? lastCode
                if let code,
                   session.login?.sessionToken?.isEmpty == false {
                    pendingRotationCode = code
                    rotationInProgress = true
                    qr = nil
                    screenshotNoticeText = "Se detectó una captura. ALIGN está solicitando un QR nuevo al servidor. No compartas la imagen guardada."
                    showScreenshotNotice = true
                    Task { await rotateQRFromScreenshot() }
                } else {
                    // Never claim an invalidation happened when the app did
                    // not have a protected code or a valid session.
                    screenshotNoticeText = "Captura detectada. No se pudo iniciar la renovación segura del QR. La fotografía podría seguir siendo válida hasta su vencimiento. Verifica que diga «QR protegido» e inicia sesión nuevamente si es necesario."
                    showScreenshotNotice = true
                }
            }
            .alert("Captura de pantalla detectada", isPresented: $showScreenshotNotice) {
                Button("Entendido", role: .cancel) {}
            } message: {
                Text(screenshotNoticeText)
            }
    }

    private var observedCardView: some View {
        screenshotNoticeView
            .onChange(of: selectedToken) { _, _ in
                // A pending screenshot rotation belongs to one specific card.
                // Switching Duo/Circle members must never block the next card.
                pendingRotationCode = nil
                rotationInProgress = false
                failure = nil
                cardUnavailable = false
                qr = nil
                lastProtectedQRCode = nil
                lastProtectedToken = nil
            }
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .active { refreshID += 1 }
            }
            .onChange(of: isSceneCaptured) { _, captured in
                if !captured { refreshID += 1 }
            }
            .task(id: selectedToken + ":" + String(refreshID) + ":" + String(describing: scenePhase) + ":" + String(rotationInProgress)) {
                await continuallyRefreshQR()
            }
    }

    // Isolate the large, stateful card from the navigation/notification
    // modifiers so SwiftUI can type-check each expression independently.
    @ViewBuilder
    private var membershipCard: some View {
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

                            if shouldMaskScreenCapture {
                                Label("QR oculto durante grabación o duplicación de pantalla",
                                      systemImage: "eye.slash")
                                    .font(.subheadline)
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(ALIGNStyle.gold)
                                    .frame(height: 270)
                                    .accessibilityIdentifier("qr.screenCaptureProtected")
                            } else if rotationInProgress {
                                ProgressView("Protegiendo tu QR tras la captura…")
                                    .tint(ALIGNStyle.gold)
                                    .frame(height: 270)
                            } else if pendingRotationCode != nil {
                                Label("No pudimos confirmar la invalidación. Reintenta antes de usar la tarjeta.",
                                      systemImage: "exclamationmark.shield")
                                    .font(.subheadline)
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(.orange)
                                    .frame(height: 270)
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

                            Text(qr?.appRotationEnabled == true
                                 ? "QR protegido · renovación por captura y cada 15 minutos"
                                 : qr != nil ? "QR de 15 minutos · captura no invalidada"
                                 : "QR no disponible en este momento")
                                .font(.caption)
                                .foregroundStyle(ALIGNStyle.muted)

                            Button(pendingRotationCode != nil ? "Reintentar renovación" : "Actualizar QR") {
                                if pendingRotationCode != nil {
                                    rotationInProgress = true
                                    Task { await rotateQRFromScreenshot() }
                                } else {
                                    refreshID += 1
                                }
                            }
                            .buttonStyle(.bordered)
                            .disabled(rotationInProgress)
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

    }

    private func expiryDate(_ text: String) -> Date? {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.date(from: text)
    }

    @MainActor private func rotateQRFromScreenshot() async {
        guard let code = pendingRotationCode,
              let card = selectedCard,
              let sessionToken = session.login?.sessionToken,
              !sessionToken.isEmpty else {
            rotationInProgress = false
            failure = "La sesión expiró. Vuelve a iniciar sesión."
            return
        }
        do {
            let next = try await ALIGNAPI.shared.rotateAppQR(
                for: card, sessionToken: sessionToken, previousCode: code
            )
            guard selectedToken == card.token else { return }
            pendingRotationCode = nil
            qr = next
            lastProtectedQRCode = next.currentAppCode
            lastProtectedToken = card.token
            failure = nil
            screenshotNoticeText = "El servidor confirmó la renovación. La captura anterior ya no corresponde al QR activo."
            rotationInProgress = false
            refreshID += 1
        } catch {
            qr = nil
            failure = "No se pudo confirmar la invalidación del QR: " + error.localizedDescription
            screenshotNoticeText = "No se pudo confirmar la renovación. No compartas la captura y presiona Reintentar renovación."
            rotationInProgress = false
        }
    }

    @MainActor private func continuallyRefreshQR() async {
        guard !rotationInProgress, pendingRotationCode == nil,
              scenePhase == .active, let card = selectedCard else {
            qr = nil
            return
        }
        qr = nil
        failure = nil
        cardUnavailable = false
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
                let next = try await ALIGNAPI.shared.qr(for: card, sessionToken: session.login?.sessionToken)
                guard !Task.isCancelled else { return }
                qr = next
                lastProtectedQRCode = next.currentAppCode
                lastProtectedToken = next.currentAppCode == nil ? nil : card.token
                failure = nil
                cardUnavailable = false
                loading = false
                // Wait until the backend's actual 15-minute window ends.
                // Do not repeatedly fetch the same signed QR before expiry.
                let seconds = max(1.0, min(900.0, next.refreshAfterMs / 1000.0 + 0.25))
                try await Task.sleep(for: .seconds(seconds))
            } catch is CancellationError {
                return
            } catch AppFailure.cardUnavailable {
                qr = nil
                loading = false
                lastProtectedQRCode = nil
                lastProtectedToken = nil
                cardUnavailable = true
                failure = AppFailure.cardUnavailable.localizedDescription
                // A deleted card requires a fresh sign-in; don't keep polling.
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
