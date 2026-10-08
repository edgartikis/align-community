# Apple Wallet — integración ALIGN (rama de pruebas)

## Estado
Preparación técnica. No habilitar botón de Wallet hasta que exista un endpoint autenticado que genere un .pkpass válido.

## Hallazgos del sitio
- `member.html` obtiene el socio desde `https://api.alignmembers.com.mx/api/member-card?token=...`.
- Las tarjetas de grupo usan `group-cards` y tokens individuales.
- `monthly-qr` devuelve una URL de validación con vencimiento y se renueva cada 15 minutos.
- `member-activity` devuelve historial y ahorros.
- Por tanto, **no** copiar la URL temporal de `monthly-qr` a un pase persistente.

## Requisitos de backend
1. Endpoint autenticado `GET /api/wallet/apple?token=<token-del-socio>` que valide el token, la membresía activa y el miembro específico (incluidos Duo/Circle). Responder con `application/vnd.apple.pkpass`, `Content-Disposition: attachment; filename="ALIGN.pkpass"` y `Cache-Control: no-store`. No registrar tokens completos.
2. Construir un paquete PassKit con `pass.json`, iconos y logotipo, `manifest.json`, firma PKCS#7 y zip `.pkpass`.
3. `passTypeIdentifier`: `pass.mx.com.alignmembers.membership`. Verificar `teamIdentifier` exacto en Apple Developer; no inventarlo.
4. Cargar el P12 y su contraseña solo desde secretos de servidor; nunca subirlos a GitHub ni incluirlos en JavaScript del navegador.
5. Usar `serialNumber` estable y único por persona, con datos mínimos: nombre, nivel, código de socio y vigencia. No exponer tokens privados en el QR.
6. Para el QR de Wallet, usar un identificador opaco estable validado **en el servidor** con comprobación de estado actual, expiración y revocación. Idealmente, el escáner autenticado del aliado consulta la API, aplica controles anti-reutilización y muestra foto/nombre para verificación. Si se requiere rotación cada 15 minutos también en Wallet, implementar actualizaciones PassKit (webServiceURL, authenticationToken, push) y considerar que las actualizaciones no son instantáneas: no prometer equivalencia con QR dinámico.
7. Configurar `webServiceURL` y actualizaciones de pase para reflejar renovación, suspensión y cancelación; el backend siempre debe ser autoridad de vigencia.
8. Tras pruebas de seguridad y firma, agregar botón oficial “Agregar a Apple Wallet” en `member.html` que descargue el pase del miembro seleccionado; ocultarlo o deshabilitarlo si el servicio no está listo.

## Verificación
- Confirmar qué infraestructura sirve `api.alignmembers.com.mx` y su repositorio/código fuente antes de implementar endpoint.
- Prueba con cuenta de prueba, renovación y membresía cancelada.
- Verificar iPhone: instalación, firma, visualización, escaneo en portal de aliado, Duo/Circle, renovación y revocación.
- Mantener `main` y producción sin cambios hasta revisión y aprobación.
