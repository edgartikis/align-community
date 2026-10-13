# Renovación de QR por captura — piloto de ALIGN

Estado: **implementado en rama de desarrollo, sin desplegar al público**.

## Alcance aprobado
- App iOS: el QR normal sigue cambiando cada 15 minutos.
- Si iOS avisa que se tomó una captura **y el servidor habilitó la función**, la app oculta su QR, envía un POST autenticado con la revisión anterior y solicita una nueva. En fallo conserva oculto el QR y ofrece reintentar, sin fingir que la captura fue invalidada.
- El backend usa un código `/q/A...` exclusivo de la app, independiente del QR web.
- Los portales `/api/ally/scan` y `/api/ally/visit` comprueban la revisión activa de ese código.
- La web sigue con su QR de 15 minutos; **no se modificó Apple Wallet**.

## Endpoints y protección
- `GET /api/app-qr?token=...` requiere `Authorization: Bearer <member-session>`. Valida que la tarjeta pertenece al mismo grupo de la sesión, el estado y la vigencia.
- `POST /api/app-qr`: JSON `{ "token": "...", "previousCode": "A..." }` y la misma sesión. Si el código anterior ya cambió, responde `409`; no gira de nuevo a ciegas.
- Sin el flag `ALIGN_APP_QR_ROTATION_ENABLED=true`, estos endpoints responden 404 y la app conserva la ruta de 15 minutos existente.
- **Producción: false. Preview: true en configuración, con PAYMENT_STATE de preview segregado.** Esto NO despliega por sí mismo.
- Código aleatorio opaco: las URLs visibles del QR de la app no contienen tokens de miembro.

## Limitaciones críticas antes de producción
1. Cloudflare KV es eventualmente consistente. Aunque las pruebas locales rechazan el QR anterior tras el cambio, **no se puede garantizar invalidación inmediata en todas las regiones**. Migrar el puntero de revisión activa a **Durable Objects u otro almacenamiento de lectura fuertemente consistente**, probar concurrencia, caídas de red, múltiples regiones y recuperar un estado confirmado antes de habilitar producción.
2. Una captura de iOS puede utilizarse **antes** de que la app reciba la notificación y el servidor confirme el cambio. iOS no ofrece bloqueo garantizado de screenshots; navegadores tampoco ofrecen detección universal.
3. Las sesiones de miembro vencen a las 12 horas. La app debe mostrar un inicio de sesión nuevo si la sesión no es válida. No usar tokens embebidos en QR como credenciales de renovación.
4. El backend heredado usa tokens en URLs y contraseñas hasheadas reutilizables. Este prototipo no resuelve esa deuda de seguridad.
5. Se requiere una cuenta sintética en KV preview (sin socios reales), despliegue **solo** de preview tras aprobación, pruebas de iPhone + escáner + visita, y autorización explícita antes de cualquier cambio en producción.

## Pruebas automatizadas
`node --test tests/app-qr-capture.test.mjs` comprueba: flag apagado y compatibilidad web, rechazo de sesiones sin permiso, generación, cambio, bloqueo del QR anterior en página y portal de aliados, prevención de doble rotación, y rechazo del enlace expandido si se intenta reutilizar tras la captura.

La compilación 5 es **una versión de desarrollo**, no debe sustituir todavía a la versión beta 4 probada por el propietario.
