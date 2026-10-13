import SwiftUI

enum ALIGNStyle {
    static let night = Color(red: 9/255, green: 13/255, blue: 19/255)
    static let navy = Color(red: 15/255, green: 38/255, blue: 63/255)
    static let blue = Color(red: 33/255, green: 73/255, blue: 116/255)
    static let ivory = Color(red: 244/255, green: 241/255, blue: 235/255)
    static let muted = Color(red: 176/255, green: 187/255, blue: 201/255)
    static let gold = Color(red: 216/255, green: 195/255, blue: 157/255)
}

@main
struct ALIGNApp: App {
    @StateObject private var session = MemberSession()
    @StateObject private var privacyShield = ALIGNPrivacyShield()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if session.login == nil {
                    LoginScreen()
                } else {
                    MemberTabs()
                }
            }
            .environmentObject(session)
            .preferredColorScheme(.dark)
            // UIKit notifications install a synchronous cover before iOS snapshots.
            .onAppear { privacyShield.activate() }
            // Do not leave membership details visible in the iOS app switcher.
            .overlay {
                if scenePhase != .active {
                    ALIGNPrivacyCover()
                        .ignoresSafeArea()
                }
            }
        }
    }
}

private struct ALIGNPrivacyCover: View {
    var body: some View {
        ZStack {
            ALIGNStyle.night
            VStack(spacing: 12) {
                Text("ALIGN")
                    .font(.system(size: 44, design: .serif))
                    .tracking(5)
                Text("BELONG TO SOMETHING")
                    .font(.system(size: 10, design: .monospaced))
                    .tracking(3)
                    .foregroundStyle(ALIGNStyle.gold)
            }
            .foregroundStyle(ALIGNStyle.ivory)
        }
        .accessibilityLabel("ALIGN protegida mientras no está activa")
    }
}

struct LoginScreen: View {
    @EnvironmentObject private var session: MemberSession
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            LinearGradient(colors: [ALIGNStyle.night, ALIGNStyle.navy], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("ALIGN")
                        .font(.system(size: 52, weight: .thin, design: .serif))
                        .tracking(6)
                        .foregroundStyle(ALIGNStyle.ivory)

                    Text("BELONG TO SOMETHING")
                        .font(.system(size: 10, design: .monospaced))
                        .tracking(3.2)
                        .foregroundStyle(ALIGNStyle.gold)

                    Spacer(minLength: 45)

                    Text("Tu ciudad,\ndesde dentro.")
                        .font(.system(size: 46, design: .serif))
                        .foregroundStyle(ALIGNStyle.ivory)

                    Text("Inicia sesión para consultar tu tarjeta digital, aliados, visitas y beneficios.")
                        .foregroundStyle(ALIGNStyle.muted)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("USUARIO")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .tracking(1.6)
                            .foregroundStyle(ALIGNStyle.gold)
                        TextField("Nombre de usuario", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .foregroundStyle(ALIGNStyle.ivory)
                            .tint(ALIGNStyle.gold)
                            .padding(14)
                            .background(ALIGNStyle.navy)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ALIGNStyle.blue))
                            .accessibilityIdentifier("login.username")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("CONTRASEÑA")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .tracking(1.6)
                            .foregroundStyle(ALIGNStyle.gold)
                        SecureField("Contraseña", text: $password)
                            .textContentType(.password)
                            .foregroundStyle(ALIGNStyle.ivory)
                            .tint(ALIGNStyle.gold)
                            .padding(14)
                            .background(ALIGNStyle.navy)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(ALIGNStyle.blue))
                            .accessibilityIdentifier("login.password")
                    }

                    if let error = session.loginError {
                        Text(error).foregroundStyle(.red).font(.footnote)
                    }

                    Button {
                        let enteredPassword = password
                        password = ""
                        Task { await session.signIn(username: username, password: enteredPassword) }
                    } label: {
                        HStack {
                            Spacer()
                            if session.signingIn {
                                ProgressView().tint(ALIGNStyle.night)
                            } else {
                                Text("ENTRAR A MI ALIGN").tracking(1.6)
                            }
                            Spacer()
                        }
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .padding(18)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(ALIGNStyle.night)
                    .background(ALIGNStyle.ivory)
                    .disabled(session.signingIn || username.isEmpty || password.isEmpty)
                    .accessibilityIdentifier("login.submit")

                    Text("Tu membresía debe estar registrada en ALIGN. Esta app no realiza cobros.")
                        .font(.caption)
                        .foregroundStyle(ALIGNStyle.muted)
                }
                .padding(28)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
                .padding(.top, 32)
                .padding(.bottom, 44)
            }
        }
    }
}

struct MemberTabs: View {
    var body: some View {
        TabView {
            HomeScreen()
                .tabItem { Label("Inicio", systemImage: "house") }
            MemberQRScreen()
                .tabItem { Label("Mi tarjeta", systemImage: "qrcode") }
            PartnersScreen()
                .tabItem { Label("Aliados", systemImage: "mappin.and.ellipse") }
            AccountScreen()
                .tabItem { Label("Cuenta", systemImage: "person.crop.circle") }
        }
        .tint(ALIGNStyle.gold)
    }
}
