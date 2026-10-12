# Apple Wallet — Founder Lifetime del propietario

ESTADO: Propuesta en rama para revisión. Sin despliegue ni activación en Production. Requiere aprobación expresa posterior.

## Objetivo
Mantener verificable la tarjeta Apple Wallet que Edgar Cordero ya instaló, incluso después de expirar el piloto, sin abrir Wallet a otros socios ni modificar Stripe o el diseño.

## Seguridad y funcionamiento
- Nueva variable WALLET_OWNER_ENABLED inicia en false en producción y en Preview; WALLET_ENABLED permanece false. El vencimiento del piloto sigue intacto.
- La excepción comprueba que el QR opaco pertenece al socio ACTIVO con código AL-FOUNDER-001, integranteId OWNER-EDGAR-1, membershipType owner_lifetime y ownerComplimentary true. Además contrasta el token del socio con account:edgar.cordero, group y owner-lifetime:primary en KV. Si faltan o cambian registros, falla sin mostrar datos personales.
- El lector autenticado de aliados transforma el enlace estable de Wallet en el QR web vigente de aproximadamente 15 minutos antes de validar visitas. Mantiene las reglas normales de autorización del aliado.
- La tarjeta física de Apple Wallet ya instalada no se cambia. El QR visible es un identificador ESTÁTICO y NO rota en el iPhone. El QR temporal cambia dentro de la validación del aliado.
- Nueva página privada wallet-owner.html y ruta POST /api/wallet/owner, limitada a la cuenta del fundador, origen oficial, credenciales del socio en cuerpo POST, firma Apple y switch específico. Facilita volver a descargar el pase si se cambia de iPhone.
- Si se apaga WALLET_OWNER_ENABLED, revoca la membresía o elimina el registro de propietario, la verificación se rechaza aunque la tarjeta siga en Wallet.

## Despliegue futuro: NO autorizado todavía
1. Revisar PR, pruebas automáticas, chequeo sintáctico y compilación Wrangler --dry-run.
2. Tras APROBACIÓN NUEVA, fusionar/desplegar con WALLET_OWNER_ENABLED=false, WALLET_ENABLED=false y WALLET_PILOT_ENABLED=false. No abrir emisión general.
3. Comprobar salud del Worker, validar con switch false que la excepción del propietario no funciona, y verificar QR web existente.
4. Con autorización específica posterior, habilitar WALLET_OWNER_ENABLED=true SOLO en variables de Production. No modificar Preview ni Stripe. Atención: despliegues futuros con wrangler.toml pueden volver a false.
5. Escanear desde portal de aliados auténtico; probar cuenta propia, cuenta ajena, registro de visita, revocación y restauración segura. No confundir compilación o CI con prueba en iPhone.

## Límites importantes
- Un QR fijo puede ser fotografiado o clonado: el aliado debe verificar identidad. Para beneficios de alto valor todavía está pendiente un segundo factor independiente.
- Sin actualizaciones push de PassKit, datos visibles como ahorro no se actualizan automáticamente. La validez sí consulta KV en cada escaneo en línea.
- KV presenta consistencia eventual; una revocación puede tardar en reflejarse entre regiones. No prometer revocación instantánea.
- Ninguna excepción en este cambio habilita Wallet para los demás socios.

## Pruebas en CI
Se ejecuta owner-wallet-permanent.test.mjs junto con apple-wallet.test.mjs, apple-wallet-package.test.mjs, owner-lifetime.test.mjs y stripe-runtime.test.mjs. El flujo también valida sintaxis y crea bundle Wrangler sin desplegar.
