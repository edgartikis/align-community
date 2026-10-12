import SwiftUI

struct AccountScreen: View {
    @EnvironmentObject private var session: MemberSession
    @State private var showLogoutConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                Section("Tu membresía") {
                    if let card = session.primary {
                        LabeledContent("Titular", value: card.name)
                        LabeledContent("Plan", value: card.level)
                        LabeledContent("Código", value: card.memberCode)
                        LabeledContent("Estado al iniciar sesión", value: card.status)
                    }
                    if let login = session.login {
                        LabeledContent("Usuario", value: login.username)
                    }
                }
                .listRowBackground(ALIGNStyle.navy)

                Section("Seguridad y privacidad") {
                    Link(destination: URL(string: "https://alignmembers.com.mx/aviso-privacidad.html")!) {
                        Label("Aviso de privacidad", systemImage: "lock.shield")
                    }
                    Link(destination: URL(string: "https://alignmembers.com.mx/terminos-condiciones.html")!) {
                        Label("Términos y condiciones", systemImage: "doc.text")
                    }
                    Link(destination: URL(string: "mailto:alignservice18@gmail.com?subject=Ayuda%20con%20mi%20cuenta%20ALIGN")!) {
                        Label("Ayuda y solicitudes sobre mi cuenta", systemImage: "envelope")
                    }
                }
                .listRowBackground(ALIGNStyle.navy)

                Section {
                    Button(role: .destructive) {
                        showLogoutConfirmation = true
                    } label: {
                        Label("Cerrar sesión", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                .listRowBackground(ALIGNStyle.navy)

                Section {
                    Text("ALIGN para iPhone · Versión de prueba 0.1\nLos pagos y cambios de membresía no están disponibles en esta versión de la app.")
                        .font(.caption)
                        .foregroundStyle(ALIGNStyle.muted)
                }
                .listRowBackground(ALIGNStyle.navy)
            }
            .scrollContentBackground(.hidden)
            .background(ALIGNStyle.night)
            .navigationTitle("Mi cuenta")
            .confirmationDialog("¿Cerrar sesión?", isPresented: $showLogoutConfirmation) {
                Button("Cerrar sesión", role: .destructive) { session.signOut() }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Se borrarán de este dispositivo los datos de acceso almacenados en el llavero.")
            }
        }
    }
}
