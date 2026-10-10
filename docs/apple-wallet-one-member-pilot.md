# Apple Wallet — piloto privado de UNA membresía real

**Estado: preparado en GitHub; no fusionar, desplegar ni activar sin nueva autorización.**

Objetivo: permitir una **sola prueba de emisión** del pase oficial .pkpass de ALIGN desde Cloudflare usando los certificados Apple que ya están guardados como secretos. La emisión general permanece desactivada (`WALLET_ENABLED=false`), sin modificar Stripe Live, QR web, renovaciones ni precios.

## Controles de seguridad del piloto

- La nueva ruta `POST /api/wallet/pilot` solo acepta solicitudes a `https://api.alignmembers.com.mx`, enviadas desde `Origin: https://alignmembers.com.mx`. El token del socio viaja en el cuerpo POST, nunca en una URL.
- Para funcionar debe cumplir tres condiciones que **no se activan en este PR**:
  - `WALLET_PILOT_ENABLED=true`, inicialmente `false` en producción y Preview.
  - `WALLET_PILOT_TOKEN_SHA256` (Secret) es una huella SHA-256 de 64 caracteres hexadecimales del token de **un solo integrante**, no el token sin procesar. No compartir el token en mensajes.
  - `WALLET_PILOT_EXPIRES_AT` (Variable) es una fecha ISO UTC en el futuro y no más de 12 horas después del momento de uso; se recomienda una ventana de 1 hora.
- El socio debe existir en el KV de producción con estado `Activa`, fechas **explícitas** `validFrom` y `validUntil` y código de socio real distinto de `ALIGN-TEST-*`. No se genera una membresía ni se cobra por emitir Wallet.
- El QR que genera Wallet usa un identificador aleatorio de 128 bits almacenado como `wallet:id:<id>` en KV. El lector de aliados usa el validador existente para el **QR actual de 15 minutos**, y durante la prueba acepta únicamente el token cuyo hash esté autorizado. Pasado el vencimiento, deja de adaptar los QR del piloto automáticamente.
- Un QR de Wallet es persistente y puede capturarse: el aliado debe revisar identidad y vigencia al registrar la visita. Una renovación no actualiza los campos visibles del pase sin implantar PassKit Push/APNs.
- El emisor solo recibe certificados de Apple almacenados en secretos de Cloudflare (`WALLET_SIGNER_CERT_PEM`, `WALLET_SIGNER_KEY_PEM`, `WALLET_WWDR_PEM`, `WALLET_SIGNER_KEY_PASSPHRASE`). Nunca subir PEM, .p12 o contraseñas a GitHub.

## Etapas futuras — autorización separada

1. **Ahora:** revisar el PR, ejecutar pruebas y Wrangler `--dry-run`. No fusionar.
2. **Después de la autorización para desplegar infraestructura:** desplegar rama con `WALLET_PILOT_ENABLED=false`, `WALLET_ENABLED=false`, sin agregar todavía `WALLET_PILOT_TOKEN_SHA256` ni fecha de vencimiento; verificar `/api/health` y `/api/wallet/status`.
3. **Después de una segunda autorización para probar la emisión:** iniciar sesión como socio titular desde `https://alignmembers.com.mx` con el mismo navegador, abrir `wallet-pilot.html` y pulsar **Copiar huella SHA-256 de mi sesión**. Configurar **solo la huella**, como secreto `WALLET_PILOT_TOKEN_SHA256` en Cloudflare. No ponerla en chat o repositorios. Comprobar primero que corresponda al integrante previsto.
4. Configurar `WALLET_PILOT_EXPIRES_AT` a una fecha ISO UTC una hora después y finalmente `WALLET_PILOT_ENABLED=true`. **No modificar `WALLET_ENABLED`**.
5. Abrir `wallet-pilot.html` en iPhone con sesión activa, pulsar **Obtener pase de prueba**. El backend debe responder con `application/vnd.apple.pkpass`. Instalar, revisar diseño, confirmar QR y escanearlo con una sesión autorizada del portal de aliados. Sin cobros.
6. Desactivar `WALLET_PILOT_ENABLED` al finalizar, incluso si la fecha sigue vigente. Confirmar que el portal rechaza la emisión y nuevos escaneos piloto. El pase instalado puede permanecer en Wallet, pero la validación del piloto quedará apagada.

## Validación automatizada

Los tests generan certificados efímeros ficticios, producen un .pkpass y verifican su contenido; también comprueban rechazo de miembros no autorizados, ventanas vencidas, membresías canceladas, periodos sin vigencia explícita, origen distinto y tarjeta de Preview. No certifican todavía compatibilidad con un iPhone real ni la disponibilidad de las credenciales de Cloudflare. En ningún punto se hacen compras de Stripe.

**Límite conocido:** la seguridad del endpoint depende de la posesión del token vigente de socio; el valor SHA-256 no sustituye autenticación. La página de prueba toma el token de la sesión existente, no pide contraseñas adicionales. No utilizar en cuentas distintas ni habilitar como emisión pública.
