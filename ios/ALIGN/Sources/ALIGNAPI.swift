import Foundation
import CryptoKit

/// Network client does not process payments or hold Stripe credentials.
/// Xcode Debug and the separate internal TestFlight scheme use isolated Preview.
/// The original Release scheme continues to use the official production backend.
final class ALIGNAPI {
    static let shared = ALIGNAPI()
    #if DEBUG || ALIGN_PREVIEW
    private let base = URL(string: "https://align-qr-pilot-align-payments.alignservice18.workers.dev")!
    #else
    private let base = URL(string: "https://api.alignmembers.com.mx")!
    #endif
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
    }

    private func fetch<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self, missingCardIsGone: Bool = false) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw AppFailure.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            if missingCardIsGone && response.statusCode == 404 {
                throw AppFailure.cardUnavailable
            }
            let message = try? JSONDecoder().decode(APIErrorMessage.self, from: data)
            throw AppFailure.server(message?.error ?? "No fue posible completar la solicitud.")
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw AppFailure.invalidResponse
        }
    }

    private func request(path: String, query: [URLQueryItem] = []) -> URLRequest {
        var url = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        url.path = path
        if !query.isEmpty { url.queryItems = query }
        var request = URLRequest(url: url.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        let normalized = username.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: " ", with: ".")
        guard normalized.range(of: #"^[a-z0-9._-]{4,24}$"#, options: .regularExpression) != nil
        else { throw AppFailure.server("Escribe un nombre de usuario válido.") }

        #if DEBUG || ALIGN_PREVIEW
        // V2 Preview only: HTTPS sends the actual password to the server once.
        // Never persist the password; the server derives a salted verifier.
        // Old TestFlight builds cannot sign in once this Preview gate is deployed.
        var loginRequest = request(path: "/api/member-login-v2")
        let credentials: [String: String] = ["username": normalized, "password": password]
        #else
        // Unchanged production Release behavior until an approved migration.
        let digest = SHA256.hash(data: Data(password.utf8))
        let passwordHash = digest.map { String(format: "%02x", $0) }.joined()
        var loginRequest = request(path: "/api/member-login")
        let credentials: [String: String] = ["username": normalized, "passwordHash": passwordHash]
        #endif
        loginRequest.httpMethod = "POST"
        loginRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        loginRequest.httpBody = try JSONSerialization.data(withJSONObject: credentials)
        let result: LoginResponse = try await fetch(loginRequest)
        guard !result.cards.isEmpty else { throw AppFailure.missingMembership }
        return result
    }

    /// Preview-only: account session in Authorization, member token in POST body.
    /// No membership token enters the external URL used by the iPhone.
    private func authorizedMemberRequest(path: String, for card: MemberCard) throws -> URLRequest {
        guard let bearer = SecureSession.load()?.sessionToken, !bearer.isEmpty else {
            throw AppFailure.server("Tu sesión expiró. Inicia sesión nuevamente.")
        }
        var call = request(path: path)
        call.httpMethod = "POST"
        call.setValue("application/json", forHTTPHeaderField: "Content-Type")
        call.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        call.httpBody = try JSONSerialization.data(withJSONObject: ["token": card.token])
        return call
    }

    func status(for card: MemberCard) async throws -> CardStatus {
        #if DEBUG || ALIGN_PREVIEW
        let secured = try authorizedMemberRequest(path: "/api/app-member-card", for: card)
        return try await fetch(secured, missingCardIsGone: true)
        #else
        let request = request(
            path: "/api/member-card",
            query: [.init(name: "token", value: card.token)]
        )
        return try await fetch(request, missingCardIsGone: true)
        #endif
    }

    /// The protected iOS QR is preview-gated. A 404 means it is not enabled;
    /// until activation, preserve the existing 15-minute web-compatible QR.
    func qr(for card: MemberCard, sessionToken: String?) async throws -> QRResponse {
        if let sessionToken, !sessionToken.isEmpty {
            var appRequest = request(
                path: "/api/app-qr",
                query: [.init(name: "token", value: card.token)]
            )
            appRequest.setValue("Bearer " + sessionToken, forHTTPHeaderField: "Authorization")
            let (data, response) = try await session.data(for: appRequest)
            guard let response = response as? HTTPURLResponse else { throw AppFailure.invalidResponse }
            if response.statusCode == 200 {
                return try JSONDecoder().decode(QRResponse.self, from: data)
            }
            if response.statusCode == 404 {
                #if DEBUG || ALIGN_PREVIEW
                // A preview build must never silently render a legacy QR:
                // screenshots would remain usable for the entire 15-minute slot.
                throw AppFailure.server("ALIGN Preview no tiene habilitado el QR protegido. Verifica el servidor de pruebas.")
                #endif
            } else {
                let message = try? JSONDecoder().decode(APIErrorMessage.self, from: data)
                throw AppFailure.server(message?.error ?? "No se pudo abrir el QR protegido.")
            }
        } else {
            #if DEBUG || ALIGN_PREVIEW
            throw AppFailure.server("La sesión de ALIGN Preview no está disponible. Inicia sesión nuevamente.")
            #endif
        }
        return try await fetch(request(
            path: "/api/monthly-qr",
            query: [.init(name: "token", value: card.token)]
        ))
    }

    /// Requires a valid login session AND the previous code. The backend
    /// checks the active revision before replacing it, on the app channel only.
    func rotateAppQR(for card: MemberCard, sessionToken: String, previousCode: String) async throws -> QRResponse {
        var rotation = request(path: "/api/app-qr")
        rotation.httpMethod = "POST"
        rotation.setValue("application/json", forHTTPHeaderField: "Content-Type")
        rotation.setValue("Bearer " + sessionToken, forHTTPHeaderField: "Authorization")
        rotation.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": card.token,
            "previousCode": previousCode,
        ])
        return try await fetch(rotation)
    }

    func activity(for card: MemberCard) async throws -> MemberActivity {
        #if DEBUG || ALIGN_PREVIEW
        let secured = try authorizedMemberRequest(path: "/api/app-member-activity", for: card)
        let value: MemberActivityResponse = try await fetch(secured)
        #else
        let request = request(
            path: "/api/member-activity",
            query: [.init(name: "token", value: card.token)]
        )
        let value: MemberActivityResponse = try await fetch(request)
        #endif
        return value.activity
    }
}
