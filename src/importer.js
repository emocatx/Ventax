// Importador CSV: vista previa (con % de cambio) y aplicación.
import { get } from './db.js';

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const SYN = {
  barcode: ['codigo', 'codigodebarras', 'barcode', 'ean', 'sku'],
  name: ['nombre', 'producto', 'descripcion', 'name'],
  cost: ['costo', 'cost', 'preciocosto'],
  price: ['precio', 'preciopublico', 'preciodeventa', 'price', 'pvp'],
  stock: ['stock', 'existencia', 'existencias', 'cantidad', 'inventario'],
  category: ['categoria', 'category', 'departamento'],
  unit: ['unidad', 'unit'],
  tax_rate: ['iva', 'impuesto', 'tasaiva'],
  min_stock: ['minimo', 'stockminimo', 'min'],
};
const toNum = (v) => { const n = Number(String(v ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };

export function buildPlan(text) {
  const table = parseCSV(text);
  if (table.length < 2) return { error: 'El archivo no tiene filas de datos' };
  const head = table[0].map(norm), idx = {};
  for (const [k, names] of Object.entries(SYN)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) idx[k] = i; }
  if (idx.name === undefined) return { error: 'Falta la columna "nombre"' };
  const rows = table.slice(1).map((r, n) => {
    const v = (k) => (idx[k] === undefined ? undefined : (r[idx[k]] ?? '').trim());
    const item = { line: n + 2, barcode: v('barcode') || null, name: v('name'), category: v('category'), unit: v('unit'),
      cost: v('cost') === undefined || v('cost') === '' ? undefined : toNum(v('cost')),
      price: v('price') === undefined || v('price') === '' ? undefined : toNum(v('price')),
      stock: v('stock') === undefined || v('stock') === '' ? undefined : toNum(v('stock')),
      tax_rate: v('tax_rate') === undefined || v('tax_rate') === '' ? undefined : toNum(String(v('tax_rate')).replace('%', '')),
      min_stock: v('min_stock') === undefined || v('min_stock') === '' ? undefined : toNum(v('min_stock')) };
    const errs = [];
    if (!item.name) errs.push('sin nombre');
    for (const k of ['cost', 'price', 'stock', 'tax_rate', 'min_stock']) if (item[k] !== undefined && (Number.isNaN(item[k]) || item[k] < 0)) errs.push(`${k} inválido`);
    if (item.unit && !['pieza', 'kg', 'g', 'l'].includes(item.unit.toLowerCase())) errs.push('unidad inválida (pieza, kg, g, l)');
    const existing = item.barcode ? get('SELECT * FROM products WHERE barcode=?', item.barcode) : null;
    let action = errs.length ? 'error' : existing ? 'actualizar' : 'nuevo';
    let pct = null, big = false;
    if (existing && item.price !== undefined && existing.price > 0 && !errs.length) {
      pct = Math.round(((item.price - existing.price) / existing.price) * 1000) / 10;
      big = Math.abs(pct) > 30;
      if (item.price === existing.price && (item.cost === undefined || item.cost === existing.cost) && !item.stock) action = 'sin cambios';
    }
    if (!existing && action === 'nuevo' && item.price === undefined) { errs.push('producto nuevo sin precio'); action = 'error'; }
    return { ...item, action, errors: errs, existing_id: existing?.id, old_price: existing?.price, old_cost: existing?.cost, pct, big };
  });
  const count = (a) => rows.filter((r) => r.action === a).length;
  return { rows, summary: { nuevo: count('nuevo'), actualizar: count('actualizar'), sin_cambios: count('sin cambios'), error: count('error'), cambios_grandes: rows.filter((r) => r.big).length } };
}
