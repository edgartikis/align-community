# ALIGN · base de datos de pruebas

Esta integración usa una hoja nueva e independiente de cualquier base real.

1. Abre `ALIGN · Base de Pruebas + Dashboard`.
2. Ve a **Extensiones → Apps Script**.
3. Sustituye el contenido por `Code.gs` y guarda.
4. Ve a **Implementar → Nueva implementación → Aplicación web**.
5. Ejecutar como: **yo**. Acceso: **cualquier persona**.
6. Copia la URL terminada en `/exec` dentro de `align-test-db-config.js`.

La página enviará pagos simulados y visitas. Nunca se envían contraseñas, hashes, números de tarjeta ni CVC.
