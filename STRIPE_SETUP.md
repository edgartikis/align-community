# Stripe → ALIGN

> Documento actualizado. Las instrucciones antiguas de Netlify/Google Sheets quedaron retiradas del flujo operativo.

El backend oficial es el Cloudflare Worker ubicado en `cloudflare/payments-worker/` y la API pública es:

`https://api.alignmembers.com.mx`

Consulta también `cloudflare/payments-worker/README.md`.

## Stripe TEST

Mantén Stripe en TEST mientras validamos el flujo completo.

En Cloudflare configura como secretos:

- `STRIPE_SECRET_KEY` — clave TEST actual.
- `STRIPE_WEBHOOK_SECRET` — signing secret del webhook TEST.
- `QR_SIGNING_SECRET` — opcional; recomendado separado de Stripe antes de LIVE.

Los Price IDs no secretos están definidos en `cloudflare/payments-worker/wrangler.toml`.

## Webhook oficial

Endpoint:

`https://api.alignmembers.com.mx/api/stripe/webhook`

Eventos:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

No crear nuevos webhooks hacia Netlify.

## Comprobación antes de cobrar dinero real

`https://api.alignmembers.com.mx/api/health` debe responder `ok: true`, `storage: "kv-ready"` y `stripeMode: "test"`.

Después se debe completar una prueba integral de compra, activación, login, QR, visita, renovación, fallo de pago y cancelación.

## Paso a LIVE

1. Sustituir `STRIPE_SECRET_KEY` por una clave LIVE en Cloudflare.
2. Crear un webhook LIVE con la misma URL de la API.
3. Sustituir `STRIPE_WEBHOOK_SECRET` por el secreto LIVE correspondiente.
4. Confirmar que `/api/health` muestre `stripeMode: "live"`.
5. Hacer una compra real controlada.
6. Validar tarjeta, QR, estado de membresía y renovación/cancelación.

Nunca pegar claves secretas o `whsec_...` en GitHub.
