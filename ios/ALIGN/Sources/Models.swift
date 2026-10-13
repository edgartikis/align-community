import Foundation

struct MemberCard: Codable, Identifiable, Hashable {
    let token: String
    let name: String
    let level: String
    let planKey: String
    let memberCode: String
    let status: String
    let position: Int
    let photoUrl: String?
    let savings: Double?

    var id: String { token }
    var isOwner: Bool { planKey == "owner" && memberCode == "AL-FOUNDER-001" }
}

struct LoginResponse: Codable {
    let ok: Bool
    let username: String
    let groupId: String
    let planKey: String
    let primary: MemberCard
    let cards: [MemberCard]
    let active: Bool
    let sessionToken: String?
}

struct CardStatus: Decodable {
    let active: Bool
    let name: String
    let level: String
    let planKey: String
    let memberCode: String
    let membershipType: String?
    let savings: Double?
    let status: String
    let validUntil: String?
}

struct QRResponse: Decodable {
    let validationUrl: String
    let qrValidUntil: String
    let refreshAfterMs: Double
    let appRotationEnabled: Bool?

    var currentAppCode: String? {
        guard appRotationEnabled == true,
              let components = URLComponents(string: validationUrl),
              components.path.hasPrefix("/q/") else { return nil }
        let code = String(components.path.dropFirst(3))
        guard code.range(of: #"^A[A-Za-z0-9_-]{31}$"#, options: .regularExpression) != nil
        else { return nil }
        return code
    }
}

struct MemberActivityResponse: Decodable {
    let activity: MemberActivity
}

struct MemberActivity: Decodable {
    let visits: Int
    let spent: Double
    let savings: Double
    let recentVisits: [MemberVisit]
}

struct MemberVisit: Decodable, Identifiable {
    let visitId: String
    let createdAt: String
    let place: String
    let spent: Double
    let saved: Double
    let benefit: String?

    var id: String { visitId }
}

struct APIErrorMessage: Decodable {
    let error: String?
}

enum AppFailure: LocalizedError {
    case invalidResponse
    case server(String)
    case missingMembership
    case cannotSaveSession

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "El servicio ALIGN respondió de forma inesperada."
        case .server(let message): message
        case .missingMembership: "No encontramos una tarjeta activa para esta cuenta."
        case .cannotSaveSession: "No fue posible guardar la sesión de forma segura."
        }
    }
}

extension Double {
    var mxn: String {
        formatted(.currency(code: "MXN").locale(Locale(identifier: "es_MX")))
    }
}
