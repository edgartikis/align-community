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

    func qr(for card: MemberCard) async throws -> QRResponse {
        let request = request(
            path: "/api/monthly-qr",
            query: [.init(name: "token", value: card.token)]
        )
        return try await fetch(request)
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
