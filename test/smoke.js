// Prueba de punta a punta de la API contra una base temporal (se crea junto al proyecto, en D:).
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = path.resolve(import.meta.dirname, '..', '.tmp', 'test-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });
process.env.POS_DB = path.join(tmp, 'test.db');
const { server } = await import('../src/server.js');
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/api`;
let token = '';
const call = async (p, body, method) => {
  const res = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-token': token }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
};
const loginAs = async (name, pin) => {
  const pub = (await call('/public')).data;
  const e = pub.employees.find((x) => x.name === name);
  const r = await call('/auth/login', { employee_id: e.id, pin });
  if (r.status === 200) token = r.data.token;
  return r;
};

// --- Primer arranque ---
assert.equal((await call('/products')).status, 401);
assert.equal((await call('/public')).data.needs_setup, true);
assert.equal((await call('/setup', { owner_name: 'Dueño', owner_pin: '12', giro: 'abarrotes', shifts: [{ name: 'M', start: '06:00', end: '14:00' }] })).status, 400);   // PIN corto
assert.equal((await call('/setup', { business_name: 'Tienda', owner_name: 'Dueño', owner_pin: '1357', giro: 'abarrotes', shifts: [
  { name: 'Matutino', start: '06:00', end: '14:00' }, { name: 'Vespertino', start: '14:00', end: '22:00' }] })).status, 200);
assert.equal((await call('/setup', { owner_name: 'X', owner_pin: '1111', giro: 'abarrotes', shifts: [{ name: 'M', start: '06:00', end: '14:00' }] })).status, 403);   // solo una vez

// --- PIN y bloqueo ---
for (let i = 0; i < 5; i++) assert.equal((await loginAs('Dueño', '0000')).status, 401);
assert.match((await loginAs('Dueño', '1357')).data.error, /Bloqueado/);
// (el bloqueo dura 1 minuto: para seguir, se limpia directamente en la BD de prueba)
const { run } = await import('../src/db.js');
run('UPDATE employees SET locked_until=0, failed_attempts=0');
assert.equal((await loginAs('Dueño', '1357')).status, 200);

// --- Equipo, turnos y permisos ---
const defs = (await call('/state')).data.shift_defs;
assert.equal(defs.length, 2);
assert.equal((await call('/employees', { name: 'Ana', pin: '1122', role: 'cajero', shift_def_id: defs[0].id })).status, 200);
assert.equal((await call('/employees', { name: 'Luis', pin: '1122', role: 'cajero' })).status, 400);                 // PIN repetido
assert.equal((await call('/employees', { name: 'Luis', pin: '3344', role: 'cajero', shift_def_id: defs[1].id })).status, 200);
assert.equal((await call('/settings', { shifts: [defs[0], defs[1], { name: 'N', start: '22:00', end: '06:00' }, { name: 'Extra', start: '00:00', end: '01:00' }] })).status, 400);  // máx. 3

// --- Productos (con IVA) ---
const mk = async (b) => (await call('/products', b)).data;
const leche = await mk({ name: 'Leche', barcode: '111', category: 'Lácteos', cost: 20, price: 30, stock: 10, min_stock: 4, tax_rate: 0 });
const refresco = await mk({ name: 'Refresco', barcode: '222', category: 'Bebidas', cost: 10, price: 23.2, stock: 10, tax_rate: 16 });
const platano = await mk({ name: 'Plátano', barcode: '333', category: 'Frutas', cost: 10, price: 24, stock: 5, unit: 'kg', tax_rate: 0, expires_at: new Date(Date.now() + 86400e3).toISOString().slice(0, 10) });
assert.equal((await call('/products', { name: 'Dup', barcode: '111' })).status, 400);

// --- Cajero: no ve costos, no edita, no da descuentos ---
await loginAs('Ana', '1122');
const cprods = (await call('/products')).data;
assert.equal(cprods[0].cost, undefined);
assert.equal((await call('/products', { name: 'X', price: 1 })).status, 403);
assert.equal((await call('/report?from=2000-01-01')).status, 403);
// abrir turno: Ana es del turno matutino; abrir el vespertino exige autorización
assert.equal((await call('/shift/open', { shift_def_id: defs[1].id, opening_float: 500 })).status, 403);
assert.equal((await call('/shift/open', { shift_def_id: defs[0].id, opening_float: 500 })).status, 200);
assert.equal((await call('/shift/open', { shift_def_id: defs[0].id })).status, 400);                              // ya hay uno abierto

// --- Venta con IVA ---
let r = await call('/sales', { method: 'efectivo', cash_received: 200, items: [{ product_id: leche.id, qty: 2 }, { product_id: refresco.id, qty: 1 }, { product_id: platano.id, qty: 1.5 }] });
assert.equal(r.status, 200);
assert.equal(r.data.total, 119.2);                       // 60 + 23.20 + 36
assert.equal(r.data.tax, 3.2);                           // 23.20 - 23.20/1.16
assert.equal(r.data.change_given, 80.8);
const sale1 = r.data;
// descuento: el cajero no puede; con PIN del dueño sí
const withDisc = { method: 'tarjeta', items: [{ product_id: leche.id, qty: 1 }], discount: { type: 'pct', value: 10, reason: 'Cliente frecuente' } };
r = await call('/sales', withDisc); assert.equal(r.status, 403); assert.equal(r.data.needs_auth, 'descuentos');
r = await call('/sales', { ...withDisc, auth_pin: '9999' }); assert.equal(r.status, 403);
r = await call('/sales', { ...withDisc, auth_pin: '1357' });
assert.equal(r.status, 200); assert.equal(r.data.total, 27); assert.equal(r.data.discount, 3);
assert.equal((await call('/sales', { method: 'efectivo', cash_received: 5, items: [{ product_id: leche.id, qty: 1 }] })).status, 400);

// --- Devolución (solo con autorización) ---
const line = sale1.items.find((i) => i.name === 'Refresco');
const ret = { sale_id: sale1.id, reason: 'Defectuoso', items: [{ sale_item_id: line.id, qty: 1 }] };
assert.equal((await call('/returns', ret)).status, 403);
r = await call('/returns', { ...ret, auth_pin: '1357' });
assert.equal(r.status, 200); assert.equal(r.data.total, 23.2);
assert.equal((await call('/returns', { ...ret, auth_pin: '1357' })).status, 400);                    // ya devuelto

// --- Movimientos de efectivo y cierre ciego ---
assert.equal((await call('/shift/cash', { type: 'out', amount: 50, note: '' })).status, 400);          // exige justificación
assert.equal((await call('/shift/cash', { type: 'out', amount: 50, note: 'Proveedor' })).status, 200);
assert.equal((await call('/shift/current')).data.expected_cash, undefined);
// efectivo esperado = 500 + 119.20 (efectivo) - 23.20 (devolución en efectivo) - 50 = 546
r = await call('/shift/close', { counted_cash: 540 });
assert.equal(r.data.expected_cash, 546); assert.equal(r.data.difference, -6);
assert.ok(r.data.backup_file && fs.existsSync(r.data.backup_file), 'copia de seguridad creada');

// --- Relevo de caja: el que entra confirma o recuenta con el PIN del que entregó ---
await loginAs('Luis', '3344');
r = await call('/shift/open', { shift_def_id: defs[1].id, opening_float: 500 });
assert.equal(r.status, 409); assert.equal(r.data.needs_outgoing_pin, true);                             // entregó 540, no 500
r = await call('/shift/open', { shift_def_id: defs[1].id, opening_float: 500, outgoing_pin: '1122' });
assert.equal(r.status, 200); assert.equal(r.data.handover_diff, -40);
assert.equal((await call('/shift/close', { counted_cash: 500 })).status, 200);
r = await call('/shift/open', { shift_def_id: defs[1].id });                                            // sin monto: acepta lo entregado
assert.equal(r.status, 200); assert.equal(r.data.opening_float, 500); assert.equal(r.data.handover_diff, 0);
await call('/shift/close', { counted_cash: 500 });

// --- Dueño: historial de precios, importación y reportes ---
await loginAs('Dueño', '1357');
assert.equal((await call('/products/' + leche.id, { price: 33 }, 'PUT')).status, 200);
assert.equal((await call(`/products/${leche.id}/history`)).data[0].new_price, 33);
const csv = 'codigo;nombre;precio;costo;stock\n111;Leche;50;20;5\n444;Galletas;18,50;9;12\n555;;3;1;1\n';
const prev = (await call('/import/preview', { csv })).data;
assert.deepEqual([prev.summary.nuevo, prev.summary.actualizar, prev.summary.error, prev.summary.cambios_grandes], [1, 1, 1, 1]);   // 33 → 50 es +51 %
r = await call('/import/apply', { csv });                                                              // el dueño ya tiene el permiso
assert.deepEqual([r.data.created, r.data.updated], [1, 1]);
assert.equal((await call('/products/barcode/444')).data.price, 18.5);

const today = new Date().toISOString().slice(0, 10);
const rep = (await call(`/report?from=${today}&to=${today}&group=metodo`)).data;
assert.equal(rep.cascade.gross, 119.2 + 30);             // ventas con descuento: bruto = total + descuento
assert.equal(rep.cascade.discounts, 3); assert.equal(rep.cascade.returns, 23.2);
assert.equal(rep.cascade.net, r2(119.2 + 27 - 23.2));
function r2(n) { return Math.round(n * 100) / 100; }
assert.match((await call(`/report?from=${today}&format=csv`)).data, /Ventas netas/);
assert.equal((await call('/dashboard')).data.today.tickets, 2);

console.log('OK: todas las pruebas pasaron');
server.close();
(await import('../src/db.js')).db.close();
fs.rmSync(tmp, { recursive: true, force: true });
