# ALIGN para iPhone — primera versión nativa (SwiftUI)

Estado: **prototipo funcional para compilar y probar, NO publicado ni aprobado por Apple**.

## Qué está incluido

- Inicio de sesión real con el backend actual: `POST /api/member-login`.
- Datos de membresía y vigencia: `GET /api/member-card`.
- Tarjeta QR rotativa de 15 minutos: `GET /api/monthly-qr`. Para Duo y Circle, selector por integrante.
- Panel de visitas, consumo y ahorro: `GET /api/member-activity`.
- Directorio nativo de los 23 aliados que ALIGN tiene registrados, con filtros por plan, búsquedas y enlaces a sus condiciones.
- Cierre de sesión y almacenamiento de tokens **solo en Keychain**.
- Enlaces a aviso de privacidad, términos y correo de soporte.
- No hay cobros, altas, cambios de planes ni pases Apple Wallet para socios nuevos. **WALLET_ENABLED permanece desactivado**; Founder Lifetime conserva su tarjeta separada.

## Cómo abrir el proyecto en la Mac del propietario

Requisitos: macOS con Xcode completo, Command Line Tools y Homebrew. No necesitas compartir tu Apple ID, certificados o claves con nadie.

Desde la raíz del repositorio:

```bash
git switch feature/align-ios-native-app-20261012
git pull --ff-only origin feature/align-ios-native-app-20261012
brew install xcodegen
swift ios/ALIGN/scripts/generate-app-icon.swift assets/align-primary.png ios/ALIGN/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
cd ios/ALIGN
xcodegen generate
open ALIGN.xcodeproj
```

En Xcode selecciona el target **ALIGN** > **Signing & Capabilities** > tu propio equipo Apple Developer. Comprueba que el bundle ID `mx.com.alignmembers.app` esté disponible; si ya existe en tu cuenta, cambia solo ese ID. Selecciona un simulador de iPhone o tu iPhone físico y pulsa **Run**.

No habilites distribución pública ni App Store Connect todavía. No captures ni envíes contraseñas, QR en alta definición, tokens ni certificados.

## Antes de subir a TestFlight / App Store

1. **Compilación real** y prueba en un iPhone; CI en GitHub puede detectar errores de Swift pero no prueba el dispositivo.
2. Revisar sesión nativa, reingreso, logout, Duo/Circle, suspensión por vigencia, QR expirado, conectividad lenta, accesibilidad y que un aliado verifique el QR sin registrar consumo ficticio.
3. El backend actual **recibe el hash de contraseña reutilizable**, expone tokens de socio en query parameters de algunos endpoints y los incluye en el QR web de 15 minutos. Migrar a sesiones cortas con endpoints autenticados y códigos QR opacos antes del lanzamiento público; las peticiones HTTPS y Keychain mejoran el cliente, pero **no solucionan esa deuda de seguridad del servidor**.
4. Trasladar catálogo y promociones de aliados a una API oficial versionada. Esta versión usa una instantánea local con enlaces a condiciones actuales; puede quedarse obsoleta.
5. Publicar una política de privacidad que cubra explícitamente iOS, sus categorías de datos, controles y procedimiento de solicitud de eliminación; completar App Privacy en App Store Connect. La app todavía no tiene flujo de creación de cuentas; si se añade, incluir eliminación dentro de la app conforme a los lineamientos vigentes.
6. Preparar una cuenta de demostración **sin datos personales ni cargos reales** para el equipo de revisión. No ofrecer al revisor credenciales de producción del propietario.
7. Determinar con Apple la clasificación de pagos de la membresía. Como piloto, esta app es de **acceso y uso de membresía existente**, sin flujos de pago. Los bienes/servicios presenciales suelen seguir las reglas de compras fuera de la app; otras prestaciones digitales pueden implicar compras dentro de la app.
8. Confirmar nombre, bundle ID, icono, textos legales, capturas de pantalla, categoría, edad, soporte y condiciones de la cuenta Apple Developer.

## Publicación futura (tras autorización expresa)

En Xcode > **Product > Archive** > **Distribute App > TestFlight & App Store**. Crear primero la ficha en [App Store Connect](https://appstoreconnect.apple.com/). Probar con TestFlight y, cuando las verificaciones estén aprobadas, enviar a **App Review**.

Apple Developer Program tiene una cuota anual; se gestiona únicamente en la cuenta de Apple del titular. El repositorio no contiene credenciales, perfiles de firma ni certificados.

## Arquitectura

```text
SwiftUI en iPhone
  -> HTTPS https://api.alignmembers.com.mx
  -> Worker Cloudflare: align-payments
  -> PAYMENT_STATE (KV) / servicios de membresía existentes
```

Los pases nativos de Apple Wallet siguen independientes y limitados al propietario. **No desplegar cambios en Worker ni habilitar WALLET_ENABLED por esta app.**
