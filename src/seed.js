// Datos demo: catálogo de abarrotes + 30 días de ventas con horas pico realistas.
// Uso: npm run seed   (se niega a correr si ya hay productos)
// Escribe SIEMPRE en la base de demostración (data/demo.db), nunca en la real.
import path from 'node:path';
import fs from 'node:fs';
process.env.POS_DB ||= path.join(import.meta.dirname, '..', 'data', 'demo.db');
if (process.argv.includes('--reset')) {          // npm run seed -- --reset  → recrea solo la base de demostración
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(process.env.POS_DB + ext, { force: true });
}
const { db, get, run, tx, setSettings } = await import('./db.js');
const { hashPin } = await import('./auth.js');

if (get('SELECT COUNT(*) n FROM products').n > 0) {
  console.error('La base de demostración ya tiene productos. Borra data/demo.db si quieres re-sembrar.');
  process.exit(1);
}

// Empleados de DEMOSTRACIÓN (PIN solo para pruebas; la base real usa el asistente de primer arranque).
const DEMO_STAFF = [
  { name: 'Carlos', role: 'dueno', pin: '1357' }, { name: 'Marta', role: 'encargado', pin: '2468' },
  { name: 'Ana', role: 'cajero', pin: '1122', def: 0 }, { name: 'Luis', role: 'cajero', pin: '3344', def: 1 },
];
const ZERO_TAX = ['Lácteos', 'Frutas y Verduras', 'Abarrotes', 'Panadería'];

const products = [
  // [codigo, nombre, categoria, costo, precio, stock, min, max, popularidad]
  ['7501055300013', 'Coca-Cola 600ml', 'Bebidas', 12, 18, 60, 24, 120, 10],
  ['7501055300020', 'Agua Ciel 1L', 'Bebidas', 7, 12, 40, 20, 100, 8],
  ['7501000111206', 'Sabritas Original 45g', 'Botanas', 11, 17, 35, 15, 80, 7],
  ['7501000111305', 'Doritos Nacho 62g', 'Botanas', 12, 18, 28, 15, 80, 6],
  ['7501020540017', 'Leche Lala 1L', 'Lácteos', 20, 27, 18, 12, 48, 9],
  ['7501020540024', 'Yoghurt Lala Fresa', 'Lácteos', 8, 13, 25, 10, 40, 3, 'pieza', 2],
  ['7501030400012', 'Pan Bimbo Blanco', 'Panadería', 34, 46, 8, 6, 24, 6],
  ['7501030400029', 'Gansito Marinela', 'Dulces', 11, 17, 30, 12, 60, 5],
  ['7501060800015', 'Huevo 12 pzas', 'Abarrotes', 38, 52, 14, 8, 30, 7],
  ['7501060800022', 'Aceite 1-2-3 1L', 'Abarrotes', 36, 46, 10, 6, 24, 3],
  ['7501060800039', 'Arroz Verde Valle 1kg', 'Abarrotes', 22, 31, 12, 6, 24, 3],
  ['7501060800046', 'Frijol Negro 900g', 'Abarrotes', 28, 38, 9, 6, 24, 3],
  ['7501070900011', 'Cloro Cloralex 1L', 'Limpieza', 16, 24, 11, 6, 20, 2],
  ['7501070900028', 'Jabón Zote 400g', 'Limpieza', 14, 21, 14, 6, 24, 2],
  ['7501070900035', 'Papel Higiénico 4 rollos', 'Limpieza', 30, 42, 20, 8, 36, 4],
  ['7501080100018', 'Cerveza Corona 355ml', 'Bebidas', 17, 26, 48, 24, 144, 9],
  ['7501080100025', 'Refresco Jarritos 600ml', 'Bebidas', 11, 17, 22, 12, 60, 4],
  ['7501090200014', 'Chicles Trident', 'Dulces', 9, 15, 40, 12, 60, 4],
  ['7501090200021', 'Paleta Payaso', 'Dulces', 14, 22, 20, 8, 40, 2],
  ['7501100300017', 'Sal La Fina 1kg', 'Abarrotes', 9, 15, 15, 6, 24, 1],
  // a granel (kg) — décimo campo = unidad, onceavo = días para caducar
  ['7501200500011', 'Plátano (kg)', 'Frutas y Verduras', 14, 24, 18, 8, 40, 6, 'kg', 4],
  ['7501200500028', 'Manzana (kg)', 'Frutas y Verduras', 32, 48, 12, 6, 30, 4, 'kg', 6],
  ['7501200500035', 'Jitomate (kg)', 'Frutas y Verduras', 16, 28, 15, 8, 30, 5, 'kg', 3],
  // productos "fantasma": con stock pero sin ventas
  ['7501110400012', 'Salsa Teriyaki 250ml', 'Abarrotes', 42, 65, 12, 3, 12, 0],
  ['7501110400029', 'Atún en aceite lata', 'Abarrotes', 19, 28, 24, 6, 24, 0],
];

// Pesos por hora (picos: 8-9, 13-15, 18-20)
const HOUR_W = { 8: 6, 9: 5, 10: 3, 11: 3, 12: 5, 13: 8, 14: 8, 15: 5, 16: 3, 17: 5, 18: 9, 19: 9, 20: 6, 21: 2 };
const DOW_W = [1.1, 0.8, 0.8, 0.85, 0.9, 1.2, 1.4]; // dom..sáb

const pick = (weights) => {
  const entries = Object.entries(weights);
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) <= 0) return Number(k); }
  return Number(entries.at(-1)[0]);
};
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

tx(() => {
  setSettings({ business_name: 'Abarrotes Demo', giro: 'abarrotes', open_hours: 14, configured: 1, shifts_enabled: 1, encargado_enabled: 1, encargado_perms: 'descuentos,devoluciones,productos,reportes' });
  const defIds = [['Matutino', '06:00', '14:00'], ['Vespertino', '14:00', '22:00'], ['Nocturno', '22:00', '06:00']]
    .map(([n, s, e], i) => run('INSERT INTO shift_defs(name,start,end,position) VALUES(?,?,?,?)', n, s, e, i).lastInsertRowid);
  const staff = DEMO_STAFF.map((s) => ({ ...s, id: run('INSERT INTO employees(name,pin_hash,role,shift_def_id) VALUES(?,?,?,?)', s.name, hashPin(s.pin), s.role, s.def === undefined ? null : defIds[s.def]).lastInsertRowid }));
  const cashierStaff = staff.filter((s) => s.role === 'cajero');
  const ids = [];
  for (const [code, name, cat, cost, price, , min, max, pop, unit = 'pieza', expDays] of products) {
    const exp = expDays === undefined ? null : fmt(new Date(Date.now() + expDays * 864e5)).slice(0, 10);
    const tax = ZERO_TAX.includes(cat) ? 0 : 16;
    const r = run('INSERT INTO products(barcode,name,category,cost,price,stock,min_stock,max_stock,unit,expires_at,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?)', code, name, cat, cost, price, 0, min, max, unit, exp, tax);
    ids.push({ id: r.lastInsertRowid, name, cost, price, pop, tax, stock: products.find((p) => p[0] === code)[5] });
  }
  // Stock de partida alto para que el histórico de ventas no lo deje en negativo; se ajusta al final.
  const sold = new Map(ids.map((p) => [p.id, 0]));
  const sellable = ids.filter((p) => p.pop > 0);
  const popW = Object.fromEntries(sellable.map((p) => [p.id, p.pop]));
  const now = new Date();

  for (let back = 29; back >= 0; back--) {
    const day = new Date(now); day.setDate(day.getDate() - back); day.setHours(0, 0, 0, 0);
    const isToday = back === 0;
    const open = new Date(day); open.setHours(7, 45, 0);
    const cashier = cashierStaff[back % 2];
    const shift = run('INSERT INTO shifts(cashier, employee_id, shift_def_id, opened_at, opening_float) VALUES(?,?,?,?,?)', cashier.name, cashier.id, defIds[back % 2], fmt(open), 500).lastInsertRowid;
    const nSales = Math.round((40 + Math.random() * 15) * DOW_W[day.getDay()]);
    let cash = 500;
    for (let i = 0; i < nSales; i++) {
      const h = pick(HOUR_W);
      const t = new Date(day); t.setHours(h, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));
      if (isToday && t > now) continue;
      const method = ['efectivo', 'efectivo', 'efectivo', 'tarjeta', 'transferencia'][Math.floor(Math.random() * 5)];
      const nLines = 1 + Math.floor(Math.random() * 4);
      const lines = new Map();
      for (let l = 0; l < nLines; l++) {
        const pid = pick(popW);
        lines.set(pid, (lines.get(pid) || 0) + 1 + (Math.random() < 0.2 ? 1 : 0));
      }
      const r2 = (n) => Math.round(n * 100) / 100;
      const calc = [...lines].map(([pid, q]) => { const p = ids.find((x) => x.id === pid); const paid = r2(p.price * q); const net = r2(paid / (1 + p.tax / 100)); return { pid, q, p, paid, net, tax: r2(paid - net) }; });
      const total = r2(calc.reduce((s, c) => s + c.paid, 0)), taxSum = r2(calc.reduce((s, c) => s + c.tax, 0));
      const sale = run('INSERT INTO sales(shift_id,employee_id,created_at,total,subtotal,tax,discount,method,cash_received,change_given) VALUES(?,?,?,?,?,?,?,?,?,?)',
        shift, cashier.id, fmt(t), total, r2(total - taxSum), taxSum, 0, method, method === 'efectivo' ? total : null, method === 'efectivo' ? 0 : null).lastInsertRowid;
      if (method === 'efectivo') cash += total;
      for (const { pid, q, p, paid, net, tax } of calc) {
        run('INSERT INTO sale_items(sale_id,product_id,name,qty,price,cost,tax_rate,net,tax,paid) VALUES(?,?,?,?,?,?,?,?,?,?)', sale, pid, p.name, q, p.price, p.cost, p.tax, net, tax, paid);
        run('INSERT INTO stock_moves(product_id,type,qty,note,created_at) VALUES(?,?,?,?,?)', pid, 'venta', -q, `Venta #${sale}`, fmt(t));
        sold.set(pid, sold.get(pid) + q);
      }
    }
    if (!isToday) {
      const close = new Date(day); close.setHours(22, 0, 0);
      const counted = cash + (Math.random() < 0.3 ? -Math.floor(Math.random() * 20) : 0);
      run(`UPDATE shifts SET status='closed', closed_at=?, expected_cash=?, counted_cash=?, difference=? WHERE id=?`, fmt(close), cash, counted, counted - cash, shift);
    }
  }
  // Stock final = el definido arriba (los movimientos de venta quedan como histórico).
  for (const p of ids) run('UPDATE products SET stock=? WHERE id=?', p.stock, p.id);
});

console.log('Datos demo cargados:', get('SELECT COUNT(*) n FROM products').n, 'productos,', get('SELECT COUNT(*) n FROM sales').n, 'ventas.');
db.close();
