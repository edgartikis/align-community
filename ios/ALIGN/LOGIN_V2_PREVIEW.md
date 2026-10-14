# ALIGN — autenticación de socios V2 (PREVIEW ÚNICAMENTE)

**Estado:** código en la rama `feature/align-ios-native-app-20261012`, PR #39.
Ningún despliegue, publicación de TestFlight/App Store o cambio de producción queda
autorizado por incorporar estos archivos. Requiere revisión y autorización explícita
antes de actualizar siquiera el Worker Preview.

## Aislamiento obligatorio
- Producción: `MEMBER_PASSWORD_V2 = "false"`. Continúa usando su login V1;
  no se alteran Stripe Live, datos de socios o accesos reales.
- Preview: `MEMBER_PASSWORD_V2 = "true"`, pero sólo funciona si
  `MEMBER_LOGIN_GUARD`, `ALIGN_APP_QR_ROTATION_ENABLED` están activados y
  `STRIPE_MODE = "test"`; KV y secretos deben seguir aislados.
- Endpoint nuevo `POST /api/member-login-v2`, campos JSON `username`, `password`.
  Usar exclusivamente HTTPS y nunca registrar la contraseña.
- Con V2 habilitado en Preview, `/api/member-login` responde HTTP 426 para
  impedir el replay del SHA-256 que enviaba el cliente V1. En producción V2
  responde 404 y V1 conserva su funcionamiento previo.
- **Al activar V2 en Preview, la app TestFlight 0.2.0 (6) anterior NO podrá
  iniciar sesiones nuevas.** Se necesita una compilación Preview posterior con
  el cliente V2 para reanudar pruebas desde iPhone. No publicar sin permiso.

## Migración controlada
1. El usuario ficticio se crea inicialmente con el formato V1 de las pruebas.
2. Al iniciar sesión por HTTPS con la contraseña correcta y V2, el servidor
   verifica una única vez el SHA-256 heredado y crea un verificador PBKDF2-HMAC-SHA256
   con sal aleatoria de 128 bits y 600 000 iteraciones.
3. El registro `account:<username>` pasa a `version: 2` y deja de guardar
   `passwordHash`. Los accesos siguientes verifican PBKDF2 y nunca retroceden
   al hash V1; un nuevo intento de activación no sobrescribe el verificador.
4. Se conservan las sesiones autenticadas de duración actual (12 horas). El
   rediseño de sesiones/revocación requiere un plan independiente.

## Límites por resolver antes de producción
- El flujo de registro/activación web todavía origina `passwordHash` en
  `draft:` y otros registros heredados. **V2 no erradica esos hashes** y esta
  migración sólo es válida para cuentas ficticias de Preview.
- PBKDF2 es una mejora sobre el SHA-256 simple, pero se debe revisar la política
  final de contraseñas, gestión de recuperación, MFA opcional, rotación de sesiones,
  migración completa de registros y posibles alternativas tipo Argon2id.
- Los contadores de fallos siguen basados en KV (consistencia eventual), no son
  un rate limiter distribuido definitivo. No considerar esto autorización para
  encender la función en producción ni para cuentas reales.
- La app previamente instalada debe probarse de nuevo con una nueva compilación
  interna de Preview antes de declarar exitosa la migración del cliente.

## Verificaciones sin tocar producción
- En GitHub Actions deben pasar `tests/member-password-v2.test.mjs`,
  `tests/member-login-guard.test.mjs` y la compilación SwiftUI.
- Sólo con aprobación adicional se podrá desplegar mediante:
  `npx wrangler preview --config cloudflare/payments-worker/wrangler.toml --name align-qr-pilot --ignore-base-config`
- Después de un despliegue Preview aprobado:
  `node scripts/verify-align-login-guard-preview.mjs`
- Para un usuario sintético en Preview:
  `node scripts/prepare-align-ios-preview.mjs setup`, y al terminar
  `node scripts/prepare-align-ios-preview.mjs cleanup`.
- Nunca enviar contraseñas, tokens, certificados ni secretos al chat.
