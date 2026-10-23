import SwiftUI

/// Public partner catalog snapshot; no credentials or unpublished discounts.
/// Monetary terms must be confirmed by the partner at the time of service.
/// Before App Store release, move partner offers to a versioned public API.
struct Partner: Identifiable, Hashable {
    let id: String
    let name: String
    let category: String
    let summary: String
    let plans: [String]
    let page: String?

    static let everyone = ["brotherhood", "girls", "ranch", "duo", "circle"]

    func available(for plan: String) -> Bool {
        plan == "owner" || plans.contains(plan)
    }

    static let catalog: [Partner] = [
        .init(id:"global", name:"Global Gym", category:"Fitness", summary:"Beneficios en mensualidad, invitados y cafetería.", plans:everyone, page:"global-gym.html"),
        .init(id:"uspin", name:"USPIN", category:"Fitness", summary:"Promociones en Ride, Train y clases sujetas a condiciones.", plans:["girls","duo","circle"], page:"uspin.html"),
        .init(id:"sante", name:"Santé Pilates", category:"Wellness", summary:"Tarifas preferenciales para paquetes de clases participantes.", plans:["girls","duo","circle"], page:"sante.html"),
        .init(id:"nuva", name:"NUVA Pilates Studio", category:"Wellness", summary:"Beneficios seleccionados en membresías y programas.", plans:["girls","duo","circle"], page:"nuva.html"),
        .init(id:"padel", name:"Pádel 11:11", category:"Deportes", summary:"Beneficios en canchas y consumo de restaurante.", plans:["brotherhood","girls","duo","circle"], page:"padel-11-11.html"),
        .init(id:"gingers", name:"Ginger's Coffee House", category:"Gastronomía", summary:"Descuento en bebidas calientes participantes.", plans:["girls","duo","circle"], page:"gingers.html"),
        .init(id:"rancho", name:"Rancho MX", category:"Lifestyle", summary:"Descuentos en productos western seleccionados.", plans:["brotherhood","ranch","duo","circle"], page:"rancho-mx.html"),
        .init(id:"horse", name:"Horse Riding", category:"Experiencias", summary:"Tarifas especiales para paseos a caballo.", plans:everyone, page:"horse-riding.html"),
        .init(id:"marea", name:"Marea Baja", category:"Experiencias", summary:"Clases de surf con precio preferencial para miembros.", plans:["brotherhood","girls","duo","circle"], page:"marea-baja.html"),
        .init(id:"fishing", name:"Vaca Fishing", category:"Experiencias", summary:"Pesca y beneficios por duración de reservación.", plans:["brotherhood","duo","circle"], page:"dia-de-pesca.html"),
        .init(id:"velamar", name:"Velamar", category:"Viajes", summary:"Acceso a información sobre alojamientos y condiciones preferenciales.", plans:everyone, page:"velamar.html"),
        .init(id:"ceramia", name:"Cera Mía", category:"Experiencias", summary:"Experiencias de cerámica y promociones seleccionadas.", plans:["girls","duo","circle"], page:"cera-mia.html"),
        .init(id:"buns", name:"Buns & Bros", category:"Gastronomía", summary:"Platillo especial ALIGN pendiente de publicación definitiva.", plans:everyone, page:"buns-and-bros.html"),
        .init(id:"boris", name:"Boris Marisquería", category:"Gastronomía", summary:"Descuentos según día de la semana y consumo mínimo.", plans:everyone, page:"boris-marisqueria.html"),
        .init(id:"greencabana", name:"Green Cabana", category:"Gastronomía", summary:"Promociones para consumo individual y reservaciones elegibles.", plans:["brotherhood","girls","duo","circle"], page:"green-cabana.html"),
        .init(id:"mrsmoky", name:"Mr Smoky", category:"Gastronomía", summary:"Platillo exclusivo ALIGN pendiente de publicación definitiva.", plans:everyone, page:"restaurantes.html"),
        .init(id:"studiopalmas", name:"Studio Palmas", category:"Lifestyle", summary:"Experiencias de fotografía para la comunidad.", plans:everyone, page:"studio-palmas.html"),
        .init(id:"veterinaria", name:"Veterinaria", category:"Servicios", summary:"Beneficio pendiente de publicación oficial.", plans:everyone, page:nil),
        .init(id:"nuvello", name:"Nuvello", category:"Bienestar", summary:"Promociones en servicios de imagen y bienestar.", plans:everyone, page:"nuvello.html"),
        .init(id:"dentistajessica", name:"Jessica Manzur", category:"Salud", summary:"Promociones dentales en servicios participantes.", plans:everyone, page:"jessica-manzur.html"),
        .init(id:"luxeria", name:"La Luxería", category:"Bienestar", summary:"Beneficios de Laser Spa y paquetes ALIGN seleccionados.", plans:["girls","duo","circle"], page:"la-luxeria.html"),
        .init(id:"pokai", name:"Pokai Pokes & Bowls", category:"Gastronomía", summary:"Descuento para miembros; no acumulable con otras promociones.", plans:everyone, page:"pokai.html"),
        .init(id:"lauranader", name:"Laura Nader · Odonto", category:"Salud", summary:"Promociones de odontología seleccionada en Nuvello.", plans:everyone, page:"laura-nader.html")
    ]
}

struct PartnersScreen: View {
    @EnvironmentObject private var session: MemberSession
    @State private var search = ""

    private var available: [Partner] {
        let plan = session.primary?.planKey ?? ""
        return Partner.catalog
            .filter { $0.available(for: plan) }
            .filter {
                search.isEmpty ||
                $0.name.localizedCaseInsensitiveContains(search) ||
                $0.category.localizedCaseInsensitiveContains(search)
            }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Explora los lugares y experiencias de tu membresía. Las promociones requieren validación del QR y están sujetas a las condiciones del aliado.")
                        .foregroundStyle(ALIGNStyle.muted)
                        .listRowBackground(ALIGNStyle.navy)
                }

                ForEach(available) { partner in
                    NavigationLink(value: partner) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(partner.category.uppercased())
                                .font(.system(size: 10, design: .monospaced))
                                .tracking(1.2)
                                .foregroundStyle(ALIGNStyle.gold)
                            Text(partner.name)
                                .font(.system(size: 20, design: .serif))
                                .foregroundStyle(ALIGNStyle.ivory)
                            Text(partner.summary)
                                .font(.caption)
                                .foregroundStyle(ALIGNStyle.muted)
                        }
                        .padding(.vertical, 9)
                    }
                    .listRowBackground(ALIGNStyle.navy)
                }
            }
            .scrollContentBackground(.hidden)
            .background(ALIGNStyle.night)
            .searchable(text: $search, prompt: "Busca un aliado")
            .navigationTitle("Aliados")
            .navigationDestination(for: Partner.self) { partner in
                PartnerDetailScreen(partner: partner)
            }
        }
    }
}

private struct PartnerDetailScreen: View {
    let partner: Partner

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(partner.category.uppercased())
                    .font(.system(size: 11, design: .monospaced))
                    .tracking(2)
                    .foregroundStyle(ALIGNStyle.gold)

                Text(partner.name)
                    .font(.system(size: 40, design: .serif))

                Text(partner.summary)
                    .foregroundStyle(ALIGNStyle.muted)

                Label("Presenta tu QR activo y revisa las condiciones antes de aplicar cualquier promoción.", systemImage: "checkmark.shield")
                    .font(.subheadline)

                if let path = partner.page,
                   let url = URL(string: "https://alignmembers.com.mx/" + path) {
                    Link(destination: url) {
                        Label("Ver condiciones oficiales", systemImage: "arrow.up.right.square")
                            .frame(maxWidth: .infinity)
                            .padding(16)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(ALIGNStyle.night)
                    .background(ALIGNStyle.ivory)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    Text("Las condiciones específicas se publicarán próximamente.")
                        .foregroundStyle(ALIGNStyle.muted)
                }
            }
            .padding(24)
        }
        .background(ALIGNStyle.night.ignoresSafeArea())
        .navigationTitle(partner.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
