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
                    NavigationLink {
                        SubscriptionManagementScreen()
                    } label: {
                        Label("Administrar membresía", systemImage: "gearshape")
                    }
                    .accessibilityIdentifier("account.membership.manage")
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
                    Text("ALIGN para iPhone\nPuedes conocer las membresías y contratar en alignmembers.com.mx. Los pagos no se procesan dentro de esta aplicación.")
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


/// A secondary account/settings screen: visible to members, not on the main tab.
private struct SubscriptionManagementScreen: View {
    @State private var billing: BillingStatus?
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var showCancellationConfirmation = false
    @State private var errorMessage: String?
    @State private var confirmationMessage: String?

    var body: some View {
        List {
            Section("Tu suscripción") {
                if isLoading && billing == nil {
                    ProgressView("Consultando mensualidad…")
                }

                if let billing {
                    LabeledContent("Estado", value: billing.statusLabel)
                    if let validUntil = billing.periodEndLabel {
                        LabeledContent("Vigencia", value: validUntil)
                    }
                    if billing.lifetime == true {
                        Text("Tu membresía permanente no tiene cobros ni renovaciones automáticas.")
                            .font(.footnote)
                            .foregroundStyle(ALIGNStyle.muted)
                    } else if billing.cancelAtPeriodEnd {
                        Text("La renovación ya está cancelada. Mantendrás tus beneficios hasta el final del periodo pagado.")
                            .font(.footnote)
                            .foregroundStyle(ALIGNStyle.muted)
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                if let confirmationMessage {
                    Text(confirmationMessage)
                        .font(.footnote)
                        .foregroundStyle(ALIGNStyle.ivory)
                }
            }
            .listRowBackground(ALIGNStyle.navy)

            if let billing, billing.canCancel && !billing.cancelAtPeriodEnd {
                Section("Renovación") {
                    Button(role: .destructive) {
                        showCancellationConfirmation = true
                    } label: {
                        Label("Cancelar renovación mensual", systemImage: "calendar.badge.minus")
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("account.membership.cancel")

                    Text("Si confirmas, Stripe detendrá los cobros futuros al concluir tu periodo pagado. Tus beneficios seguirán activos hasta entonces.")
                        .font(.footnote)
                        .foregroundStyle(ALIGNStyle.muted)
                }
                .listRowBackground(ALIGNStyle.navy)
            } else if let billing, billing.lifetime != true && !billing.cancelAtPeriodEnd {
                Section {
                    Text("No hay una renovación activa disponible para cancelar desde esta cuenta.")
                        .font(.footnote)
                        .foregroundStyle(ALIGNStyle.muted)
                }
                .listRowBackground(ALIGNStyle.navy)
            }
        }
        .scrollContentBackground(.hidden)
        .background(ALIGNStyle.night)
        .navigationTitle("Administrar membresía")
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
        .confirmationDialog(
            "¿Cancelar la renovación mensual?",
            isPresented: $showCancellationConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sí, cancelar renovación", role: .destructive) {
                Task { await cancelRenewal() }
            }
            Button("Conservar mi membresía", role: .cancel) {}
        } message: {
            Text("Tu membresía continuará vigente hasta el final del periodo ya pagado. Esta acción evita futuros cobros de renovación.")
        }
    }

    private func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            billing = try await ALIGNAPI.shared.billingStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func cancelRenewal() async {
        guard !isSaving, billing?.canCancel == true else { return }
        isSaving = true
        errorMessage = nil
        confirmationMessage = nil
        defer { isSaving = false }
        do {
            let updated = try await ALIGNAPI.shared.cancelMembershipRenewal()
            guard updated.cancelAtPeriodEnd else { throw AppFailure.invalidResponse }
            billing = updated
            confirmationMessage = "Cancelación confirmada. No se renovará automáticamente tu membresía."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
