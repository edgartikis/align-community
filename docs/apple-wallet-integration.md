# ALIGN Apple Wallet · instalación y seguridad

## Estado — 8 de octubre de 2026
Implementación en `feature/apple-wallet-align` (NO fusionar en `main` todavía). Código de emisión, verificación y adaptador del escáner listo para evaluación; **todavía no se ha probado una firma Apple real ni un escaneo E2E**.

- El botón en `member.html` está oculto mientras `GET /api/wallet/status` indique `available:false`.
- `WALLET_ENABLED = "false"` en Production y `true` únicamente en el entorno Preview (pruebas con datos ficticios).
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


## Cómo habilitar Cloudflare Worker Previews (intervención del propietario)
En Cloudflare → Workers & Pages → `align-payments` → Settings → Builds → banner **Set up Worker Previews**:
1. Seleccionar **Set up** y revisar la pantalla antes de confirmar. El cambio al nuevo modelo es **irreversible**.
2. Cloudflare sustituirá el comando de preview anterior por `npx wrangler preview`; production sigue usando `wrangler deploy`.
3. Comprobar que la configuración del preview **no usa KV PAYMENT_STATE de producción**. Esta rama deja `[previews]` sin KV a propósito; crear un namespace KV de staging si se requieren pruebas de membresías.
4. Las cuatro credenciales Apple deben figurar únicamente en **Previews Base**, no en Production. El flag está activo en Preview para probar la firma, pero debe permanecer desactivado en Production; no copiar Stripe LIVE a Previews.
5. Después de la activación, revisar los resultados de la build de `feature/apple-wallet-align` y su URL aislada. Nunca probar operaciones sobre clientes reales.

## Pruebas automáticas
La rama incluye `.github/workflows/apple-wallet-check.yml` con `node --test` y `wrangler deploy --dry-run` (sin desplegar a Cloudflare). Un resultado verde demuestra que compila, **no** que el .pkpass se firme bien ni que la UI funcione en un iPhone.

## Prueba controlada (solo Preview)
- Cargar un miembro exclusivamente ficticio en `align-wallet-preview-kv`, bajo una clave `member:<token aleatorio de 48 caracteres hex>`; conservar el token en privado.
- Abrir `GET /api/wallet/status` sobre la URL de Preview. Esperado: `available:true` **solo si** el runtime tiene las cuatro credenciales y la KV independiente.
- Solicitar `GET /api/wallet/apple?token=<token ficticio>` en esa misma URL. Esperado: `.pkpass` firmado; si falla, inspeccionar logs sin registrar claves, contraseñas ni tokens.
- El QR del pase debe apuntar al mismo host de Preview; nunca al dominio `api.alignmembers.com.mx` de producción. El flujo de visita de aliados se valida después en entorno aislado.
- El paquete firmado con un certificado de CI de prueba ya pasa las pruebas automáticas; esa firma **no es equivalente** a haber probado Apple Wallet con el certificado auténtico.
- Las imágenes actuales proceden del sitio web y aún requieren comprobar la presentación/tamaños oficiales en iOS antes de liberar la función.
