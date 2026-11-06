// Base de datos local SQLite (módulo nativo node:sqlite, sin dependencias).
// Funciona 100% offline. La sincronización a la nube (PostgreSQL) es Fase 4.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const file = process.env.POS_DB || path.join(root, 'data', 'pos.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS products (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode   TEXT UNIQUE,
  name      TEXT NOT NULL,
  category  TEXT DEFAULT '',
  cost      REAL NOT NULL DEFAULT 0,
  price     REAL NOT NULL DEFAULT 0,
  stock     REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  max_stock REAL NOT NULL DEFAULT 0,
  unit      TEXT NOT NULL DEFAULT 'pieza',   -- pieza | kg | g | l
  image     TEXT DEFAULT '',
  expires_at TEXT,                            -- YYYY-MM-DD (opcional)
  active   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier       TEXT NOT NULL,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at     TEXT,
  opening_float REAL NOT NULL DEFAULT 0,
  expected_cash REAL,
  counted_cash  REAL,
  difference    REAL,
  status        TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS cash_moves (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  type     TEXT NOT NULL CHECK (type IN ('in','out')),
  amount   REAL NOT NULL,
  note     TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id      INTEGER NOT NULL REFERENCES shifts(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  total         REAL NOT NULL,
  method        TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta','transferencia')),
  cash_received REAL,
  change_given  REAL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,
  qty        REAL NOT NULL,
  price      REAL NOT NULL,
  cost       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type       TEXT NOT NULL,
  qty        REAL NOT NULL,          -- con signo: + entra, - sale
  note       TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_items_prod ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_moves_prod ON stock_moves(product_id);
`);

// ---- Fase 1-3: empleados, turnos configurables, IVA, descuentos, devoluciones, historial ----
export const dataDir = path.dirname(file);
db.exec(`
CREATE TABLE IF NOT EXISTS shift_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  pin_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('dueno','encargado','cajero')),
  shift_def_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id),
  old_price REAL, new_price REAL, old_cost REAL, new_cost REAL, changed_by TEXT, source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL REFERENCES sales(id), shift_id INTEGER REFERENCES shifts(id),
  employee_id INTEGER, authorized_by INTEGER, total REAL NOT NULL, tax REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL, reason TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER NOT NULL REFERENCES returns(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), product_id INTEGER NOT NULL,
  qty REAL NOT NULL, amount REAL NOT NULL, tax REAL NOT NULL DEFAULT 0
);
`);
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('products', 'tax_rate', 'REAL NOT NULL DEFAULT 16');
for (const [c, d] of [['employee_id', 'INTEGER'], ['shift_def_id', 'INTEGER'], ['handover_from', 'INTEGER'], ['handover_expected', 'REAL'], ['handover_diff', 'REAL']]) addColumn('shifts', c, d);
for (const [c, d] of [['employee_id', 'INTEGER'], ['subtotal', 'REAL'], ['tax', 'REAL DEFAULT 0'], ['discount', 'REAL DEFAULT 0'], ['discount_reason', 'TEXT'], ['authorized_by', 'INTEGER']]) addColumn('sales', c, d);
for (const [c, d] of [['tax_rate', 'REAL DEFAULT 0'], ['net', 'REAL'], ['tax', 'REAL'], ['paid', 'REAL']]) addColumn('sale_items', c, d);

export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Configuración / multi-giro ----
export const GIROS = {
  abarrotes:  { label: 'Abarrotes / Tienda',  categories: ['Bebidas', 'Botanas', 'Lácteos', 'Abarrotes', 'Limpieza', 'Dulces', 'Panadería'] },
  ferreteria: { label: 'Ferretería',          categories: ['Herramientas', 'Tornillería', 'Electricidad', 'Plomería', 'Pintura', 'Construcción'] },
  boutique:   { label: 'Boutique / Ropa',     categories: ['Blusas', 'Pantalones', 'Vestidos', 'Calzado', 'Accesorios'] },
  papeleria:  { label: 'Papelería',           categories: ['Cuadernos', 'Escritura', 'Oficina', 'Arte', 'Copias y servicios'] },
  otro:       { label: 'Otro',                categories: ['General'] },
};

export const ENCARGADO_PERMS = ['productos', 'descuentos', 'devoluciones', 'reportes'];
const DEFAULTS = {
  business_name: 'Mi Negocio', giro: 'abarrotes', open_hours: '12', configured: '0',
  shifts_enabled: '1', encargado_enabled: '0', encargado_perms: 'descuentos,devoluciones', backup_dir: '',
};

export function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

export function setSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULTS)) continue;
    run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  }
}
