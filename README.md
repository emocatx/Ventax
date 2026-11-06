# VENTAX (NexusPOS IA)

Punto de venta local con turnos, inventario con semáforo predictivo, caducidades y dashboard gerencial.
Node 22.13+ · sin dependencias · SQLite local (`data/pos.db`) · funciona sin internet.

```bash
npm start        # http://localhost:3000
npm run seed     # (opcional) datos demo: 25 productos + 30 días de ventas
npm test         # prueba de humo de la API
```

- **Escáner láser USB/Bluetooth**: modo "teclado" — la caja de búsqueda superior recibe el código + Enter.
- **Asistente IA**: responde con reglas sobre tus datos; para preguntas abiertas define `ANTHROPIC_API_KEY`.
- **Ticket**: botón Imprimir usa la impresora del sistema (formato 80 mm).

## Estado vs. roadmap
- Fase 1 (MVP) y Fase 2 (turnos, corte ciego, stock, escáner modo teclado): hechas.
- Fase 3 (dashboard, horas pico, alertas predictivas, asistente): hecha en versión base.
- Pendiente: ESC/POS directo y apertura de cajón (WebHID/serial), básculas, sincronización a PostgreSQL, Electron, login/roles, cancelaciones y devoluciones de venta.

## Arranque y red

| Comando | Base | Quién puede entrar |
| --- | --- | --- |
| `npm start` | real (`data/pos.db`) | solo esta PC, `http://localhost:3000` |
| `npm run demo` | demostración | solo esta PC |
| `npm run lan` | real | tablets y celulares de la red, por HTTPS en el puerto 3443 |
| `npm run lan:demo` | demostración | igual, con datos ficticios |

El modo de red crea un certificado propio en `data/certs` (se regenera si cambia la IP de la PC).
Cada equipo muestra una vez el aviso "conexión no privada"; hay que elegir "Avanzado" y "Continuar".
Sin `--lan` el servidor no acepta conexiones desde la red, así los PIN nunca viajan sin cifrar.

Después de cambiar algo en `web/`, compila la interfaz con `npm run web:build`.
