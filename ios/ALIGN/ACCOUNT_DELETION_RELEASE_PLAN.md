# ALIGN iOS 1.0 (9) — decisión y plan de lanzamiento de eliminación de cuenta
Fecha: 19 octubre 2026. Rama: `feature/align-ios-native-app-20261012`; PR #39 DRAFT.
**Este documento NO autoriza desplegar, publicar, cobrar, cancelar ni eliminar datos de producción.**

## Evidencia comprobada (solo entornos de prueba)
- La pantalla SwiftUI `Cuenta > Eliminar cuenta` exige contraseña, texto `ELIMINAR` y segunda confirmación.
- Cloudflare Preview usa KV separado, Stripe Test y Google Sheets QA sintético.
- El 19 oct se completó `scripts/verify-align-account-deletion-preview.mjs --reporting-qa --stripe-test-sub ...`: 23/23 pruebas automáticas aprobadas, segunda autenticación rechazada después de borrar.
- Verificación independiente posterior: la suscripción de **Stripe Test** estaba `canceled` y `livemode=false`; SOCIOS y AFILIADOS del usuario QA quedaron vacíos, VISITAS anonimizada y segunda cuenta ficticia intacta. PAGOS conservó referencias Stripe Customer/Subscription; pendiente política de retención y disociación. **No usar cuentas ni datos reales para repetir la prueba.**
- La cuenta temporal creada por `prepare-align-ios-preview.mjs setup` sirve para probar login/QR/UX, **NO** está autorizada para completar eliminación (allowlist Preview limitada a `qa.delete.fixture2`). No indicar al evaluador que la eliminación temporal ya funciona.

## Implementación de seguridad completada en rama de desarrollo (no desplegada)
- Módulo `src/account-deletion-billing.js`: lectura y validación de **todas** las suscripciones contra un mismo `customerId` verificado antes de emitir un solo `DELETE` de Stripe. Exige coincidencia exacta de ID y estado `canceled` al confirmar. Cuentas sin suscripción no llaman a Stripe; los pagos parcialmente cancelados siguen siendo un caso de reconciliación supervisada.
- `src/member-account-deletion.js`: rechaza el borrado automático si los customer IDs encontrados son ambiguos y exige titular Stripe verificable cuando hay suscripciones. Conserva en `visit:` solo campos contables permitidos y evita nuevos reenvíos a Google Sheets al marcar `dbSynced:true`; descarta notas, datos de contacto, fotos, tokens y campos desconocidos.
- `tests/account-deletion-billing.test.mjs`: pruebas de múltiples suscripciones, titular ajeno, errores de Stripe, cancelaciones no confirmadas, cuentas gratuitas y barreras de producción. `member-account-deletion.test.mjs` añade prueba de minimización de datos, conservando métricas y respetando otras cuentas.
- `.github/workflows/backend-contract.yml` ejecuta las cuatro suites de borrado **offline** en el PR. El paso `Test account deletion isolation and Stripe ownership (offline)` finalizó **success** en GitHub Actions, ejecución `39371191310` (19 oct 2026).
- **Sin permiso de pasar a Live:** se mantienen `MEMBER_ACCOUNT_DELETION_ENABLED=false`, `MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED=false`, `MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED=false` en producción; la puerta del handler sigue exigiendo `STRIPE_MODE=test` y cuenta autorizada de Preview.

## Bloqueos actuales en producción (NO GO)
1. `wrangler.toml`: `MEMBER_ACCOUNT_DELETION_ENABLED=false`, `MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED=false`, `MEMBER_PASSWORD_V2=false`, `MEMBER_LOGIN_GUARD=false`, `ALIGN_APP_QR_ROTATION_ENABLED=false`.
2. `member-account-deletion.js` exige **STRIPE_MODE=test**, autenticación V2, protección de login, QR rotativo y nombre ficticio expresamente autorizado; subir un flag NO lo hace apto para Live.
3. `account-deletion-reporting.js` rechaza deliberadamente `STRIPE_MODE !== test`; la implementación real de Apps Script `anonymize_account` figura en GitHub, pero no está desplegada ni reconciliada con producción.
4. Posibles fallos parciales Stripe → Sheets → KV; el recuperador de KV solo opera en Preview. Definir reconciliación y operador responsable antes de permitir solicitudes reales.
5. Las referencias Stripe en PAGOS y respaldos/exportaciones requieren política de minimización, conservación fiscal/contractual y borrado. Incluir fotografía y consentimientos.
6. La cuenta Founder Lifetime necesita una ruta segura para solicitar y completar eliminación, sin permitir borrado accidental del pase permanente.
7. Build 1.0 (8) cargada en Apple no tiene esta pantalla; código 1.0 (9) de GitHub aún no se ha firmado ni subido. La app oficial Release apunta a producción; no usar un video Debug/Preview como si fuera Release.

## Dos rutas válidas, decisión del propietario pendiente
**A. Solicitud desde la app + procesamiento controlado (preferida por menor riesgo ante fecha cercana).**
Apple permite proceso manual en plazo razonable siempre que el usuario inicie la solicitud dentro de la app, se comunique un plazo concreto y se confirme la finalización. Esto NO equivale a mostrar solamente un correo de soporte ni a desactivar indefinidamente.
- Implementar endpoint Live autenticado que cree **una solicitud durable** (no destructiva) con ID, timestamp, estado, grupo y contacto de respuesta mínimo necesario; admitir repetición sin duplicados; verificar reautenticación, antibruteforce y permisos.
- Cambiar UX Release para decir `Solicitar eliminación de cuenta`, plazo acordado, confirmación `solicitud recibida` únicamente después de persistirla, número de caso y aviso de tratamiento. No mostrar `cuenta eliminada` antes de la ejecución real.
- Designar responsable y horario, canal de aviso fiable, acceso restringido, registro auditado, verificación de identidad, cancelación de renovaciones y cumplimiento efectivo de la eliminación de KV, Sheets, Stripe y datos asociados. Enviar confirmación al socio al finalizar; explicar cualquier retención legal.
- Establecer **un plazo realista que el operador pueda cumplir** antes de publicar. Founder Lifetime debe poder usar un procedimiento de identidad reforzada, no un bloqueo definitivo.
- Probar caso sintético de principio a fin en ambiente aislado y un test Live autorizado con cuenta desechable; monitorear solicitudes acumuladas.

**B. Eliminación automática completa en producción (requiere más validación).**
- Diseñar y probar ruta Live distinta de la allowlist de QA; no reutilizar secretos, URL ni Sheets de prueba.
- Añadir autenticación robusta, autorización por grupo, reautenticación, límites de intentos, protección específica Founder y pruebas de pago/subscripciones de Live con una cuenta Live desechable autorizada.
- Desplegar conector de anonimización de producción con respaldo, identidad Stripe verificada, reintentos idempotentes, reversión segura e inventario de datos y respaldos.
- Implementar reconciliación operativa documentada para fallos parciales y alertas; comprobar que no quedan QR, sesiones o membresías activas, ni cobros posteriores.
- Activar de forma gradual **solo con autorización específica** y verificación del entorno; no hacer un despliegue de todo PR #39 ni mezclar KV Preview/Live.

## Puertas de decisión (cualquiera de las rutas)
- [ ] Propietario elige ruta A o B y aprueba el texto y plazo del servicio.
- [ ] Determinar qué información financiera debe conservarse por ley y cuánto tiempo.
- [ ] Backups/verificación de cobertura de Sheets, KV, fotos, sesiones y terceros.
- [ ] E2E autenticado reproducible para usuario descartable sin exponer terceros.
- [ ] Prueba de fallos/reintentos, doble envío y cancelación de renovación.
- [ ] Caso Founder Lifetime con datos ficticios (no borrar owner real).
- [ ] Demostración en iPhone físico con build **Release oficial** que corresponda a funciones disponibles en Live.
- [ ] Generar archive firmado y subir 1.0(9) solo tras validar el backend y pedir aprobación específica; después completar notas y grabación para App Review.

Referencia Apple: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/

**Estado al documentar:** ninguna modificación realizada en Cloudflare Producción, Stripe Live, Apps Script real, Wallet real o App Store Connect.
