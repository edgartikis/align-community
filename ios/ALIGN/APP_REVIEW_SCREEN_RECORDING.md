# ALIGN iOS — excepción temporal de grabación para App Review

## Propósito
Permitir que el fundador muestre el QR real de ALIGN en una grabación realizada con su iPhone para la revisión de Apple, sin cambiar el portal web ni los endpoints de Cloudflare.

## Alcance exacto
- Únicamente en la configuración **Release** de la app nativa oficial (esquema `ALIGN`).
- Únicamente para la tarjeta verificada como `MemberCard.isOwner` (`planKey == "owner"` y `memberCode == "AL-FOUNDER-001"`).
- La grabación de pantalla no reemplaza el QR con el aviso de privacidad para esa tarjeta.
- Cualquier otra tarjeta, incluida una tarjeta adicional de una cuenta grupal, conserva el bloqueo durante grabación. `Debug` y `ALIGN Preview` conservan el bloqueo.
- **Sin cambios** a la caducidad del QR, verificación de membresía en el servidor, suspensión de app, protección de vistas en segundo plano, captura de imagen fija y invalidación del código cuando aplique.
- Las capturas de pantalla continúan mostrando el aviso y la lógica de rotación existente (si el backend está habilitado).
- La excepción no activa el QR protegido de producción ni modifica Stripe, Wallet o los secretos del servidor.

## Riesgo
Una grabación del fundador podrá contener el QR visible, que podría ser reutilizable durante su vigencia si otra persona obtiene el video. No compartirla públicamente. Subirla únicamente al canal de revisión oficial y evitar incluir otros datos sensibles.

## Restauración después de la revisión
La excepción se controla en `ios/ALIGN/Sources/MemberQRScreen.swift`, en `AppReviewCapturePolicy`.

1. Cambiar `static let allowFounderRecording = true` por `false` en la rama de **Release**.
2. Actualizar las pruebas en `ios/ALIGN/Tests/release-readiness.test.mjs` para exigir protección también en Founder.
3. Compilar, probar en iPhone físico y subir una **nueva build** a App Store Connect; aprobar o distribuir esta build según el flujo de Apple.
4. Confirmar en la versión publicada que el QR vuelve a ocultarse durante la grabación.

**La aprobación inicial no desactiva automáticamente el permiso**: es necesaria una nueva compilación de la app.

Estado: excepción aplicada en el código de la rama de iOS; no equivale a una versión subida a TestFlight ni aprobada por Apple.
