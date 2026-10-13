# ALIGN iPhone — control de seguridad previo a TestFlight

Actualizado: 13 de octubre de 2026. **No autoriza publicar, desplegar backend ni distribuir una nueva compilación.**

## Verificaciones realizadas con el propietario en su iPhone (Cloudflare Preview, cuentas ficticias)

- Captura de QR: la app solicita renovación y muestra un QR nuevo.
- Los QR capturados anteriormente fueron rechazados como no válidos/vencidos.
- El QR nuevo fue reconocido como miembro activo.
- Dos capturas consecutivas generaron un tercer QR; las dos imágenes previas fueron rechazadas.
- Sin internet, la app ocultó el QR; al recuperar conexión, volvió a mostrarlo.
- Al borrar la cuenta ficticia de KV Preview, el QR dejó de estar disponible.
- El botón «Volver a iniciar sesión» permitió salir; el cierre de sesión persistió después de reiniciar la app.
- El test automatizado Preview comprobó el rechazo de QR revocado por el escáner y por el registro de visita. Ningún socio, pago o comercio real fue alterado.

**Alcance:** estas verificaciones no prueban que iOS impida capturas (no puede); tampoco garantizan la invalidación instantánea cuando no hay conexión o frente a réplicas hechas antes de que el servidor complete la renovación.

## Importante: Debug y Release NO son equivalentes

- **Debug local / ALIGN Preview:** bundle `mx.com.alignmembers.app.preview`, Keychain aislado, API `https://align-qr-pilot-align-payments.alignservice18.workers.dev`. Allí la invalidación de QR por captura está habilitada exclusivamente para pruebas.
- **Release / TestFlight del bundle original:** bundle `mx.com.alignmembers.app`, API `https://api.alignmembers.com.mx`. **La producción tiene `ALIGN_APP_QR_ROTATION_ENABLED="false"`**, así que no se debe anunciar invalidación por captura en TestFlight ni distribuir esta compilación como si contara con esa protección.
- El workflow `ios-native-check.yml` compila **Debug y Release** para el simulador sin firmar, subir ni publicar.
- No se debe mover la API Preview al bundle de producción ni usar credenciales/membresías reales en Preview.

## Pendientes obligatorios antes de distribuir a otros miembros

1. **Autenticación:** el login vigente envía un hash SHA-256 reutilizable de contraseña como credencial. Migrar de forma compatible a autenticación adecuada, revocación de sesiones, límites de intentos y gestión de credenciales sin afectar los socios existentes.
2. **Autorización y privacidad:** varias rutas de estado/actividad utilizan tokens de miembro en parámetros URL; corregir control de acceso y filtraciones de identificadores, también en el backend y portal de aliados.
3. **Escáner de aliados:** revisar la autenticación actual de aliados y contraseñas derivadas de nombres antes de habilitar el acceso a producción.
4. **QR de producción:** revisión separada del backend, observabilidad, pruebas de concurrencia y revocación, habilitación gradual con reversión posible y **autorización explícita** del propietario.
5. **iPhone y membresías:** pruebas con cuenta de demostración sin datos reales para Duo/Circle, suspensiones, vencimiento, reinicio en segundo plano, fallos de red, escaneos de aliados, accesibilidad, y regresiones de funciones existentes.
6. **Apple:** App Privacy y aviso que cubra iOS, acceso/eliminación de datos, descripción del servicio, URLs legales y soporte, capturas, metadatos y cuenta de demostración para revisión.

## Decisión antes de crear un nuevo TestFlight

**A. Beta privada con backend de pruebas:** preparada en el código con el esquema **ALIGN Private TestFlight**, configuración Release optimizada **PreviewRelease** y bundle ID separado `mx.com.alignmembers.app.preview`. La compilación usa exclusivamente `https://align-qr-pilot-align-payments.alignservice18.workers.dev` y muestra **ALIGN Preview**. El esquema original **ALIGN** conserva el backend de producción en Release. **Preparar esta configuración fue autorizado por el propietario el 13/oct/2026; crear una ficha de App Store Connect, subirla o invitar probadores sigue pendiente de una acción/confirmación explícita por separado.**

Pasos pendientes del propietario (no hechos automáticamente):
1. Abrir [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list) y confirmar que existe un App ID explícito para `mx.com.alignmembers.app.preview` en su cuenta. Si no existe, registrarlo, solo para pruebas.
2. En [App Store Connect](https://appstoreconnect.apple.com/) crear una ficha **nueva y separada**, por ejemplo «ALIGN Preview Privado», plataforma iOS, idioma Español, Bundle ID `mx.com.alignmembers.app.preview`, SKU interno único. No usar la ficha de ALIGN que ya existe.
3. En Mac, actualizar GitHub, regenerar XcodeGen, verificar el esquema **ALIGN Private TestFlight** y seleccionar destino **Any iOS Device (arm64)**. Antes de pulsar Archive, verificar en **Edit Scheme → Archive → Build Configuration = PreviewRelease** y en Build Settings que el Bundle ID es el de Preview.
4. Solo cuando el propietario autorice el siguiente paso, crear archivo firmado y subir como **TestFlight Internal Only**; asignar exclusivamente el usuario interno del propietario sin auto-distribución. Nunca seleccionar **Submit for Review** ni invitar externos.
5. Para entrar, usar solamente socios ficticios en la KV de Preview; `node scripts/prepare-align-ios-preview.mjs setup` genera una cuenta temporal que se limpia con `cleanup`. No enviar contraseñas por chat ni usar login real. Las cuentas expiran y no son cuentas permanentes.

**Advertencia:** en el iPhone, TestFlight puede sustituir la instalación Debug **ALIGN Preview** anterior al compartir el mismo Bundle ID. No toca ni sustituye **ALIGN** real (`mx.com.alignmembers.app`).

**B. TestFlight con backend de producción:** el bundle original ya apunta a producción; antes debe quedar claro qué funciones están activas. La invalidación por captura **no está activada allí**. No subir ni habilitar de forma automática.

Cualquier despliegue de Worker de producción, activación de flags, subida a TestFlight o invitación a evaluadores exige una decisión explícita del propietario.
