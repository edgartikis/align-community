# Renovación de QR por captura — piloto de ALIGN

Estado: **implementado en rama de desarrollo, sin desplegar al público**.

## Alcance aprobado
- App iOS: el QR normal sigue cambiando cada 15 minutos.
- Si iOS avisa que se tomó una captura **y el servidor habilitó la función**, la app oculta su QR, envía un POST autenticado con la revisión anterior y solicita una nueva. En fallo conserva oculto el QR y ofrece reintentar, sin fingir que la captura fue invalidada.
- El backend usa un código `/q/A...` exclusivo de la app, independiente del QR web. El código incluye un identificador de ruta opaco derivado con HMAC, no el token del socio.
- Los portales `/api/ally/scan` y `/api/ally/visit` comprueban la revisión activa directamente con un Durable Object. No se convierte a firmas HMAC heredadas.
- La web sigue con su QR de 15 minutos; **no se modificó Apple Wallet**.

## Endpoints y protección
- `GET /api/app-qr?token=...` requiere `Authorization: Bearer <member-session>`. Valida que la tarjeta pertenece al mismo grupo de la sesión, el estado y la vigencia.
- `POST /api/app-qr`: JSON `{ "token": "...", "previousCode": "A..." }` y la misma sesión. Si el código anterior ya cambió, responde `409`; no gira de nuevo a ciegas.
- Sin el flag `ALIGN_APP_QR_ROTATION_ENABLED=true`, estos endpoints responden 404 y la app conserva la ruta de 15 minutos existente.
- **Producción: false. Preview: true en configuración, con PAYMENT_STATE de preview segregado.** Esto NO despliega por sí mismo.
- `APP_QR_AUTHORITY` es un binding de Cloudflare Durable Objects de almacenamiento SQLite y usa la migración `align-app-qr-sqlite-v1`.
- `ALIGN_APP_QR_SECRET` es un secreto privado, obligatorio, de al menos 32 caracteres. Debe configurarse por separado para el Preview, jamás en el repositorio. Sin binding/secreto, el endpoint falla con 503.
- Código aleatorio opaco: las URLs visibles del QR de la app no contienen tokens de miembro.

## Limitaciones críticas antes de producción
1. **Ya se migró el puntero de revisión activa desde Cloudflare KV a un Durable Object por socio.** Pendiente demostrar en Cloudflare Preview (no basta un mock): 2 teléfonos o regiones, rotaciones concurrentes, fallos de red, borrado de sesión, expiración y escáner de aliados. Hasta hacerlo no afirmar disponibilidad ni revocación instantánea en producción.
2. Una captura de iOS puede utilizarse **antes** de que la app reciba la notificación y el servidor confirme el cambio. iOS no ofrece bloqueo garantizado de screenshots; navegadores tampoco ofrecen detección universal.
3. Las sesiones de miembro vencen a las 12 horas. La app debe mostrar un inicio de sesión nuevo si la sesión no es válida. No usar tokens embebidos en QR como credenciales de renovación.
4. El backend heredado usa tokens en URLs y contraseñas hasheadas reutilizables. Este prototipo no resuelve esa deuda de seguridad.
5. Se requiere una cuenta sintética en KV preview (sin socios reales), desplegar **solo** un Worker Preview tras aprobación, configurar `ALIGN_APP_QR_SECRET` privado en Preview, pruebas de iPhone + escáner + visita, y autorización explícita antes de cualquier cambio en producción. **No desplegar `wrangler deploy` de producción**.
6. El cliente iOS actual apunta a `https://api.alignmembers.com.mx`. Para pruebas reales de Preview, configurar explícitamente una URL de API de pruebas en compilación de desarrollo; no redirigir la app instalada hacia Preview de manera silenciosa.

## Pruebas automatizadas
`node --test tests/app-qr-capture.test.mjs` comprueba: flag apagado y compatibilidad web, rechazo de sesiones sin permiso, generación, cambio, bloqueo del QR anterior en página y portal de aliados, prevención de doble rotación, y rechazo del enlace expandido si se intenta reutilizar tras la captura.

La compilación 5 es **una versión de desarrollo**, no debe sustituir todavía a la versión beta 4 probada por el propietario.
