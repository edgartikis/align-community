# ALIGN · Migración de pagos a Cloudflare

Dominio objetivo: `https://alignmembers.com.mx`

## Qué ya está preparado en el repositorio

- Pages Functions bajo `/functions/api/*`.
- D1 como fuente de verdad de cuentas, grupos, miembros, pagos y estado de suscripción.
- Stripe Checkout mensual.
- Webhook idempotente para activación, renovación, pago fallido y cancelación.
- Contraseñas con `scrypt`; nunca se guardan en texto plano ni se mandan a Stripe.
- El sistema actual de Netlify queda intacto durante la migración para no romper la demo.

## 1. Crear el proyecto de Cloudflare Pages

Conecta el repositorio `edgartikis/align-community` desde Workers & Pages > Create > Pages > Connect to Git.

Configuración inicial recomendada:

- Production branch: `main`
- Framework preset: None
- Build command: dejar vacío
- Build output directory: `.`
- Compatibility date: `2026-09-05` o posterior

## 2. Crear D1

Crea una base llamada `align-members-production`.

En el proyecto Pages agrega un binding D1:

- Variable name: `DB`
- Database: `align-members-production`

Ejecuta el contenido de `migrations/0001_align_memberships.sql` en la consola de D1.

## 3. Variables y secrets

En Settings > Variables and Secrets agrega:

- `PAYMENTS_MODE=test` mientras hacemos pruebas.
- `STRIPE_SECRET_KEY` con una clave `sk_test_...`.
- `STRIPE_WEBHOOK_SECRET` después de crear el endpoint en Stripe.

No cambies `PAYMENTS_MODE` a `live` hasta terminar una compra completa en TEST.

## 4. Endpoint de webhook en Stripe TEST

URL:

`https://alignmembers.com.mx/api/stripe-webhook`

Eventos mínimos:

- `checkout.session.completed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copia el signing secret `whsec_...` a `STRIPE_WEBHOOK_SECRET`.

## 5. Verificación del backend

Abre:

`https://alignmembers.com.mx/api/health`

Debe responder con `ok: true` y `database: true`.

## 6. Cambio de frontend

Solo después de que `/api/health` y el webhook estén operativos se cambia `pago.html` para llamar a `/api/create-checkout` y `login-github.html` para usar `/api/member-login`.

Este corte se hará al final para que GitHub Pages/Netlify sigan funcionando mientras configuramos Cloudflare.

## 7. Producción

Después de probar:

1. Cambiar Stripe a claves LIVE.
2. Crear webhook LIVE y guardar su nuevo `whsec_...`.
3. Cambiar `PAYMENTS_MODE=live`.
4. Ejecutar una compra real controlada.
5. Verificar activación, login, QR y renovación/cancelación.
6. Cuando todo esté estable, retirar Netlify.
