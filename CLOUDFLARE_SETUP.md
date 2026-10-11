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

## Verificación LIVE sin tocar producción

El repositorio declara `STRIPE_MODE="live"`; confirma el modo **efectivamente desplegado** en
`https://api.alignmembers.com.mx/api/health`. La respuesta debe incluir
`ok:true`, `stripeMode:"live"`, `storage:"kv-ready"` y
`stripeApi`, `stripeWebhook`, `stripePrices` configurados.

Las credenciales nunca se publican en GitHub. Cloudflare debe almacenar
`STRIPE_SECRET_KEY_LIVE` y `STRIPE_WEBHOOK_SECRET_LIVE` para Live,
`STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` para Test.
Mantén `QR_SIGNING_SECRET` fijo y separado para evitar invalidar QR
y sesiones de aliados al rotar claves.

Stripe Live debe tener un endpoint activo
`https://api.alignmembers.com.mx/api/stripe/webhook` con los eventos:
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated` y `customer.subscription.deleted`.
Revisar el historial de entregas: endpoint activo no equivale a entregas exitosas.

Las correcciones de facturación y vigencia se validan automáticamente en un PR:
`node --test tests/stripe-runtime.test.mjs` y
`python scripts/check_backend_contract.py`.
La prueba de cobro real / renovación / cancelación exige aprobación expresa
antes de ejecutarla. Los cambios en esta rama de GitHub **no despliegan producción**.

## Plan seguro para `QR_SIGNING_SECRET`

**No añadir el secreto en Cloudflare antes de desplegar el código compatible de la rama #29.** El código actualmente desplegado usa el secreto de forma inmediata si aparece.

1. Primero, previa autorización, desplegar el código de compatibilidad con `QR_SIGNING_CUTOVER` ausente/`false` y sin `QR_SIGNING_SECRET`. Comprobar que los QR antiguos y el portal de aliados funcionen.
2. Solo entonces crear `QR_SIGNING_SECRET` como *Secret* usando 32 bytes aleatorios (por ejemplo, `openssl rand -hex 32` generado localmente, sin compartirlo). Con el flag apagado no cambia la firma.
3. Antes de activar el flag, agregar `QR_LEGACY_ACCEPT_UNTIL` con hora UTC ISO 8601 aproximadamente 13 horas después del inicio previsto. Mantener las claves antiguas sin rotar hasta concluir la transición.
4. Con nueva autorización, poner `QR_SIGNING_CUTOVER=true`. Verificar `qrSigningMode: dedicated`, `qrSigningReady: true` y `qrLegacyGrace: active` en `/api/health`; validar Wallet, QR corto y sesión de aliado iniciada antes del corte.
5. Pasadas las 13 horas, las firmas antiguas ya no se aceptan. El secreto independiente permanece fijo.

Si hay un problema durante la ventana, se puede volver a `QR_SIGNING_CUTOVER=false` temporalmente, sin borrar el secreto ni modificar pagos. Revisar el procedimiento completo en `cloudflare/payments-worker/README.md`.

**No fusionar, desplegar, hacer cambios en Cloudflare ni pruebas con dinero real sin autorización específica.**
