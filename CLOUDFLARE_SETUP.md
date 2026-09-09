# ALIGN · Backend Cloudflare actual

El backend de producción ya no se define por Cloudflare Pages Functions/D1. La arquitectura canónica está en:

`cloudflare/payments-worker/`

Documentación principal:

`cloudflare/payments-worker/README.md`

## Arquitectura vigente

- Sitio: `https://alignmembers.com.mx`
- API: `https://api.alignmembers.com.mx`
- Worker: `align-payments`
- Entry point: `cloudflare/payments-worker/src/main.js`
- Fuente operativa de verdad: Cloudflare KV `PAYMENT_STATE`
- Pagos: Stripe Checkout mensual
- Webhook: `https://api.alignmembers.com.mx/api/stripe/webhook`

Los antiguos `/functions` (Pages/D1) y `/netlify` son legado y no deben usarse para funciones nuevas ni recibir tráfico de producción.

## Verificación

Abre:

`https://api.alignmembers.com.mx/api/health`

La respuesta debe indicar:

- `ok: true`
- `architecture: "cloudflare-worker-kv"`
- `storage: "kv-ready"`
- `stripeMode: "test"` mientras se realizan pruebas

## Stripe TEST antes de LIVE

Mantener una clave `sk_test_...`/`rk_test_...` y el webhook TEST hasta completar:

1. registro;
2. checkout;
3. activación;
4. login;
5. tarjeta y QR;
6. visita en portal de aliados;
7. renovación;
8. pago fallido;
9. cancelación.

Eventos necesarios:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Paso a LIVE

Solo cuando el recorrido TEST esté certificado:

1. configurar `STRIPE_SECRET_KEY` LIVE en Cloudflare;
2. crear un webhook LIVE para `https://api.alignmembers.com.mx/api/stripe/webhook`;
3. guardar su nuevo `STRIPE_WEBHOOK_SECRET`;
4. confirmar que `/api/health` reporte `stripeMode: "live"`;
5. ejecutar una compra real controlada;
6. verificar pago → activación → login → QR → renovación/cancelación.

No se guardan claves privadas ni signing secrets en GitHub.
