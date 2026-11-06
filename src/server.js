// Servidor HTTP de VENTAX (sin dependencias): UI estática + API REST local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db, get, all, run, tx, getSettings, setSettings, GIROS, ENCARGADO_PERMS, dataDir } from './db.js';
import { dashboard, stockAlerts, expiryAlerts, ask } from './analytics.js';
import { PIN_RE, hashPin, checkPin, permsOf, can, pinInUse, login, logout, sessionUser, authorizerByPin, publicEmployee } from './auth.js';
import { buildPlan } from './importer.js';
import { salesReport, reportCSV } from './reports.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const DIST = path.resolve(import.meta.dirname, '..', 'web', 'dist');
const METHODS = ['efectivo', 'tarjeta', 'transferencia'];
const UNITS = ['pieza', 'kg', 'g', 'l'];
const STOCK_TYPES = { venta: -1, entrada: 1, merma: -1, devolucion_proveedor: -1, devolucion_cliente: 1, ajuste: 0 };
const r2 = (n) => Math.round(n * 100) / 100;

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg) => new HttpError(400, msg);
const num = (v, name, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`Valor inválido para ${name}`);
  return n;
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- Helpers de negocio ----------
const currentShift = () => get(`SELECT * FROM shifts WHERE status='open' ORDER BY id DESC LIMIT 1`) || null;
const shiftDefs = () => all('SELECT * FROM shift_defs ORDER BY position, id');

function overdueMinutes(s, def) {
  if (!s || !def) return 0;
  const opened = new Date(s.opened_at.replace(' ', 'T'));
  const [eh, em] = def.end.split(':').map(Number);
  const end = new Date(opened); end.setHours(eh, em, 0, 0);
  while (end <= opened) end.setDate(end.getDate() + 1);
  return Math.max(0, Math.floor((Date.now() - end) / 60000));
}
function shiftView(s) {
  if (!s) return null;
  const def = s.shift_def_id ? get('SELECT * FROM shift_defs WHERE id=?', s.shift_def_id) : null;
  return { ...s, shift_name: def?.name || null, shift_end: def?.end || null, overdue_minutes: overdueMinutes(s, def) };
}

function shiftSummary(id) {
  const s = get('SELECT * FROM shifts WHERE id=?', id);
  const by = Object.fromEntries(METHODS.map((m) => [m, 0]));
  for (const r of all('SELECT method, SUM(total) t FROM sales WHERE shift_id=? GROUP BY method', id)) by[r.method] = r.t;
  let refunds = 0;
  for (const r of all('SELECT method, SUM(total) t FROM returns WHERE shift_id=? GROUP BY method', id)) { by[r.method] -= r.t; refunds += r.t; }
  const cin = get(`SELECT COALESCE(SUM(amount),0) t FROM cash_moves WHERE shift_id=? AND type='in'`, id).t;
  const cout = get(`SELECT COALESCE(SUM(amount),0) t FROM cash_moves WHERE shift_id=? AND type='out'`, id).t;
  const tickets = get('SELECT COUNT(*) n FROM sales WHERE shift_id=?', id).n;
  const expected = s.opening_float + by.efectivo + cin - cout;
  for (const m of METHODS) by[m] = r2(by[m]);
  return { shift: shiftView(s), by_method: by, refunds: r2(refunds), cash_in: cin, cash_out: cout, tickets, expected_cash: r2(expected) };
}

function validateProduct(b, partial = false) {
  const p = {};
  if (!partial || b.name !== undefined) { p.name = String(b.name || '').trim(); if (!p.name) throw bad('El nombre es obligatorio'); }
  if (!partial || b.barcode !== undefined) p.barcode = String(b.barcode || '').trim() || null;
  if (!partial || b.category !== undefined) p.category = String(b.category || '').trim();
  for (const k of ['cost', 'price', 'stock', 'min_stock', 'max_stock']) {
    if (!partial || b[k] !== undefined) p[k] = num(b[k] ?? 0, k, k === 'stock' ? {} : { min: 0 });
  }
  if (!partial || b.tax_rate !== undefined) p.tax_rate = num(b.tax_rate ?? 16, 'IVA', { min: 0, max: 100 });
  if (!partial || b.unit !== undefined) p.unit = UNITS.includes(b.unit) ? b.unit : 'pieza';
  if (!partial || b.image !== undefined) p.image = String(b.image || '').trim();
  if (!partial || b.expires_at !== undefined) p.expires_at = /^\d{4}-\d{2}-\d{2}$/.test(b.expires_at || '') ? b.expires_at : null;
  if (b.active !== undefined) p.active = b.active === true || b.active === 1 || b.active === 'true' ? 1 : 0;
  return p;
}

function applyStock(productId, type, qtyAbs, note) {
  const sign = STOCK_TYPES[type];
  if (sign === undefined) throw bad('Tipo de movimiento inválido');
  const qty = sign === 0 ? num(qtyAbs, 'cantidad') : sign * num(qtyAbs, 'cantidad', { min: 0.0001 });
  if (qty === 0) throw bad('La cantidad no puede ser 0');
  run('UPDATE products SET stock = stock + ? WHERE id=?', qty, productId);
  run('INSERT INTO stock_moves(product_id,type,qty,note) VALUES(?,?,?,?)', productId, type, qty, note || '');
}

function logPriceChange(before, after, by, source = 'manual') {
  const price = after.price ?? before.price, cost = after.cost ?? before.cost;
  if (price === before.price && cost === before.cost) return;
  run('INSERT INTO price_history(product_id,old_price,new_price,old_cost,new_cost,changed_by,source) VALUES(?,?,?,?,?,?,?)', before.id, before.price, price, before.cost, cost, by, source);
}

function backup() {
  const dir = getSettings().backup_dir || path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const f = path.join(dir, `ventax-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(dir).filter((n) => /^ventax-.*\.db$/.test(n)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 30))) fs.rmSync(path.join(dir, old), { force: true });
  return f;
}

// ---------- Rutas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, public: !!opts.public });

// Públicas
route('GET', '/api/public', () => {
  const s = getSettings();
  return { needs_setup: get('SELECT COUNT(*) n FROM employees').n === 0, business_name: s.business_name, giros: GIROS,
    employees: all('SELECT * FROM employees WHERE active=1 ORDER BY name').map(publicEmployee), shift_defs: shiftDefs(), shifts_enabled: s.shifts_enabled === '1' };
}, { public: true });

route('POST', '/api/setup', ({ body }) => {
  if (get('SELECT COUNT(*) n FROM employees').n > 0) throw new HttpError(403, 'El sistema ya fue configurado');
  const owner = String(body.owner_name || '').trim();
  if (!owner) throw bad('Escribe el nombre del dueño');
  if (!PIN_RE.test(String(body.owner_pin || ''))) throw bad('El PIN debe tener 4 dígitos');
  if (!GIROS[body.giro]) throw bad('Giro inválido');
  const enabled = body.shifts_enabled !== false;
  const shifts = enabled ? parseShiftDefs(body.shifts) : [];
  tx(() => {
    setSettings({ business_name: String(body.business_name || '').trim() || 'Mi Negocio', giro: body.giro, open_hours: num(body.open_hours ?? 12, 'horas', { min: 1, max: 24 }),
      shifts_enabled: enabled ? '1' : '0', configured: '1' });
    shifts.forEach((d, i) => run('INSERT INTO shift_defs(name,start,end,position) VALUES(?,?,?,?)', d.name, d.start, d.end, i));
    run(`INSERT INTO employees(name,pin_hash,role) VALUES(?,?,'dueno')`, owner, hashPin(String(body.owner_pin)));
  });
  return { ok: true };
}, { public: true });

route('POST', '/api/auth/login', ({ body }) => {
  const r = login(body.employee_id, String(body.pin || ''));
  if (r.error) throw new HttpError(401, r.error);
  return { token: r.token, user: { ...publicEmployee(r.employee), perms: permsOf(r.employee) } };
}, { public: true });

// Autenticadas
route('POST', '/api/auth/logout', ({ token }) => { logout(token); return { ok: true }; });
route('GET', '/api/me', ({ user }) => ({ user: { ...publicEmployee(user), perms: permsOf(user) } }));

route('GET', '/api/state', ({ user }) => {
  const s = currentShift();
  return { settings: getSettings(), giros: GIROS, shift_defs: shiftDefs(), shift: shiftView(s), user: { ...publicEmployee(user), perms: permsOf(user) }, encargado_perms: ENCARGADO_PERMS };
});

function parseShiftDefs(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 3) throw bad('Define de 1 a 3 turnos');
  return list.map((d) => {
    const name = String(d.name || '').trim();
    if (!name) throw bad('Cada turno necesita nombre');
    if (!HHMM.test(d.start) || !HHMM.test(d.end)) throw bad('Horarios inválidos (usa HH:MM)');
    return { id: d.id ? Number(d.id) : null, name, start: d.start, end: d.end };
  });
}

route('POST', '/api/settings', ({ body, need }) => {
  need('ajustes');
  const upd = {};
  if (body.business_name !== undefined) upd.business_name = String(body.business_name).trim() || 'Mi Negocio';
  if (body.giro !== undefined) { if (!GIROS[body.giro]) throw bad('Giro inválido'); upd.giro = body.giro; }
  if (body.open_hours !== undefined) upd.open_hours = num(body.open_hours, 'horas de operación', { min: 1, max: 24 });
  if (body.shifts_enabled !== undefined) upd.shifts_enabled = body.shifts_enabled ? '1' : '0';
  if (body.encargado_enabled !== undefined) upd.encargado_enabled = body.encargado_enabled ? '1' : '0';
  if (Array.isArray(body.encargado_perms)) upd.encargado_perms = body.encargado_perms.filter((p) => ENCARGADO_PERMS.includes(p)).join(',');
  if (body.backup_dir !== undefined) upd.backup_dir = String(body.backup_dir).trim();
  tx(() => {
    setSettings(upd);
    if (body.shifts !== undefined) {
      const defs = parseShiftDefs(body.shifts);
      const keep = defs.filter((d) => d.id).map((d) => d.id);
      for (const old of shiftDefs()) {
        if (keep.includes(old.id)) continue;
        if (get('SELECT 1 FROM shifts WHERE shift_def_id=?', old.id) || get('SELECT 1 FROM employees WHERE shift_def_id=?', old.id)) throw bad(`El turno "${old.name}" ya tiene historial o empleados: no se puede quitar`);
        run('DELETE FROM shift_defs WHERE id=?', old.id);
      }
      defs.forEach((d, i) => {
        if (d.id) run('UPDATE shift_defs SET name=?, start=?, end=?, position=? WHERE id=?', d.name, d.start, d.end, i, d.id);
        else run('INSERT INTO shift_defs(name,start,end,position) VALUES(?,?,?,?)', d.name, d.start, d.end, i);
      });
    }
  });
  return { settings: getSettings(), shift_defs: shiftDefs() };
});

route('POST', '/api/backup', ({ need }) => { need('ajustes'); return { file: backup() }; });

// Empleados
route('GET', '/api/employees', ({ need }) => { need('empleados'); return all('SELECT * FROM employees ORDER BY active DESC, name').map(publicEmployee); });
route('POST', '/api/employees', ({ body, need }) => {
  need('empleados');
  const name = String(body.name || '').trim();
  if (!name) throw bad('El nombre es obligatorio');
  if (!['dueno', 'encargado', 'cajero'].includes(body.role)) throw bad('Rol inválido');
  if (!PIN_RE.test(String(body.pin || ''))) throw bad('El PIN debe tener 4 dígitos');
  if (pinInUse(String(body.pin))) throw bad('Ese PIN ya lo usa otro empleado; elige uno distinto');
  const r = run('INSERT INTO employees(name,pin_hash,role,shift_def_id) VALUES(?,?,?,?)', name, hashPin(String(body.pin)), body.role, body.shift_def_id ? Number(body.shift_def_id) : null);
  return publicEmployee(get('SELECT * FROM employees WHERE id=?', r.lastInsertRowid));
});
route('PUT', '/api/employees/(\\d+)', ({ params, body, need }) => {
  need('empleados');
  const id = Number(params[0]);
  const e = get('SELECT * FROM employees WHERE id=?', id);
  if (!e) throw new HttpError(404, 'Empleado no encontrado');
  const next = { name: body.name !== undefined ? String(body.name).trim() : e.name, role: body.role ?? e.role,
    shift_def_id: body.shift_def_id !== undefined ? (body.shift_def_id ? Number(body.shift_def_id) : null) : e.shift_def_id,
    active: body.active !== undefined ? (body.active ? 1 : 0) : e.active };
  if (!next.name) throw bad('El nombre es obligatorio');
  if (!['dueno', 'encargado', 'cajero'].includes(next.role)) throw bad('Rol inválido');
  const owners = get(`SELECT COUNT(*) n FROM employees WHERE role='dueno' AND active=1 AND id<>?`, id).n;
  if (!owners && (next.role !== 'dueno' || !next.active)) throw bad('Debe quedar al menos un dueño activo');
  if (!next.active && currentShift()?.employee_id === id) throw bad('Tiene un turno abierto: ciérralo antes de darlo de baja');
  let pinHash = e.pin_hash;
  if (body.pin) {
    if (!PIN_RE.test(String(body.pin))) throw bad('El PIN debe tener 4 dígitos');
    if (pinInUse(String(body.pin), id)) throw bad('Ese PIN ya lo usa otro empleado; elige uno distinto');
    pinHash = hashPin(String(body.pin));
  }
  run('UPDATE employees SET name=?, role=?, shift_def_id=?, active=?, pin_hash=?, failed_attempts=0, locked_until=0 WHERE id=?', next.name, next.role, next.shift_def_id, next.active, pinHash, id);
  return publicEmployee(get('SELECT * FROM employees WHERE id=?', id));
});

// Productos
route('GET', '/api/products', ({ query, user }) => {
  const q = (query.get('q') || '').trim();
  const where = [query.get('all') === '1' ? '1=1' : 'active=1'];
  const params = [];
  if (q) { where.push('(name LIKE ? OR barcode LIKE ? OR category LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const levels = new Map(stockAlerts().map((a) => [a.id, a.level]));
  const seeCost = can(user, 'productos') || can(user, 'reportes');
  return all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name LIMIT 500`, ...params).map((p) => {
    const o = { ...p, level: levels.get(p.id) || 'ok' };
    if (!seeCost) delete o.cost;
    return o;
  });
});
route('GET', '/api/products/barcode/([^/]+)', ({ params, user }) => {
  const p = get('SELECT * FROM products WHERE barcode=? AND active=1', decodeURIComponent(params[0]));
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  if (!can(user, 'productos') && !can(user, 'reportes')) delete p.cost;
  return p;
});
route('GET', '/api/products/(\\d+)/history', ({ params, need }) => {
  need('productos');
  return all('SELECT * FROM price_history WHERE product_id=? ORDER BY id DESC LIMIT 50', Number(params[0]));
});
route('POST', '/api/products', ({ body, authorize }) => {
  const who = authorize('productos');
  const p = validateProduct(body);
  try {
    return tx(() => {
      const r = run(`INSERT INTO products(barcode,name,category,cost,price,stock,min_stock,max_stock,unit,image,expires_at,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        p.barcode, p.name, p.category, p.cost, p.price, 0, p.min_stock, p.max_stock, p.unit, p.image, p.expires_at, p.tax_rate);
      if (p.stock) applyStock(r.lastInsertRowid, 'entrada', p.stock, `Stock inicial (${who.name})`);
      return get('SELECT * FROM products WHERE id=?', r.lastInsertRowid);
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw bad('Ya existe un producto con ese código de barras');
    throw e;
  }
});
route('PUT', '/api/products/(\\d+)', ({ params, body, authorize }) => {
  const who = authorize('productos');
  const id = Number(params[0]);
  const before = get('SELECT * FROM products WHERE id=?', id);
  if (!before) throw new HttpError(404, 'Producto no encontrado');
  const p = validateProduct(body, true);
  delete p.stock;
  const keys = Object.keys(p);
  if (!keys.length) throw bad('Nada que actualizar');
  try {
    tx(() => {
      run(`UPDATE products SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => p[k]), id);
      logPriceChange(before, p, who.name);
    });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw bad('Ya existe un producto con ese código de barras');
    throw e;
  }
  return get('SELECT * FROM products WHERE id=?', id);
});

// Movimientos de almacén
route('POST', '/api/stock', ({ body, authorize }) => {
  const who = authorize('productos');
  const prod = body.barcode ? get('SELECT * FROM products WHERE barcode=?', String(body.barcode).trim()) : get('SELECT * FROM products WHERE id=?', Number(body.product_id));
  if (!prod) throw new HttpError(404, 'Producto no encontrado');
  tx(() => {
    applyStock(prod.id, body.type, body.qty, body.note);
    if (body.type === 'entrada' && body.cost !== undefined && body.cost !== '' && Number(body.cost) !== prod.cost) {   // último costo de compra
      const cost = num(body.cost, 'costo', { min: 0 });
      run('UPDATE products SET cost=? WHERE id=?', cost, prod.id);
      logPriceChange(prod, { cost }, who.name, 'entrada');
    }
  });
  return get('SELECT * FROM products WHERE id=?', prod.id);
});
route('GET', '/api/stock/moves', ({ need }) => { need('productos'); return all(`SELECT m.*, p.name FROM stock_moves m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100`); });

// Turnos
route('GET', '/api/shift/current', ({ user }) => {
  const s = currentShift();
  if (!s) return { shift: null };
  const { expected_cash, ...rest } = shiftSummary(s.id);           // corte ciego: el efectivo esperado no se revela
  const prev = get(`SELECT id, cashier, counted_cash FROM shifts WHERE status='closed' ORDER BY id DESC LIMIT 1`);
  return { ...rest, mine: s.employee_id === user.id, can_close: s.employee_id === user.id || can(user, 'empleados'), handover_from: prev && s.handover_from === prev.id ? prev : null };
});

route('GET', '/api/shift/handover', () => {
  const prev = get(`SELECT s.id, s.cashier, s.counted_cash, s.employee_id, s.closed_at FROM shifts s WHERE status='closed' ORDER BY id DESC LIMIT 1`);
  return { previous: prev || null };
});

route('POST', '/api/shift/open', ({ body, user, authorize }) => {
  if (currentShift()) throw bad('Ya hay un turno abierto');
  const enabled = getSettings().shifts_enabled === '1';
  let def = null;
  if (enabled) {
    def = get('SELECT * FROM shift_defs WHERE id=?', Number(body.shift_def_id));
    if (!def) throw bad('Elige el turno que vas a abrir');
    if (user.shift_def_id && user.shift_def_id !== def.id && user.role === 'cajero') authorize('empleados');   // otro turno: autoriza el dueño
  }
  const prev = get(`SELECT * FROM shifts WHERE status='closed' AND counted_cash IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const expected = prev ? prev.counted_cash : null;
  let float = body.opening_float === undefined || body.opening_float === '' ? expected : num(body.opening_float, 'saldo inicial', { min: 0 });
  if (float === null) throw bad('Indica el saldo inicial de caja');
  let diff = null;
  if (prev && Math.abs(float - expected) > 0.005) {
    const outgoing = prev.employee_id ? get('SELECT * FROM employees WHERE id=?', prev.employee_id) : null;
    if (!body.outgoing_pin || !outgoing || !checkPin(String(body.outgoing_pin), outgoing.pin_hash)) {
      throw new HttpError(409, `El efectivo no coincide con lo que entregó ${prev.cashier}. Recuenten juntos: se necesita el PIN de ${prev.cashier}.`, { needs_outgoing_pin: true, expected });
    }
    diff = r2(float - expected);
  } else if (prev) diff = 0;
  const r = run('INSERT INTO shifts(cashier, employee_id, shift_def_id, opening_float, handover_from, handover_expected, handover_diff) VALUES(?,?,?,?,?,?,?)',
    user.name, user.id, def?.id ?? null, float, prev?.id ?? null, expected, diff);
  return shiftView(get('SELECT * FROM shifts WHERE id=?', r.lastInsertRowid));
});

route('POST', '/api/shift/cash', ({ body, user }) => {
  const s = currentShift();
  if (!s) throw bad('No hay turno abierto');
  if (s.employee_id && s.employee_id !== user.id) throw new HttpError(403, `El turno abierto es de ${s.cashier}`);
  if (!['in', 'out'].includes(body.type)) throw bad('Tipo inválido');
  const note = String(body.note || '').trim();
  if (!note) throw bad('Escribe la justificación del movimiento');
  run('INSERT INTO cash_moves(shift_id,type,amount,note) VALUES(?,?,?,?)', s.id, body.type, num(body.amount, 'monto', { min: 0.01 }), note);
  return { ok: true };
});

route('POST', '/api/shift/close', ({ body, user }) => {
  const s = currentShift();
  if (!s) throw bad('No hay turno abierto');
  if (s.employee_id && s.employee_id !== user.id && !can(user, 'empleados')) throw new HttpError(403, `Solo ${s.cashier} o el dueño pueden cerrar este turno`);
  const counted = num(body.counted_cash, 'efectivo contado', { min: 0 });
  const sum = shiftSummary(s.id);
  const diff = r2(counted - sum.expected_cash);
  run(`UPDATE shifts SET status='closed', closed_at=datetime('now','localtime'), counted_cash=?, expected_cash=?, difference=? WHERE id=?`, counted, sum.expected_cash, diff, s.id);
  let backup_file = null, backup_error = null;
  try { backup_file = backup(); } catch (e) { backup_error = e.message; }
  return { ...shiftSummary(s.id), counted_cash: counted, difference: diff, backup_file, backup_error };
});

route('GET', '/api/shifts', ({ need }) => {
  need('reportes');
  return all(`SELECT s.*, d.name shift_name, (SELECT name FROM employees WHERE id=s.handover_from) x FROM shifts s LEFT JOIN shift_defs d ON d.id=s.shift_def_id ORDER BY s.id DESC LIMIT 30`);
});

// Ventas
function saleDetail(id) {
  const sale = get('SELECT s.*, sh.cashier, e.name authorized_name FROM sales s JOIN shifts sh ON sh.id=s.shift_id LEFT JOIN employees e ON e.id=s.authorized_by WHERE s.id=?', id);
  if (!sale) throw new HttpError(404, 'Venta no encontrada');
  const items = all(`SELECT si.*, COALESCE((SELECT SUM(ri.qty) FROM return_items ri WHERE ri.sale_item_id=si.id),0) returned FROM sale_items si WHERE si.sale_id=?`, id);
  return { ...sale, items, business: getSettings().business_name };
}

route('POST', '/api/sales', ({ body, user, authorize }) => {
  const shift = currentShift();
  if (!shift) throw bad('Abre un turno antes de vender');
  if (shift.employee_id && shift.employee_id !== user.id) throw new HttpError(403, `El turno abierto es de ${shift.cashier}`);
  if (!METHODS.includes(body.method)) throw bad('Método de pago inválido');
  if (!Array.isArray(body.items) || !body.items.length) throw bad('El carrito está vacío');
  return tx(() => {
    const lines = body.items.map((it) => {
      const p = get('SELECT * FROM products WHERE id=? AND active=1', Number(it.product_id));
      if (!p) throw bad('Producto inexistente en el carrito');
      return { p, qty: num(it.qty, 'cantidad', { min: 0.0001 }) };
    });
    const gross = r2(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
    // descuento: solo con autorización (dueño, o encargado con permiso)
    let discount = 0, authorizedBy = null, reason = '';
    const d = body.discount;
    if (d && Number(d.value) > 0) {
      const who = authorize('descuentos');
      authorizedBy = who.id;
      reason = String(d.reason || '').trim();
      if (!reason) throw bad('Escribe el motivo del descuento');
      discount = d.type === 'pct' ? r2(gross * num(d.value, 'descuento', { min: 0, max: 100 }) / 100) : r2(num(d.value, 'descuento', { min: 0 }));
      if (discount > gross) throw bad('El descuento no puede ser mayor al total');
    }
    const total = r2(gross - discount);
    const factor = gross ? total / gross : 0;
    let paidSum = 0;
    const calc = lines.map((l, i) => {
      let paid = r2(l.p.price * l.qty * factor);
      if (i === lines.length - 1) paid = r2(total - paidSum);       // el redondeo se absorbe en la última línea
      paidSum += paid;
      const net = r2(paid / (1 + l.p.tax_rate / 100));
      return { ...l, paid, net, tax: r2(paid - net) };
    });
    const tax = r2(calc.reduce((s, l) => s + l.tax, 0));
    let received = null, change = null;
    if (body.method === 'efectivo') {
      received = num(body.cash_received ?? total, 'efectivo recibido', { min: 0 });
      if (received < total) throw bad('El efectivo recibido es menor al total');
      change = r2(received - total);
    }
    const r = run(`INSERT INTO sales(shift_id,employee_id,total,subtotal,tax,discount,discount_reason,authorized_by,method,cash_received,change_given) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      shift.id, user.id, total, r2(total - tax), tax, discount, reason, authorizedBy, body.method, received, change);
    for (const l of calc) {
      run('INSERT INTO sale_items(sale_id,product_id,name,qty,price,cost,tax_rate,net,tax,paid) VALUES(?,?,?,?,?,?,?,?,?,?)', r.lastInsertRowid, l.p.id, l.p.name, l.qty, l.p.price, l.p.cost, l.p.tax_rate, l.net, l.tax, l.paid);
      applyStock(l.p.id, 'venta', l.qty, `Venta #${r.lastInsertRowid}`);
    }
    return saleDetail(r.lastInsertRowid);
  });
});
route('GET', '/api/sales/(\\d+)', ({ params }) => saleDetail(Number(params[0])));
route('GET', '/api/sales', ({ query }) => {
  const q = (query.get('q') || '').trim();
  return q && /^\d+$/.test(q) ? all('SELECT * FROM sales WHERE id=?', Number(q)) : all('SELECT * FROM sales ORDER BY id DESC LIMIT 30');
});

// Devoluciones (solo con autorización)
route('POST', '/api/returns', ({ body, user, authorize }) => {
  const who = authorize('devoluciones');
  const shift = currentShift();
  if (!shift) throw bad('Abre un turno para registrar devoluciones');
  const sale = get('SELECT * FROM sales WHERE id=?', Number(body.sale_id));
  if (!sale) throw new HttpError(404, 'Venta no encontrada');
  const reason = String(body.reason || '').trim();
  if (!reason) throw bad('Escribe el motivo de la devolución');
  if (!Array.isArray(body.items) || !body.items.length) throw bad('Elige qué se devuelve');
  const method = METHODS.includes(body.method) ? body.method : sale.method;
  return tx(() => {
    let total = 0, tax = 0;
    const rows = body.items.map((it) => {
      const si = get('SELECT * FROM sale_items WHERE id=? AND sale_id=?', Number(it.sale_item_id), sale.id);
      if (!si) throw bad('Artículo no pertenece a esa venta');
      const done = get('SELECT COALESCE(SUM(qty),0) q FROM return_items WHERE sale_item_id=?', si.id).q;
      const qty = num(it.qty, 'cantidad', { min: 0.0001 });
      if (qty > r2(si.qty - done) + 1e-9) throw bad(`De "${si.name}" solo se pueden devolver ${r2(si.qty - done)}`);
      const paid = si.paid ?? si.price * si.qty;
      const amount = r2(paid / si.qty * qty), t = r2((si.tax ?? 0) / si.qty * qty);
      total += amount; tax += t;
      return { si, qty, amount, tax: t };
    });
    const r = run('INSERT INTO returns(sale_id,shift_id,employee_id,authorized_by,total,tax,method,reason) VALUES(?,?,?,?,?,?,?,?)', sale.id, shift.id, user.id, who.id, r2(total), r2(tax), method, reason);
    for (const x of rows) {
      run('INSERT INTO return_items(return_id,sale_item_id,product_id,qty,amount,tax) VALUES(?,?,?,?,?,?)', r.lastInsertRowid, x.si.id, x.si.product_id, x.qty, x.amount, x.tax);
      applyStock(x.si.product_id, 'devolucion_cliente', x.qty, `Devolución de venta #${sale.id}`);
    }
    return { id: r.lastInsertRowid, total: r2(total), method, authorized_by: who.name };
  });
});

// Importación CSV
route('POST', '/api/import/preview', ({ body, need }) => {
  need('productos');
  const plan = buildPlan(body.csv);
  if (plan.error) throw bad(plan.error);
  return plan;
});
route('POST', '/api/import/apply', ({ body, authorize }) => {
  const who = authorize('importar');           // PIN del dueño
  const plan = buildPlan(body.csv);
  if (plan.error) throw bad(plan.error);
  let created = 0, updated = 0;
  tx(() => {
    for (const r of plan.rows) {
      if (r.action === 'nuevo') {
        const p = run('INSERT INTO products(barcode,name,category,cost,price,min_stock,unit,tax_rate) VALUES(?,?,?,?,?,?,?,?)', r.barcode, r.name, r.category || '', r.cost ?? 0, r.price ?? 0, r.min_stock ?? 0, (r.unit || 'pieza').toLowerCase(), r.tax_rate ?? 16);
        if (r.stock) applyStock(p.lastInsertRowid, 'entrada', r.stock, 'Importación CSV');
        created++;
      } else if (r.action === 'actualizar') {
        const before = get('SELECT * FROM products WHERE id=?', r.existing_id);
        const next = { name: r.name || before.name, category: r.category || before.category, cost: r.cost ?? before.cost, price: r.price ?? before.price, tax_rate: r.tax_rate ?? before.tax_rate, min_stock: r.min_stock ?? before.min_stock, unit: r.unit ? r.unit.toLowerCase() : before.unit };
        run('UPDATE products SET name=?, category=?, cost=?, price=?, tax_rate=?, min_stock=?, unit=? WHERE id=?', next.name, next.category, next.cost, next.price, next.tax_rate, next.min_stock, next.unit, before.id);
        logPriceChange(before, next, who.name, 'importacion');
        if (r.stock) applyStock(before.id, 'entrada', r.stock, 'Importación CSV');
        updated++;
      }
    }
  });
  return { created, updated, skipped: plan.rows.length - created - updated };
});

// Analítica y reportes
route('GET', '/api/dashboard', ({ need }) => { need('reportes'); return dashboard(); });
route('GET', '/api/alerts', () => stockAlerts());
route('GET', '/api/expiry', () => expiryAlerts(7));
route('POST', '/api/assistant', async ({ body, need }) => { need('reportes'); return { answer: await ask(String(body.question || '')) }; });
route('GET', '/api/report', ({ query, need }) => {
  need('reportes');
  const today = get(`SELECT date('now','localtime') d`).d;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get('from') || '') ? query.get('from') : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get('to') || '') ? query.get('to') : from;
  const group = ['dia', 'turno', 'cajero', 'metodo', 'categoria', 'producto'].includes(query.get('group')) ? query.get('group') : 'dia';
  const rep = salesReport({ from, to, group });
  if (query.get('format') === 'csv') return { __raw: reportCSV(rep), type: 'text/csv; charset=utf-8', filename: `ventas-${from}_${to}.csv` };
  return rep;
});

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.map': 'application/json' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) reject(bad('Cuerpo demasiado grande')); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(bad('JSON inválido')); } });
    req.on('error', reject);
  });
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const token = req.headers['x-token'] || '';
        const user = sessionUser(token);
        if (!r.public && !user) throw new HttpError(401, 'Inicia sesión con tu PIN');
        const need = (perm) => { if (!can(user, perm)) throw new HttpError(403, 'No tienes permiso para esto'); };
        const authorize = (perm) => {
          if (can(user, perm)) return user;
          if (body.auth_pin) {
            const a = authorizerByPin(body.auth_pin, perm);
            if (a.error) throw new HttpError(403, a.error, { needs_auth: perm });
            return a.employee;
          }
          throw new HttpError(403, 'Requiere autorización con PIN', { needs_auth: perm });
        };
        const out = await r.handler({ params: m.slice(1), query: url.searchParams, body, user, token, need, authorize });
        if (out && out.__raw !== undefined) {
          res.writeHead(200, { 'content-type': out.type, 'content-disposition': `attachment; filename="${out.filename}"`, 'cache-control': 'no-store' });
          return res.end(out.__raw);
        }
        return send(200, out === undefined ? { ok: true } : out);
      }
      return send(404, { error: 'Ruta no encontrada' });
    }
    // Interfaz: la nueva (React, web/dist) en "/", la clásica (public/) en "/legacy/".
    // Si todavía no se compiló web/dist, "/" sirve la clásica.
    const legacy = url.pathname === '/legacy' || url.pathname.startsWith('/legacy/');
    const useDist = !legacy && fs.existsSync(path.join(DIST, 'index.html'));
    const base = useDist ? DIST : PUBLIC;
    const pathname = legacy ? url.pathname.slice('/legacy'.length) || '/' : url.pathname;
    let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    let file = path.resolve(base, rel);
    const ok = (f) => f.startsWith(base + path.sep) && fs.existsSync(f) && !fs.statSync(f).isDirectory();
    if (!ok(file) && useDist && !path.extname(rel)) file = path.join(base, 'index.html');   // rutas de la app de una sola página
    if (!ok(file)) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message, ...e.extra });
    console.error(e);
    send(500, { error: 'Error interno: ' + e.message });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  server.listen(PORT, () => console.log(`VENTAX en http://localhost:${PORT}  (BD: ${process.env.POS_DB || 'data/pos.db'})`));
}
