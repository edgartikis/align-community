# ALIGN Wallet Sandbox

Backend alternativo para Apple Pay / Google Pay de prueba sin depender de Netlify.

## Configuración

1. Crea un proyecto en Google Apps Script y pega `Code.gs`.
2. En **Project Settings → Script Properties** agrega `STRIPE_TEST_SECRET` con una clave que empiece por `sk_test_`.
3. Despliega como **Web app** con acceso para cualquier persona que tenga el enlace.
4. Copia la URL terminada en `/exec` y colócala en `wallet-sandbox-config.js`.

La función rechaza cualquier clave que no sea de prueba y crea sesiones Stripe Checkout en modo `payment` para que Apple Pay / Google Pay puedan aparecer cuando el dispositivo y la cuenta Sandbox sean compatibles.
