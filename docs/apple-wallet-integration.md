# ALIGN Apple Wallet · instalación y seguridad

## Estado — 8 de octubre de 2026
Implementación en `feature/apple-wallet-align` (NO fusionar en `main` todavía). Código de emisión, verificación y adaptador del escáner listo para evaluación; **todavía no se ha probado una firma Apple real ni un escaneo E2E**.

- El botón en `member.html` está oculto mientras `GET /api/wallet/status` indique `available:false`.
- `WALLET_ENABLED = "false"` por defecto en `cloudflare/payments-worker/wrangler.toml`.
- Backend: `cloudflare/payments-worker/src/apple-wallet.js`, aislado de Stripe.
- Emisión: `GET /api/wallet/apple?token=<token-del-integrante>` exige membresía activa y foto, crea un pase de tipo `storeCard` y lo firma con `passkit-generator`. No devolverá pase si no están configurados los secretos.
- Verificación: el QR contiene un identificador aleatorio opaco `/api/wallet/verify/<id>`; la ruta revisa `PAYMENT_STATE` en cada escaneo, sin colocar el token privado en el QR.
- Escáner: `POST /api/ally/scan` y `/api/ally/visit` pueden transformar el QR de Wallet a un QR rotativo válido antes de pasar por el flujo existente. El escáner debe seguir autenticando aliados y verificando fotografía.
- Duo y Circle utilizan el token del integrante actualmente seleccionado; cada integrante recibe un pase con identificador independiente.

## Tareas previas a activación
1. Obtener **Team ID exacto** de Apple Developer (no confundir con Organization Unit de otro certificado).
2. En la **Mac del propietario**, extraer localmente del `ALIGN_Wallet.p12` el certificado PEM y la clave privada PEM protegida con contraseña. Convertir también el WWDR G4 oficial a PEM. **No subir ni compartir .p12, PEM o contraseña en chat ni GitHub**. Revisar instrucciones oficiales de OpenSSL; nunca introducir contraseñas en comandos escritos en el historial del shell.
3. Crear secretos del Worker en Cloudflare (Settings → Variables and Secrets): `WALLET_TEAM_ID` (puede ser variable no secreta), `WALLET_SIGNER_CERT_PEM`, `WALLET_SIGNER_KEY_PEM`, `WALLET_SIGNER_KEY_PASSPHRASE` si está cifrada la clave, `WALLET_WWDR_PEM`. Confirmar concordancia entre `passTypeIdentifier` `pass.mx.com.alignmembers.membership` y el certificado.
4. Verificar y sustituir las imágenes `icon.png`, `icon@2x.png`, `logo.png` y `logo@2x.png` con PNG optimizados **a las dimensiones oficiales de Apple**. El prototipo carga el material actual del sitio: esto **no asegura que cumpla dimensiones**. No activar hasta confirmarlo.
5. Realizar instalación física en iPhone, comprobar que el archivo es un `.pkpass` firmado y aceptado por Wallet, y escanear en el portal de aliados. Verificar el manejo de visita y deduplicación.
6. Probar cuatro situaciones: miembro activo, pago vencido/cancelado, Duo/Circle y pase copiado en otro dispositivo. Un **QR estático puede fotografiarse y reutilizarse**, a diferencia del QR web que rota cada 15 minutos; se requiere política antifraude (foto y validación en servidor), límites de escaneo y decisión explícita de riesgo.
7. Diseñar y probar mecanismo de actualizaciones PassKit push/web-service si se desea que Wallet refleje visualmente las renovaciones o bajas. La verificación en servidor es la fuente de verdad, aunque el pase permanezca visualmente guardado.
8. Configurar pruebas de `node --test cloudflare/payments-worker/tests/apple-wallet.test.mjs` y compilación `npx wrangler deploy --dry-run --config cloudflare/payments-worker/wrangler.toml`, antes de promover la rama. También revisar `passkit-generator` con el runtime Cloudflare Worker y sus compatibilidades.
9. **Solo después** cambiar `WALLET_ENABLED` a `true` en un despliegue revisado, y fusionar previa autorización.

## Precauciones
- Nunca copiar secretos a código, terminal compartida ni commits.
- El Worker de producción procesa pagos Stripe LIVE: validar cuidadosamente las rutas antes de publicar.
- Las claves privadas y el certificado Apple solo se utilizan en servidor y deben tener rotación y copias de seguridad seguras.
- No mostrar el botón si el endpoint no es capaz de generar y firmar pases verificables.
