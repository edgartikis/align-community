# ALIGN iOS — preparación para TestFlight (versión 0.2.0, build 2)

**Estado:** candidato de prueba local, preparado en GitHub. **NO SUBIDO A TESTFLIGHT NI ENVIADO A APP STORE.**
La autorización otorgada el 12 de octubre de 2026 abarca preparar el código, comprobarlo y documentarlo, no publicar ni invitar a usuarios.

## Funciones de esta versión
- Nombre visible: **ALIGN**; Bundle Identifier: `mx.com.alignmembers.app` (confirmar disponibilidad en Apple Developer).
- Inicio de sesión con credenciales existentes; sesión guardada en el llavero de iOS, no en UserDefaults.
- Pantalla de bienvenida con campos de alto contraste y capa de privacidad al enviar la app a segundo plano.
- Panel de visitas, ahorros y consumos con margen suficiente para la barra flotante de iOS.
- Tarjeta QR con **ciclo de 15 minutos** impuesto por Cloudflare, sin alterar el backend; oculta el código visual al vencer o al suspenderse la app.
- Directorio de aliados y pantalla de cuenta.
- **No hay compras, nuevas suscripciones ni emisión de Apple Wallet**; Apple Wallet se mantiene exclusiva para la cuenta Founder Lifetime.

## Pruebas obligatorias ANTES de autorizar una subida

| Caso | Resultado requerido |
|---|---|
| Instalación nueva | Pantalla ALIGN y acceso a cuenta de prueba, sin pedir permisos ajenos al propósito |
| Inicio con contraseña incorrecta | Error apropiado, sin guardar sesión |
| Login válido y reconexión | Sesión reanudada solo desde Keychain |
| Membresía vencida/revocada | NO mostrar un QR utilizable; backend deniega operaciones |
| QR en el minuto de corte | No mostrar el QR anterior después de `qrValidUntil`; debe obtener el siguiente |
| App en segundo plano / selector de apps | Ocultar nombre, código, QR, visitas y ahorros en la vista de privacidad |
| Duo / Circle | Elegir integrante y ver el QR correspondiente sin mezclar cuentas |
| Historial / barra inferior | Ninguna fila tapada; contenido navegable y accesible |
| Aliados | Promociones no inventadas; comprobar catálogo contra página web y convenio actual |
| Cerrar sesión | Eliminar tokens locales de Keychain y limpiar pantallas |
| Sin conexión / errores | No mostrar estadísticas falsas como actuales; no dejar QR vencidos |
| Acceso con VoiceOver / letra grande | Controles legibles, QR con aviso textual y acciones accesibles |

## Bloqueos para distribuir a revisores externos o publicar

1. **Sesión y QR:** el backend actual reutiliza un hash de contraseña como autenticador y acepta tokens de socio en parámetros URL; el QR web contiene información sensible y su firma no impide copiarla durante su vigencia. La capa de privacidad de iOS y Keychain ayudan, pero **NO reparan el servidor**. Planear endpoints con sesiones de corta duración y QR opacos con autorización robusta en otra PR, con pruebas en KV Preview antes de autorizar despliegue real.
2. **Cuenta de revisión:** crear una cuenta de demostración separada, con información ficticia y sin pagos reales. Nunca entregar credenciales del propietario a revisores ni subir el QR en capturas.
3. **Privacidad y derechos:** completar el aviso de privacidad específico de iOS y los campos App Privacy de App Store Connect. Evaluar eliminación de cuenta iniciable desde la app o una página directa; si el servicio permite crear cuentas en la web, se debe cumplir el requisito de Apple. Un correo de soporte por sí solo puede no ser suficiente.
4. **Ofertas:** el catálogo de 23 aliados es una instantánea de compilación. Antes de abrir la beta, contrastarlo contra los convenios y conectar una API pública versionada para evitar descuentos obsoletos.
5. **Términos de pago:** la app no incluye cobros ni botones de compra. Revisar con Apple la aplicación de sus reglas sobre bienes/servicios presenciales versus prestaciones digitales antes de añadir ventas.
6. **Firma y soporte:** verificar Apple Developer Team, Bundle ID, certificado de distribución y generación de perfil; revisar los errores de firma de Xcode antes de archivar.
7. **Notificaciones / analítica:** esta versión no añade publicidad, rastreadores ni notificaciones. Cualquier SDK añadido requiere evaluación de privacidad independiente.

## Ficha propuesta para TestFlight

- **Nombre:** ALIGN
- **Idioma principal:** español (México)
- **Versión:** 0.2.0 (2)
- **Descripción beta propuesta:** `ALIGN reúne en un solo lugar tu membresía, tarjeta digital, aliados, experiencias y el registro de tus visitas y ahorros. Esta versión es de prueba y puede cambiar antes del lanzamiento.`
- **Qué probar:** `Inicio y cierre de sesión, vigencia de la membresía, tarjeta QR temporal, historial de visitas, búsquedas de aliados y navegación. No registrar consumos ficticios ni compartir imágenes del QR.`
- **Contacto de retroalimentación:** confirmar el correo de soporte operativo y accesible antes de cargarlo en App Store Connect.
- **Website:** `https://alignmembers.com.mx`
- **URL de privacidad:** `https://alignmembers.com.mx/aviso-privacidad.html` (pendiente adecuación a iOS).
- **Capturas de App Store:** preparar SIN QR reales, credenciales ni datos identificables.

## Cuando se autorice expresamente la primera subida

1. Ejecutar en Mac `git pull` sobre `feature/align-ios-native-app-20261012` y luego `cd ios/ALIGN && xcodegen generate`.
2. Abrir `ALIGN.xcodeproj`, seleccionar Apple Developer Team de pago y validar el identificador `mx.com.alignmembers.app`.
3. Probar `Product > Build` en un iPhone físico y confirmar todos los escenarios anteriores.
4. Crear ficha de **ALIGN** en `https://appstoreconnect.apple.com` si no existe, especificar perfil legal de privacidad, contacto de soporte y materiales.
5. Tras una NUEVA AUTORIZACIÓN, ejecutar `Product > Archive` y distribuir a App Store Connect / TestFlight. Comenzar con pruebas **internas** limitadas. External testing puede requerir revisión Apple.
6. TestFlight permite que cada compilación se pruebe por un máximo de 90 días.
7. Pedir una autorización distinta para enviar a revisión pública de la App Store.

Referencias:
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/

**No realizar deploy de Cloudflare ni activar Wallet general como parte de esta rama.**
