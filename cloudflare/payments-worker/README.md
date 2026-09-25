# ALIGN API · Backend canónico

Este directorio es el **único backend operativo que debe usarse para producción**.

## Arquitectura oficial

- API pública: `https://api.alignmembers.com.mx`
- Runtime: Cloudflare Worker `align-payments`
- Entry point: `src/main.js`
- Fuente operativa de verdad: Cloudflare KV `PAYMENT_STATE`
- Pagos: Stripe Checkout + suscripciones mensuales
- Webhook: `POST /api/stripe/webhook`
- Sitio público: `https://alignmembers.com.mx`

`ALIGN_DB_URL` / `ALIGN_DB_SECRET` se consideran una **sincronización secundaria para reportes**. No deben sustituir a `PAYMENT_STATE` como fuente operativa para acceso, vigencia, tarjetas o QR.

## Rutas activas

El Worker actual expone, entre otras, estas rutas:

- `GET /api/health` — estado del backend y modo Stripe (`test` / `live`).
- `POST /api/checkout` — crea Stripe Checkout para la membresía elegida.
- `POST /api/stripe/webhook` — procesa pagos, renovaciones, fallos y cancelaciones.
- `GET /api/activate-membership` — activa/recupera una compra completada.
- `POST /api/member-login` — acceso del titular.
- `GET|POST /api/member-billing` — estado de mensualidad, cancelación al fin del periodo, reactivación, cambio de tarjeta y resuscripción segura.
- `GET /api/member-card` — información de tarjeta vigente.
- `GET /api/group-cards` — tarjetas de Duo / Private Circle.
- `GET /api/member-activity` — visitas, gasto, ahorro y lugares frecuentes.
- `POST /api/upload-profile-photo` — foto del socio.
- `GET /api/monthly-qr` — QR vigente.
- `GET /api/validate-member` — validación del QR.
- `GET /api/wallet/options` — disponibilidad de Apple Wallet / Google Wallet.
- `GET /api/wallet/google` — genera el enlace firmado para guardar la membresía como Generic Pass en Google Wallet.
- `GET /api/wallet/apple` — entrega el `.pkpass` firmado por el servicio de firma de ALIGN.
- rutas de visitas/registro utilizadas por `portal-aliados.html`.

## Flujo que debe quedar probado antes de LIVE

1. Registro de integrantes.
2. Checkout Stripe TEST.
3. `checkout.session.completed`.
4. Creación de grupo y tarjetas en KV.
5. Login del titular.
6. QR válido con vigencia correcta.
7. Registro de visita por aliado.
8. `invoice.paid` reactiva/renueva.
9. `invoice.payment_failed` cambia a pago pendiente.
10. `customer.subscription.deleted` deja la membresía inactiva.

Solo después de completar este recorrido se cambia Stripe a LIVE.

## Variables / secretos

Configuración no secreta: `wrangler.toml`.

Secretos en Cloudflare:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `QR_SIGNING_SECRET` (opcional)
- `ALIGN_DB_URL` / `ALIGN_DB_SECRET` (reportes secundarios)

Wallet:
- `GOOGLE_WALLET_ISSUER_ID` — Issuer ID de Google Wallet.
- `GOOGLE_WALLET_CLIENT_EMAIL` — correo de la cuenta de servicio autorizada.
- `GOOGLE_WALLET_PRIVATE_KEY` — **secret** PKCS#8 de la cuenta de servicio.
- `APPLE_WALLET_SIGNER_URL` — endpoint HTTPS del firmador de pases de ALIGN.
- `APPLE_WALLET_SIGNER_SECRET` — **secret** compartido con el firmador.

La tarjeta de Wallet usa un código opaco propio (`/w/...`) que no expone el token del socio y valida la vigencia actual en tiempo real. Cuando el portal del aliado escanea ese código, el Worker lo traduce internamente al QR mensual vigente de ALIGN antes de continuar con la validación existente. Así el pase puede permanecer en Wallet entre renovaciones sin volver a agregarse cada mes. Google se firma en el Worker con RS256. Apple requiere un paquete `.pkpass` firmado con el certificado del Pass Type ID y el certificado intermedio de Apple, por lo que el Worker delega únicamente esa firma/compresión al firmador configurado.

Nunca deben guardarse secretos, certificados ni llaves privadas en GitHub.

## Código legado

Los directorios `/netlify` y `/functions` corresponden a prototipos/migraciones anteriores. **No deben recibir tráfico de producción ni usarse para nuevas funciones.** Se conservan temporalmente únicamente como referencia hasta completar la prueba integral de Stripe TEST; después pueden eliminarse del árbol principal porque el historial de Git ya conserva sus versiones anteriores.

El frontend operativo debe apuntar a `https://api.alignmembers.com.mx/api/...`.
