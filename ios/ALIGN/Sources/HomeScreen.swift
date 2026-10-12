import SwiftUI

struct HomeScreen: View {
    @EnvironmentObject private var session: MemberSession
    @State private var activity: MemberActivity?
    @State private var cardStatus: CardStatus?
    @State private var failure: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("TU ESPACIO ALIGN")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .tracking(2.5)
                        .foregroundStyle(ALIGNStyle.gold)

                    Text("Tu ALIGN,\nen un solo lugar.")
                        .font(.system(size: 42, weight: .regular, design: .serif))
                        .foregroundStyle(ALIGNStyle.ivory)

                    if let card = session.primary {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(card.level.uppercased())
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .tracking(2)
                                .foregroundStyle(ALIGNStyle.gold)

                            Text(card.name)
                                .font(.system(size: 27, design: .serif))
                                .foregroundStyle(ALIGNStyle.ivory)

                            Text(card.memberCode)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(ALIGNStyle.muted)

                            Label(cardStatus?.active == true ? "Membresía activa" :
                                  cardStatus == nil ? "Comprobando vigencia" : "Membresía no vigente",
                                  systemImage: cardStatus?.active == true ? "checkmark.shield" : "exclamationmark.shield")
                                .font(.subheadline)
                                .foregroundStyle(cardStatus?.active == true ? .green : ALIGNStyle.muted)
                        }
                        .padding(25)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            LinearGradient(colors: [ALIGNStyle.navy, ALIGNStyle.blue],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                    }

                    Text("TUS NÚMEROS")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .tracking(2)
                        .foregroundStyle(ALIGNStyle.gold)

                    HStack(spacing: 12) {
                        metric("Visitas", value: String(activity?.visits ?? 0), icon: "calendar.badge.checkmark")
                        metric("Ahorrado", value: (activity?.savings ?? 0).mxn, icon: "sparkles")
                    }
                    metric("Consumo registrado", value: (activity?.spent ?? 0).mxn, icon: "chart.bar")

                    if let activity, !activity.recentVisits.isEmpty {
                        Text("ACTIVIDAD RECIENTE")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .tracking(2)
                            .foregroundStyle(ALIGNStyle.gold)

                        ForEach(activity.recentVisits) { visit in
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(visit.place).font(.headline)
                                    Text(visit.createdAt.prefix(10))
                                        .font(.caption)
                                        .foregroundStyle(ALIGNStyle.muted)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 5) {
                                    Text(visit.spent.mxn)
                                    Text("Ahorro " + visit.saved.mxn)
                                        .font(.caption)
                                        .foregroundStyle(.green)
                                }
                            }
                            .padding(14)
                            .background(ALIGNStyle.navy.opacity(0.7))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    } else {
                        Text("Tus visitas y ahorros aparecerán aquí cuando uses los beneficios de ALIGN.")
                            .font(.subheadline)
                            .foregroundStyle(ALIGNStyle.muted)
                    }

                    if let failure {
                        Text(failure).font(.footnote).foregroundStyle(.orange)
                    }
                }
                .padding(22)
                // Leave room below recent visits for iOS 27's floating tab bar.
                .padding(.bottom, 88)
            }
            .background(ALIGNStyle.night.ignoresSafeArea())
            .navigationTitle("ALIGN")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await refresh() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(loading)
                }
            }
            .task { await refresh() }
        }
    }

    private func metric(_ title: String, value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(ALIGNStyle.gold)
            Text(value)
                .font(.system(size: 21, weight: .medium, design: .serif))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(title).font(.caption).foregroundStyle(ALIGNStyle.muted)
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ALIGNStyle.navy.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @MainActor private func refresh() async {
        guard let card = session.primary, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            async let details = ALIGNAPI.shared.status(for: card)
            async let history = ALIGNAPI.shared.activity(for: card)
            cardStatus = try await details
            activity = try await history
            failure = nil
        } catch {
            cardStatus = nil
            activity = nil
            failure = error.localizedDescription
        }
    }
}
