# Activación segura de Stripe → ALIGN COMMUNITY

El archivo `netlify/functions/stripe-webhook.mjs` recibe pagos de Stripe y crea un socio en la primera pestaña de Google Sheets. Nunca pegues claves en este archivo ni en el chat.

## 1. Antes de activar

1. En Stripe, revoca la clave secreta de prueba que se compartió anteriormente y crea una nueva.
2. Crea una cuenta de servicio de Google Cloud, habilita Google Sheets API y comparte esta hoja con el correo de esa cuenta como **Editor**.

## 2. Variables en Netlify

En **Project configuration → Environment variables**, añade:

| Variable | Valor |
| --- | --- |
| `STRIPE_SECRET_KEY` | Nueva clave secreta de Stripe (prueba o producción) |
| `STRIPE_WEBHOOK_SECRET` | Secreto que Stripe muestra al crear el endpoint |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON completo de la cuenta de servicio de Google, en una sola línea |
| `GOOGLE_SHEET_ID` | `1-uT_2WD9VBaCOizT8q6kSGsLgDW-8KbRgDYzKUyj4Z4` |
| `GOOGLE_SHEET_TAB` | Opcional. Déjalo vacío para usar `Hoja 1` |
| `STRIPE_SOCIETY_PRICE_ID` | ID del precio mensual Society en Stripe |
| `STRIPE_BLACK_PRICE_ID` | ID del precio mensual Black en Stripe |
| `MEMBER_BASE_URL` | Dominio de ALIGN, por ejemplo `https://aligncommunity.netlify.app` |

## 3. Webhook en Stripe

Después de desplegar, en Stripe crea un endpoint con esta URL:

`https://aligncommunity.netlify.app/.netlify/functions/stripe-webhook`

Selecciona el evento `checkout.session.completed`.

Una vez activado, cada pago de membresía añadirá una nueva fila con QR seguro y código de socio. Apple Wallet/Google Wallet se integran como la siguiente capa: necesitan una cuenta de emisor y no deben emitirse desde una hoja de cálculo directamente.
