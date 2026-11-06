# VENTAX — Estructura y flujos de trabajo

## Quién usa qué
- **Cajero** (sesión de 8 h, pantalla táctil + escáner): Cobro y Turnos.
- **Encargado/dueño** (vistazos y revisión diaria): Alertas, Catálogo, Dashboard, Asistente.

## Estructura (barra lateral, por trabajo, no por módulo técnico)
| Grupo | Pantalla | Pregunta que responde | Acción principal |
| --- | --- | --- | --- |
| Operación | Cobro | ¿Qué se lleva el cliente? | Cobrar (F9) |
| Operación | Turnos | ¿Cuánto efectivo debe haber en caja? | Cerrar turno (corte ciego) |
| Inventario | Alertas | ¿Qué me va a faltar o a caducar? | Registrar entrada / merma |
| Inventario | Catálogo | ¿Qué vendo, a qué precio y cuánto hay? | Nuevo producto |
| Gestión | Dashboard | ¿Cómo va hoy contra ayer y la semana pasada? | Ver hallazgo del día |
| Gestión | Asistente IA | Pregunta libre sobre el negocio | Preguntar |
| Sistema | Ajustes | Giro, nombre, horas de operación | Guardar |

## Flujos concretos
1. **Abrir el día.** Entrar → sin turno, Cobro pide cajero + saldo inicial (obligatorio) → turno abierto → la insignia del turno se pone en verde y se habilita el cobro.
2. **Vender.** Escanear (o tocar la tarjeta) → pieza: entra directo; kg/L: pide cantidad → ticket a la derecha → Cobrar (F9) → método → efectivo: recibido y cambio → confirmar → ticket imprimible → nueva venta.
   - *Código no existe:* aviso con botón **Crear producto con ese código** (alta en 10 s sin salir de Cobro).
   - *Efectivo menor al total:* se rechaza con mensaje claro.
3. **Recibir mercancía.** Alertas muestra qué pedir y cuánto → llega el pedido → Catálogo › Entrada: escanear, cantidad → stock actualizado y la alerta desaparece. Desde una alerta, **Registrar entrada** abre ese formulario con el código ya puesto.
4. **Caducidad y merma.** Alertas › Por caducar: descuento sugerido (15/30/50 %) o **Registrar merma** (se descuenta del stock y queda auditado en movimientos).
5. **Retiro o depósito de efectivo.** Turnos › Entrada/salida de efectivo con justificación obligatoria; entra en el cálculo del corte.
6. **Cerrar turno (corte ciego).** El cajero cuenta el efectivo sin ver la cifra del sistema → Cerrar → arqueo: esperado vs contado, diferencia (sobrante/faltante) y ventas por método de pago. Sin turno no se vende.
7. **Revisión del encargado.** Dashboard: hallazgo del día (la alerta más urgente) → Top 10 y horas pico para decidir personal → Asistente para "¿qué reordeno hoy?" o la proyección de la quincena.

## Reglas de datos
- El stock solo cambia por movimientos (venta, entrada, merma, devolución, ajuste): todo queda auditado.
- Efectivo esperado = saldo inicial + ventas en efectivo + depósitos − retiros (tarjeta y transferencia no cuentan).
- Un hecho mostrado dos veces sale de la misma consulta (alertas y semáforo usan `stockAlerts()`).
