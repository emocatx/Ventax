// Reporte de ventas: cascada (brutas, descuentos, devoluciones, netas, IVA) y agrupaciones.
import { all, get } from './db.js';

const r2 = (n) => Math.round((n || 0) * 100) / 100;

export function salesReport({ from, to, group = 'dia' }) {
  const W = `date(s.created_at) BETWEEN ? AND ?`;
  const t = get(`SELECT COUNT(*) n, COALESCE(SUM(total+COALESCE(discount,0)),0) gross, COALESCE(SUM(discount),0) disc, COALESCE(SUM(tax),0) tax, COALESCE(SUM(total),0) total
                 FROM sales s WHERE ${W}`, from, to);
  const rt = get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(tax),0) tax FROM returns r WHERE date(r.created_at) BETWEEN ? AND ?`, from, to);
  const cost = get(`SELECT COALESCE(SUM(si.cost*si.qty),0) c FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE ${W}`, from, to).c;
  const net = r2(t.total - rt.total);
  const tax = r2(t.tax - rt.tax);
  const cascade = {
    gross: r2(t.gross), discounts: r2(t.disc), returns: r2(rt.total), net, tax, net_without_tax: r2(net - tax),
    tickets: t.n, returns_count: rt.n, avg_ticket: t.n ? r2(t.total / t.n) : 0,
    margin: r2(net - tax - cost + all(`SELECT COALESCE(SUM(si.cost*ri.qty),0) c FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id JOIN returns r ON r.id=ri.return_id WHERE date(r.created_at) BETWEEN ? AND ?`, from, to)[0].c),
  };
  const by_method = all(`SELECT method k, COUNT(*) tickets, SUM(total) total FROM sales s WHERE ${W} GROUP BY method`, from, to).map((r) => ({ ...r, total: r2(r.total) }));

  const keys = {
    dia: { s: `date(s.created_at)`, r: `date(r.created_at)`, label: (k) => k },
    cajero: { s: `COALESCE((SELECT name FROM employees WHERE id=s.employee_id), (SELECT cashier FROM shifts WHERE id=s.shift_id))`, r: `COALESCE((SELECT name FROM employees WHERE id=r.employee_id),'')`, label: (k) => k },
    metodo: { s: `s.method`, r: `r.method`, label: (k) => k },
    turno: { s: `COALESCE((SELECT d.name FROM shift_defs d JOIN shifts h ON h.shift_def_id=d.id WHERE h.id=s.shift_id), 'Sin turno')`, r: `COALESCE((SELECT d.name FROM shift_defs d JOIN shifts h ON h.shift_def_id=d.id WHERE h.id=r.shift_id), 'Sin turno')`, label: (k) => k },
  };
  let rows;
  if (keys[group]) {
    const k = keys[group];
    const sales = all(`SELECT ${k.s} k, COUNT(*) tickets, SUM(total+COALESCE(discount,0)) gross, SUM(COALESCE(discount,0)) disc, SUM(COALESCE(tax,0)) tax, SUM(total) total FROM sales s WHERE ${W} GROUP BY k`, from, to);
    const rets = all(`SELECT ${k.r} k, SUM(total) total, SUM(tax) tax FROM returns r WHERE date(r.created_at) BETWEEN ? AND ? GROUP BY k`, from, to);
    const rmap = new Map(rets.map((x) => [x.k, x]));
    rows = sales.map((x) => ({ key: x.k, tickets: x.tickets, gross: r2(x.gross), discounts: r2(x.disc), returns: r2(rmap.get(x.k)?.total), net: r2(x.total - (rmap.get(x.k)?.total || 0)), tax: r2(x.tax - (rmap.get(x.k)?.tax || 0)) }));
  } else {
    const col = group === 'categoria' ? 'p.category' : 'p.name';
    rows = all(`SELECT ${col} k, SUM(si.qty) qty, SUM(COALESCE(si.paid, si.price*si.qty)) total, SUM(COALESCE(si.tax,0)) tax,
                       SUM(COALESCE(si.net, si.price*si.qty) - si.cost*si.qty) margin
                FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id WHERE ${W} GROUP BY k`, from, to);
    const rets = new Map(all(`SELECT ${col} k, SUM(ri.qty) qty, SUM(ri.amount) amount, SUM(ri.tax) tax FROM return_items ri JOIN returns r ON r.id=ri.return_id JOIN products p ON p.id=ri.product_id
                             WHERE date(r.created_at) BETWEEN ? AND ? GROUP BY k`, from, to).map((x) => [x.k, x]));
    rows = rows.map((x) => ({ key: x.k || '(sin categoría)', qty: r2(x.qty - (rets.get(x.k)?.qty || 0)), net: r2(x.total - (rets.get(x.k)?.amount || 0)), tax: r2(x.tax - (rets.get(x.k)?.tax || 0)), returns: r2(rets.get(x.k)?.amount), margin: r2(x.margin) }));
  }
  rows.sort((a, b) => (group === 'dia' ? String(a.key).localeCompare(b.key) : b.net - a.net));
  return { from, to, group, cascade, by_method, rows };
}

export function reportCSV(rep) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Periodo', `${rep.from} a ${rep.to}`], ['Ventas brutas', rep.cascade.gross], ['Descuentos', rep.cascade.discounts], ['Devoluciones', rep.cascade.returns],
    ['Ventas netas', rep.cascade.net], ['IVA incluido', rep.cascade.tax], ['Ventas netas sin IVA', rep.cascade.net_without_tax], [], ['Agrupado por', rep.group]];
  const cols = rep.rows[0] ? Object.keys(rep.rows[0]) : [];
  return '﻿' + [...lines.map((l) => l.map(q).join(',')), cols.map(q).join(','), ...rep.rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
}
