# Apple Wallet — Founder Lifetime del propietario

ESTADO: Activación EXCLUSIVA del propietario aprobada el 12 de octubre de 2026. Este repositorio refleja el valor deseado; comprobar la publicación real en Cloudflare tras ejecutar Wrangler y verificar el QR con un aliado.

## Objetivo
Mantener verificable la tarjeta Apple Wallet que Edgar Cordero ya instaló, incluso después de expirar el piloto, sin abrir Wallet a otros socios ni modificar Stripe o el diseño.

## Seguridad y funcionamiento
- WALLET_OWNER_ENABLED=true exclusivamente en Production; permanece false en Preview. WALLET_ENABLED=false y WALLET_PILOT_ENABLED=false tanto en Production como en Preview. No se reabre el piloto vencido ni se habilita a los demás socios.
- La excepción comprueba que el QR opaco pertenece al socio ACTIVO con código AL-FOUNDER-001, integranteId OWNER-EDGAR-1, membershipType owner_lifetime y ownerComplimentary true. Además contrasta el token del socio con account:edgar.cordero, group y owner-lifetime:primary en KV. Si faltan o cambian registros, falla sin mostrar datos personales.
- El lector autenticado de aliados transforma el enlace estable de Wallet en el QR web vigente de aproximadamente 15 minutos antes de validar visitas. Mantiene las reglas normales de autorización del aliado.
- La tarjeta física de Apple Wallet ya instalada no se cambia. El QR visible es un identificador ESTÁTICO y NO rota en el iPhone. El QR temporal cambia dentro de la validación del aliado.
- Nueva página privada wallet-owner.html y ruta POST /api/wallet/owner, limitada a la cuenta del fundador, origen oficial, credenciales del socio en cuerpo POST, firma Apple y switch específico. Facilita volver a descargar el pase si se cambia de iPhone.
- Si se apaga WALLET_OWNER_ENABLED, revoca la membresía o elimina el registro de propietario, la verificación se rechaza aunque la tarjeta siga en Wallet.

## Publicación de la activación aprobada
1. Revisar PR, pruebas automáticas, chequeo sintáctico y compilación Wrangler --dry-run; comprobar que ningún otro switch haya cambiado.
2. Con la aprobación explícita del titular ya otorgada, fusionar este cambio de configuración. El despliegue desde la Mac del administrador usará WALLET_OWNER_ENABLED=true solo en Production, WALLET_ENABLED=false y WALLET_PILOT_ENABLED=false.
3. Tras desplegar, comprobar /api/health y el QR web existente. Validar el QR de Apple Wallet con el portal de aliados autorizado y confirmar que otra membresía no hereda la excepción.
4. Para REVOCAR el acceso Wallet del propietario, cambiar WALLET_OWNER_ENABLED=false en Production y desplegar o usar un override del Dashboard con revisión posterior del wrangler.toml. No modificar Preview ni Stripe.
5. Escanear desde portal de aliados auténtico; probar cuenta propia, cuenta ajena, registro de visita y rechazo cuando el propietario se revoca. Las pruebas CI NO confirman despliegue real ni acceso en iPhone.

## Límites importantes
- Un QR fijo puede ser fotografiado o clonado: el aliado debe verificar identidad. Para beneficios de alto valor todavía está pendiente un segundo factor independiente.
- Sin actualizaciones push de PassKit, datos visibles como ahorro no se actualizan automáticamente. La validez sí consulta KV en cada escaneo en línea.
- KV presenta consistencia eventual; una revocación puede tardar en reflejarse entre regiones. No prometer revocación instantánea.
- Ninguna excepción en este cambio habilita Wallet para los demás socios.

## Pruebas en CI
Se ejecuta owner-wallet-permanent.test.mjs junto con apple-wallet.test.mjs, apple-wallet-package.test.mjs, owner-lifetime.test.mjs y stripe-runtime.test.mjs. El flujo también valida sintaxis y crea bundle Wrangler sin desplegar.
