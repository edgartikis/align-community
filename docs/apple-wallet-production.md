# ALIGN — Apple Wallet oficial (preparación para producción)

**Estado: rama `feature/wallet-production-members-20261009`, SIN DESPLEGAR.** No fusionar a `main` sin autorización explícita. La rama parte del Worker actual de Cloudflare y preserva las correcciones Stripe Live, periodos y QR.

## Diseño (conservar sin modificar)
Se reutiliza el generador existente del prototipo `feature/apple-wallet-align`: edición negra, letras plateadas, esquina azul metálica, borrego auténtico de ALIGN, retrato de Wallet tipo Poster Generic, franja inferior integrada y lema `BELONG TO SOMETHING`. Se conserva el QR nativo de Apple Wallet. **Sin foto de perfil en el pase.** La foto y el QR dinámico de la página web siguen siendo independientes. No modificar los recursos `wallet-black.js`, `wallet-borrego-asset.js`, `wallet-inter-font-*.js` ni el fondo sin solicitar confirmación.

## Asociación con una membresía REAL
- `GET /api/wallet/apple?token=<token-socio>` busca `member:<token>` en `PAYMENT_STATE`, exige estado `Activa` y vigencia real antes de emitir. Rechaza `ALIGN-TEST-*` en producción; no consume ni transfiere identidades del KV de Preview.
- El pase contiene un código QR opaco y estable: `https://api.alignmembers.com.mx/api/wallet/verify/<id>`. `wallet:id:<id>` apunta al token de socio únicamente en KV. No aparece el token del socio en el QR.
- Cada miembro de Duo y Private Circle obtiene su propio identificador y pase; `wallet:member:<memberCode>` conserva el mismo identificador al volver a descargar.
- Un escaneo desde el portal de aliados traduce de forma interna el QR de Wallet al QR de 15 minutos **para el socio ACTIVO**, luego pasa al verificador normal del portal y comprueba vigencia, saldo de mensualidad y sesión del aliado. No se aceptan QR del dominio de Preview en producción.
- La tarjeta instalada no se invalida al terminar una mensualidad, pero su QR **se rechazará** cuando el estado en KV deje de ser `Activa` o expire la vigencia; al pagar/renovar, recupera acceso automáticamente si la sincronización de Stripe actualiza KV.
- El QR de Wallet es permanente y por eso **puede fotografiarse y compartirse**: el aliado debe comparar la identidad y registrar el beneficio por su sesión autenticada. La tarjeta en Wallet no sustituye la verificación en el servidor.
- Información visible (nombre, ahorro, vencimiento) dentro del pase puede quedar **desactualizada** tras renovar; para actualizarla en Wallet automáticamente se requiere implantar PassKit web-service + APNs por separado. **No afirmar** actualización visual en tiempo real mientras ese servicio no exista.

## Puesta en marcha: pendiente de autorización
1. Revisar los tests de GitHub y compilar Worker con Wrangler `--dry-run` (sin desplegar).
2. Confirmar credenciales Apple auténticas: Team ID, Pass Type ID `pass.mx.com.alignmembers.membership`, certificado, WWDR y clave privada, y que el certificado corresponda a ese Pass Type ID. **Jamás subir/pegar** PEM, contraseñas o `.p12` a GitHub ni al chat. Actualmente el código incorpora el Team ID de la prueba anterior; verificar con el Developer Account.
3. Confirmar dimensiones y presentación de iconos y logos en iOS real. Los PNG actuales son los del prototipo y requieren comprobación en el dispositivo antes del lanzamiento.
4. Preparar certificados en **Cloudflare Production** únicamente después de la aprobación de despliegue, almacenados como Secrets `WALLET_SIGNER_CERT_PEM`, `WALLET_SIGNER_KEY_PEM`, `WALLET_WWDR_PEM`, `WALLET_SIGNER_KEY_PASSPHRASE` si aplica; variable `WALLET_TEAM_ID`. El código mantiene `WALLET_ENABLED=false` hasta la aprobación final.
5. Probar en iPhone real: instalación de pase, escaneo del código real por un aliado, renovación/cancelación, doble escaneo, Duo/Circle, acceso tras reactivación. No generar un pago nuevo sin autorización.
6. Solo entonces, con un nuevo permiso, desplegar y activar emisión; retirar del Wallet del dispositivo la tarjeta antigua de **Preview**, instalando una nueva tarjeta oficial. El pase antiguo `ALIGN-TEST-0001` nunca debe convertirse en socio real por sí solo.

**Seguridad:** `STRIPE_MODE=live` sigue intacto y `QR_SIGNING_CUTOVER` no se activa. Se conserva `WALLET_ENABLED=false` y el entorno Preview usa otro KV, también con Wallet deshabilitado, hasta una prueba explícitamente aprobada.
