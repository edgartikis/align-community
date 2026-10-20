# ALIGN 1.0 (9) · Estado de eliminación de cuenta
Fecha: 19 octubre 2026 · PR #39 · Solo rama de desarrollo, NO fusionado.

## Qué sí quedó validado
- UI nativa `Cuenta → Eliminar cuenta`, contraseña + texto ELIMINAR + segunda confirmación.
- Cloudflare Preview (KV de pruebas independiente): eliminación de una cuenta y tarjetas ficticias, inicio de sesión posterior rechazado.
- Stripe Test real: cliente sin tarjeta y suscripción en prueba `sub_1USBcADMjEcJHlpUJsIkmzbt`, el Worker la consultó en estado `trialing` y la canceló; Stripe confirmó después `status=canceled`, `livemode=false`.
- Pruebas locales simuladas para sesiones, Duo/Circle, intentos de contraseña, protección Founder, Stripe caído, rastros KV y hoja secundaria de reportes.
- Compilación oficial candidata **ALIGN 1.0 (9)** configurada en `ios/ALIGN/project.yml`, bundle de producción `mx.com.alignmembers.app`. La compilación de Preview mantiene su bundle independiente y fue elevada también al build 9 para pruebas privadas de la pantalla.

## Riesgos que BLOQUEAN despliegue y envío a revisión
1. **La ruta Live sigue deshabilitada** en `cloudflare/payments-worker/wrangler.toml` y además el Worker tiene una segunda barrera que exige `STRIPE_MODE=test`, contraseña V2 y nombre de prueba autorizado. Nunca cambiar ambas barreras sin terminar revisión y aceptación.
2. El registro real de pagos y visitas utiliza **Google Apps Script + Google Sheets**, repositorio `integrations/align-production-db/Code.gs`. Se implementó la acción `anonymize_account`, diseñada para limpiar datos personales preservando métricas y referencias de auditoría. Está **solo en GitHub** y no ha sido desplegada a Apps Script ni integrada al procedimiento del Worker de producción. Probar primero con copia del Sheet y respaldo. Definir retención fiscal/legal antes de usar.
3. La eliminación KV conserva registros monetarios anonimizados; hay que validar eliminación de **datos externos y respaldos**, además de un procedimiento de reconciliación de fallos parciales entre Stripe, Sheets y KV. La imagen de perfil se guarda en KV como `member.photoUrl` (data URI JPEG), y se elimina con la tarjeta; revisar backups y exportaciones.
4. **Founder Lifetime** necesita un control adicional: el código para revocar `owner-lifetime:primary` y `wallet:member:AL-FOUNDER-001` está preparado bajo `MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED=false` y la identidad canónica del titular. No se ha probado con el propietario real ni activado. Nunca probar con la membresía Founder de producción.
5. El backend usa KV, con consistencia eventual. Deben probarse nuevamente las verificaciones de sesión, QR y webhook después de activar la nueva versión en un ambiente aislado. Implementar manejo reanudable para eliminaciones interrumpidas.
6. No se ha preparado un archivo firmado ni subido **1.0 (9)** a TestFlight. La app **1.0 (8)** no tiene la nueva pantalla. Requiere Mac/Xcode del titular.
7. El mensaje de la app promete eliminación final; **no debe enviarse esta build a App Review con el endpoint Live devolviendo 503**.

## Hoja de validación completamente ficticia
- Google Sheet creada en Drive: `ALIGN · QA eliminación de cuenta — datos ficticios — 19 oct 2026`
- ID: `1SGcKQHHlmC3O1eM0PnWO_XQiKm_QDrNKTeBLiiYE2P8`
- Pestañas de prueba: SOCIOS, AFILIADOS, PAGOS, VISITAS, ALIADOS; registros ficticios de dos cuentas sin correos, pagos o datos reales.
- La función `anonymizeAccount_` fue ejecutada el 19-oct-2026 desde el proyecto aislado `ALIGN QA - Eliminación de cuenta`, usando `inspeccionarCuentaQA` y `ejecutarEliminacionQA` (archivo `integrations/align-test-db/QA_EliminacionCuenta.gs`). Registro: `QA FINALIZADA`, con 1 socio, 1 afiliado, 1 visita y 1 pago anonimizados. Una lectura independiente de Drive confirmó que la segunda cuenta ficticia y sus datos siguen intactos, mientras la visita del primer socio conserva solo datos económicos y el nombre genérico `Cuenta eliminada`. **No** conectar este script o Sheet a producción, ni desplegarlo como Web App.
- El Google Sheets real de ALIGN no fue modificado.

## Integración Apps Script ↔ Cloudflare Preview (preparada, no publicada)
- Worker: `cloudflare/payments-worker/src/account-deletion-reporting.js`, llamado desde `member-account-deletion.js` solamente al habilitar `MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED=true`. Exige exactamente un Stripe Customer identificable y confirmación `ok:true,anonymized:true` de Google antes de borrar datos en KV. Si falla Google, conserva los registros y devuelve error; Stripe ya podría haber quedado cancelado, por lo que es imprescindible una reconciliación reanudable antes del lanzamiento.
- El flag sigue **false en producción**. En la rama de desarrollo se preparó **true solamente para Preview** y únicamente la cuenta desechable `qa.delete.fixture2`; se registraron los secretos QA por separado. **Hay que sincronizar y desplegar esa revisión exclusivamente a Cloudflare Preview.** No se ha ejecutado aún la solicitud integrada de anonimización desde el Worker.
- Archivo QA para añadir como **segundo archivo** al proyecto aislado: `integrations/align-test-db/QA_EliminacionEndpoint.gs`. Su `doPost` exige una propiedad secreta `ALIGN_QA_DELETE_SECRET`, proyecto vinculado a la hoja sintética y exactamente `qa.delete.fixture2` / `cus_fakeqa1`.
- Pendientes de aceptación explícita del titular: incorporar archivo al editor QA, configurar un secreto privado, desplegar una aplicación web solo de pruebas, resembrar la cuenta ficticia anonimizada y validar un nuevo flujo Preview→Apps Script→Stripe Test→KV. **No** usar el Apps Script ni la hoja de producción.

- El script `scripts/verify-align-account-deletion-preview.mjs --reporting-qa` crea una cuenta temporal en KV Preview con `customerId:cus_fakeqa1` (ID ficticio de Sheets), verifica contraseña/estado, envía el borrado y exige que la cuenta ya no pueda acceder. **No incluye suscripción Stripe** porque `cus_fakeqa1` no es un cliente real de Stripe. La prueba con Stripe Test ya se realizó por separado. No mezclar ambas opciones sin alinear la identidad del cliente en los tres servicios.

## Secuencia responsable para terminar
1. En copia de Sheets, desplegar el `Code.gs` de pruebas y verificar anonimización exclusiva, retención fiscal y reintento idempotente.
2. Integrar desde el Worker un contrato de anonimización con respuesta confirmada. Exigir disponibilidad externa ANTES de marcar la cuenta como eliminada.
3. Añadir estado de eliminación reanudable, pruebas de caídas parciales y criterio operativo de retención; probar fundador con datos totalmente ficticios.
4. Probar en Cloudflare Preview también el paso Sheets (sin usar la base real).
5. Activar Live con dos controles y despliegue previamente autorizados, monitorear con cuenta REAL de prueba descartable del entorno Live sin transacciones reales.
6. Generar y firmar ALIGN 1.0 (9) en Xcode, subir a TestFlight, instalar en iPhone, probar flujos. Después reemplazar el binario enviado a App Review, registrar notas y vídeo de dispositivo físico.

## Comandos de CI (no hacen despliegue)
```bash
node --test cloudflare/payments-worker/tests/member-account-deletion.test.mjs \
  cloudflare/payments-worker/tests/member-account-deletion-http.test.mjs \
  cloudflare/payments-worker/tests/reporting-account-erasure.test.mjs
```

**Sin cambios en producción, Apple Wallet real ni membresías de clientes a causa de estos commits.**
