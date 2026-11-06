# VENTAX — Plan acordado

## Decisiones
**Alcance**: un negocio piloto, servidor local sin internet, una caja (un turno abierto a la vez), giro configurable. Nube y Electron después del piloto. IVA primero; CFDI solo si lo piden.

**Personas**: roles dueño y cajero siempre; encargado opcional (el dueño lo activa y le delega permisos). PIN de 4 a 6 dígitos cifrado, bloqueo tras 5 fallos y pantalla de bloqueo por inactividad. Solo el dueño (o el encargado con permiso) da descuentos, devoluciones, bajas, cambios de precio e importaciones.

**Turnos**: de 1 a 3 configurables (nombre y horario), se pueden apagar. Cada empleado tiene turno asignado; abrir otro requiere autorización. Relevo: el que sale hace corte ciego y entrega; el que llega confirma con su PIN; si no coincide, se recuenta con el PIN de quien entrega. Aviso cuando un turno se pasa de su hora.

**Datos**: precio con IVA incluido y tasa por producto (16 %, 0 %). Historial de precios y costos; ventas pasadas no cambian; último costo de compra. Importador CSV con vista previa (alerta sobre cambios de más de 30 %) y PIN del dueño. Copia automática al cerrar cada turno (últimas 30).

**Hardware**: lector 2D USB en modo teclado ahora; impresora, cajón y cámara del celular después.

## Orden de construcción
1. Empleados, PIN, roles, turnos configurables y relevo.
2. Ventas completas: IVA, descuentos, devoluciones, historial.
3. Primer arranque, importador CSV y copias.
4. Reportes por turno y periodo, con exportación.
5. Impresora y cajón.
6. Cámara del celular.

## Demo y MVP
- `npm run demo`: base de datos ficticia (`data/demo.db`) para probar funcionalidades.
- `npm start`: base real (`data/pos.db`), vacía, con asistente de primer arranque.

## Meta del piloto
Una semana de operación real con cortes que cuadren (o diferencias explicables), sin pérdida de datos y con los cajeros usándolo sin ayuda.

## Fuera de esta versión
Solicitudes pendientes de aprobación cuando no está el dueño, varias cajas, impresión ESC/POS directa, cámara del celular.
