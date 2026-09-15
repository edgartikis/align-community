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
- `GET /api/member-card` — información de tarjeta vigente.
- `GET /api/group-cards` — tarjetas de Duo / Private Circle.
- `GET /api/member-activity` — visitas, gasto, ahorro y lugares frecuentes.
- `POST /api/upload-profile-photo` — foto del socio.
- `GET /api/monthly-qr` — QR vigente.
- `GET /api/validate-member` — validación del QR.
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

Nunca deben guardarse secretos en GitHub.

## Código legado

Los directorios `/netlify` y `/functions` corresponden a prototipos/migraciones anteriores. **No deben recibir tráfico de producción ni usarse para nuevas funciones.** Se conservan temporalmente únicamente como referencia hasta completar la prueba integral de Stripe TEST; después pueden eliminarse del árbol principal porque el historial de Git ya conserva sus versiones anteriores.

El frontend operativo debe apuntar a `https://api.alignmembers.com.mx/api/...`.
