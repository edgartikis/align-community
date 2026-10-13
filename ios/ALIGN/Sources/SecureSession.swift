import Foundation
import Security
import SwiftUI

/// Member tokens and the temporary billing session belong in iOS Keychain,
/// never UserDefaults, URLs, source control, crash logs or analytics.
enum SecureSession {
    // The Debug Preview bundle ID gets its own isolated Keychain namespace;
    // never load existing production membership tokens in a Preview build.
    private static let service = Bundle.main.bundleIdentifier ?? "mx.com.alignmembers.app"
    private static let account = "member-login"

    static func load() -> LoginResponse? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(LoginResponse.self, from: data)
    }

    static func save(_ login: LoginResponse) throws {
        let data = try JSONEncoder().encode(login)
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemUpdate(key as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var attributes = key
            attributes[kSecValueData as String] = data
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
                throw AppFailure.cannotSaveSession
            }
        } else if status != errSecSuccess {
            throw AppFailure.cannotSaveSession
        }
    }

    static func clear() {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(key as CFDictionary)
    }
}

@MainActor
final class MemberSession: ObservableObject {
    @Published private(set) var login: LoginResponse?
    @Published private(set) var signingIn = false
    @Published var loginError: String?

    init() {
        login = SecureSession.load()
    }

    var primary: MemberCard? { login?.primary }
    var cards: [MemberCard] { login?.cards ?? [] }

    func signIn(username: String, password: String) async {
        guard !signingIn else { return }
        signingIn = true
        loginError = nil
        defer { signingIn = false }
        do {
            let result = try await ALIGNAPI.shared.login(username: username, password: password)
            try SecureSession.save(result)
            login = result
        } catch {
            loginError = error.localizedDescription
        }
    }

    func signOut() {
        SecureSession.clear()
        login = nil
        loginError = nil
    }
}
