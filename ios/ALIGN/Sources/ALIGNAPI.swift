import Foundation
import CryptoKit

/// Existing production backend. This client never sends payments or Stripe keys.
final class ALIGNAPI {
    static let shared = ALIGNAPI()
    private let base = URL(string: "https://api.alignmembers.com.mx")!
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
    }

    private func fetch<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw AppFailure.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
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

        // Compatibility with ALIGN's existing member-login endpoint.
        // A future release should use a short-lived server session for all APIs.
        let digest = SHA256.hash(data: Data(password.utf8))
        let passwordHash = digest.map { String(format: "%02x", $0) }.joined()

        var request = request(path: "/api/member-login")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "username": normalized, "passwordHash": passwordHash
        ])
        let result: LoginResponse = try await fetch(request)
        guard !result.cards.isEmpty else { throw AppFailure.missingMembership }
        return result
    }

    func status(for card: MemberCard) async throws -> CardStatus {
        let request = request(
            path: "/api/member-card",
            query: [.init(name: "token", value: card.token)]
        )
        return try await fetch(request)
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
            if response.statusCode != 404 {
                let message = try? JSONDecoder().decode(APIErrorMessage.self, from: data)
                throw AppFailure.server(message?.error ?? "No se pudo abrir el QR protegido.")
            }
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
        let request = request(
            path: "/api/member-activity",
            query: [.init(name: "token", value: card.token)]
        )
        let value: MemberActivityResponse = try await fetch(request)
        return value.activity
    }
}
