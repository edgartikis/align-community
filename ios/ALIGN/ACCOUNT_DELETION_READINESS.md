# ALIGN iOS — eliminación de cuenta (pendiente de pruebas y despliegue)

## Implementación preparada
- **Mi cuenta → Eliminar cuenta** desde la app iOS, separada de `Cancelar membresía`.
- El usuario introduce la contraseña de nuevo, escribe `ELIMINAR` y confirma por segunda vez.
- El backend `POST /api/member-account/delete` requiere sesión autenticada vigente, vuelve a comprobar la contraseña, protege cinco intentos y valida que la cuenta y las tarjetas pertenezcan al mismo grupo.
- El backend detiene suscripciones Stripe no terminadas antes de cerrar acceso. Si Stripe no responde, falla sin desactivar la membresía.
- Elimina cuentas, grupos, tarjetas, sesiones, borradores y activaciones relacionadas de Cloudflare KV; redacta los datos identificables de visitas retenidas por motivo contable; crea una tombstone por grupo para bloquear la reconstrucción accidental desde activaciones antiguas.
- Afecta a todos los integrantes de la cuenta Duo/Circle. El texto de confirmación lo advierte.
- Las cuentas Founder Lifetime usan una infraestructura especial de Wallet y se rechazan por seguridad hasta diseñar su procedimiento de eliminación independiente.

## Seguridad y limitaciones pendientes
1. **Producción permanece desactivada**: `MEMBER_ACCOUNT_DELETION_ENABLED = "false"`. En Preview está `true` exclusivamente para `qa.delete.fixture`, pero el Worker exige además `STRIPE_MODE=test`, autenticación V2 y controles de login Preview. Este cambio solo existe en la rama de GitHub; todavía requiere desplegarse a Cloudflare Preview y ejecutar `node scripts/verify-align-account-deletion-preview.mjs`. El primer smoke remoto prueba eliminación sin ninguna suscripción Stripe; en otra etapa se probará Stripe Test real.
2. El backend financiero puede conservar comprobantes fiscales conforme a la ley. La base de datos secundaria para reportes y los sistemas externos (Stripe, fotografías externas, copias de seguridad) **no están incluidos** en el borrado automatizado. Establecer proceso verificable de borrado de datos personales allí antes de activar en Live. No afirmar borrado integral mientras esté pendiente.
3. Para grupos grandes, el proceso examina índices KV con límites; un volumen grande puede provocar error y requerir intervención. Probar con KV Preview y su volumen esperado.
4. Si un fallo ocurre después de crear la tombstone, la cuenta queda bloqueada por seguridad pero podría permanecer información pendiente de purga; hace falta un procedimiento administrativo seguro de reconciliación y auditoría.
5. El flag no evita que el botón se vea en la app, pero mientras permanezca `false` las solicitudes devolverán `503`. No enviar esta versión a revisión como funcional hasta activar y comprobar el servicio.
6. Preparar nueva build iOS después de pruebas: **ALIGN 1.0 (8)** ya está subida y **no contiene** esta pantalla nueva. La próxima build requiere nuevo número, compilación en Mac, prueba en dispositivo físico y nueva entrega a App Store Connect.
7. Probar cancelación correcta de suscripciones activas y también cuentas de revisión con beneficios activos aunque Stripe figure cancelado, inicio de sesión posterior, códigos QR, protección Duo/Circle, errores de red y bloqueos.
8. Añadir mecanismo supervisado para la eliminación excepcional de Founder Lifetime antes del lanzamiento general.

## Comprobaciones automatizadas
`node --test cloudflare/payments-worker/tests/member-account-deletion.test.mjs`

**Estado**: integrado y comprobado con HTTP Worker/KV/Stripe simulados en GitHub. Preparado para despliegue aislado a Cloudflare Preview usando una única cuenta descartable. Aún sin deploy, cambios a cuentas reales, subida a TestFlight ni publicación App Store por este cambio.
