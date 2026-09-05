# ALIGN Payments · Cloudflare + Stripe

Este módulo prepara pagos reales recurrentes para ALIGN sin exponer claves privadas en GitHub Pages.

## Flujo

1. `signup.html` reúne los integrantes.
2. `pago.html` enviará el registro a `POST /api/checkout`.
3. El Worker guarda el borrador temporalmente en Cloudflare KV.
4. Stripe Checkout cobra la suscripción mensual.
5. Stripe llama `POST /api/stripe/webhook`.
6. El Worker valida la firma de Stripe y registra/actualiza la membresía en la base de ALIGN.
7. Renovaciones, pagos fallidos y cancelaciones se sincronizan por webhook.

## Planes previstos

- The Brotherhood: $249 MXN / mes
- Girls Club: $249 MXN / mes
- Cowboys: $249 MXN / mes (se conserva la key técnica `ranch` por compatibilidad con la web actual)
- Duo Club: $349 MXN / mes
- Private Circle: $499 MXN / mes

Los planes individuales usan el precio fundador actual. Cuando termine la etapa fundador, se cambia el Price ID utilizado para altas nuevas; las suscripciones existentes conservan su precio en Stripe.

## Seguridad

- Nunca guardar `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ni `ALIGN_DB_SECRET` en GitHub.
- El frontend nunca recibe la clave privada de Stripe.
- Los datos de tarjeta no pasan por ALIGN: Stripe Checkout los procesa directamente.
- El Worker guarda el registro previo al pago en KV durante 48 horas y Stripe recibe solo un identificador opaco.
- El webhook valida `Stripe-Signature` antes de procesar eventos.

## Variables / secretos del Worker

Variables públicas:

- `SITE_ORIGIN=https://alignmembers.com.mx`

Secretos:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BROTHERHOOD`
- `STRIPE_PRICE_GIRLS`
- `STRIPE_PRICE_RANCH`
- `STRIPE_PRICE_DUO`
- `STRIPE_PRICE_CIRCLE`
- `ALIGN_DB_URL`
- `ALIGN_DB_SECRET`

Binding:

- `PAYMENT_STATE`: namespace KV para borradores e idempotencia de webhooks.

## Eventos Stripe manejados

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Base de producción

El archivo `integrations/align-production-db/Code.gs` es el conector de Google Sheets para producción. Usa Script Properties:

- `SPREADSHEET_ID`
- `ALIGN_DB_SECRET`

No reutilizar el secreto de Stripe como secreto de la base.

## Antes de activar cobros reales

1. Crear/verificar la cuenta de Stripe de ALIGN.
2. Crear los cinco productos y Price IDs mensuales en MXN.
3. Crear un Google Sheet separado para producción y desplegar el Apps Script de producción.
4. Crear el namespace KV en Cloudflare.
5. Desplegar el Worker y asociar la ruta `alignmembers.com.mx/api/*`.
6. Configurar el webhook de Stripe hacia `https://alignmembers.com.mx/api/stripe/webhook`.
7. Probar todo con claves `sk_test_...` y Price IDs de modo TEST.
8. Solo después cambiar a claves/Price IDs LIVE.
9. Actualizar `pago.html` para eliminar la simulación y enviar el checkout al Worker.

## Nota

Este backend se agregó en una rama separada para no afectar el sitio público mientras Cloudflare termina de activar el dominio y mientras Stripe sigue sin credenciales de producción configuradas.
