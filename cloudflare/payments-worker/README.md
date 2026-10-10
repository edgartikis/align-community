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
- `GET /api/monthly-qr` — QR dinámico vigente; rota automáticamente cada 15 minutos.
- `GET /api/validate-member` — validación del QR.
- rutas de visitas/registro utilizadas por `portal-aliados.html`.

## Estado LIVE y validación previa a desplegar

El código del repositorio define `STRIPE_MODE = "live"`, pero **esto no prueba qué versión está desplegada actualmente**. Antes del despliegue o de abrir ventas al público, comprobar en `GET https://api.alignmembers.com.mx/api/health` que:

- `ok: true`, `storage: "kv-ready"`, `stripeMode: "live"`.
- `stripeApi`, `stripeWebhook` y `stripePrices` estén en `"configured"`.
- En Stripe Live, el webhook apunta a `https://api.alignmembers.com.mx/api/stripe/webhook` y recibe `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` y `customer.subscription.deleted`.
- Revisar entregas y respuestas del webhook en Stripe Live; tener el endpoint habilitado no prueba que todas las entregas hayan funcionado.

Validación end-to-end controlada, **solo después de la autorización del titular**: registro → Checkout Live → activación en KV → login → facturación → tarjeta y QR → escaneo de aliado → renovación → pago fallido → cancelación. Nunca provocar pagos reales o alterar suscripciones sin aprobación.

## Variables y secretos en Cloudflare

- `STRIPE_MODE`: `"live"` o `"test"`.
- `STRIPE_SECRET_KEY_LIVE` / `STRIPE_WEBHOOK_SECRET_LIVE`: producción.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: entorno de pruebas, **no se utilizan** cuando el modo es `live`.
- `QR_SIGNING_SECRET`: recomendado como secreto **fijo**, independiente de Stripe, compartido por la emisión y validación de QR y por sesiones de aliados. Confirmar que existe antes de cambiar el modo o rotar claves: si falta, el sistema utiliza la clave privada del modo activo y al cambiarla podrían invalidarse QR/sesiones emitidos previamente.
- `PAYMENT_STATE`: KV operativo para membresías, periodos de cobro, tarjetas y QR.
- `ALIGN_DB_URL` / `ALIGN_DB_SECRET`: sincronización secundaria para reportes, opcional.

Las fechas de renovación se obtienen de `subscription.items.data[0].current_period_start/end` cuando Stripe las proporciona; se mantiene compatibilidad con los campos históricos del objeto `subscription`. Ante fechas faltantes o inválidas no se extiende la membresía de forma inventada; el webhook responde con error recuperable para que Stripe reintente la sincronización.

Comprobar sin cargos: `node --test tests/stripe-runtime.test.mjs`, `python scripts/check_backend_contract.py` y `node --check cloudflare/payments-worker/src/*.js` (cada archivo individual). Los checks se ejecutan en pull requests a `main`. Ningún secreto se almacena en GitHub.

## Código legado

Los directorios `/netlify` y `/functions` corresponden a prototipos/migraciones anteriores. **No deben recibir tráfico de producción ni usarse para nuevas funciones.** Se conservan temporalmente únicamente como referencia hasta completar la prueba integral de Stripe TEST; después pueden eliminarse del árbol principal porque el historial de Git ya conserva sus versiones anteriores.

El frontend operativo debe apuntar a `https://api.alignmembers.com.mx/api/...`.
