import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, getToken } from '../api';
import { toastErr } from '../ui';
import { money, qtyFmt } from '../util';
import { Title } from './Placeholder';

interface Report {
  from: string; to: string; group: string;
  cascade: { gross: number; discounts: number; returns: number; net: number; tax: number; net_without_tax: number; tickets: number; returns_count: number; avg_ticket: number; margin: number };
  by_method: { k: string; tickets: number; total: number }[];
  rows: Record<string, string | number>[];
}
type Preset = 'hoy' | 'ayer' | '7d' | 'mes' | 'rango';
const GROUPS = { dia: 'Día', turno: 'Turno', cajero: 'Cajero', metodo: 'Método de pago', categoria: 'Categoría', producto: 'Producto' } as const;
type Group = keyof typeof GROUPS;
const LBL: Record<string, string> = { tickets: 'Tickets', gross: 'Brutas', discounts: 'Descuentos', returns: 'Devoluciones', net: 'Netas', tax: 'IVA', qty: 'Cantidad', margin: 'Margen' };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function presetRange(p: Preset): [string, string] {
  const t = new Date();
  if (p === 'ayer') return [ymd(addDays(t, -1)), ymd(addDays(t, -1))];
  if (p === '7d') return [ymd(addDays(t, -6)), ymd(t)];
  if (p === 'mes') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)];
  return [ymd(t), ymd(t)];
}

export function Reportes() {
  const [preset, setPreset] = useState<Preset>('hoy');
  const [[from, to], setRange] = useState(presetRange('hoy'));
  const [group, setGroup] = useState<Group>('dia');
  const [rep, setRep] = useState<Report | null>(null);

  useEffect(() => { api<Report>(`/report?from=${from}&to=${to}&group=${group}`).then(setRep).catch(toastErr); }, [from, to, group]);

  const choose = (p: Preset) => { setPreset(p); if (p !== 'rango') setRange(presetRange(p)); };
  const move = (dir: number) => {
    const f = new Date(from + 'T00:00'), t = new Date(to + 'T00:00');
    if (preset === 'mes') { setRange([ymd(new Date(f.getFullYear(), f.getMonth() + dir, 1)), ymd(new Date(f.getFullYear(), f.getMonth() + dir + 1, 0))]); return; }
    const span = Math.round((t.getTime() - f.getTime()) / 864e5) + 1;
    setRange([ymd(addDays(f, dir * span)), ymd(addDays(t, dir * span))]); setPreset('rango');
  };
  const exportCsv = async () => {
    try {
      const res = await fetch(`/api/report?from=${from}&to=${to}&group=${group}&format=csv`, { headers: { 'x-token': getToken() } });
      if (!res.ok) throw new Error('No se pudo exportar');
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `ventas-${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toastErr(e); }
  };
  const print = () => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); };

  const c = rep?.cascade;
  const cols = rep?.rows[0] ? Object.keys(rep.rows[0]) : [];
  return (
    <>
      <Title text="Reportes" sub={from === to ? from : `${from} al ${to}`} />
      <div className="repctl">
        <div className="seg">{(['hoy', 'ayer', '7d', 'mes', 'rango'] as Preset[]).map((p) => <button key={p} className={preset === p ? 'on' : ''} onClick={() => choose(p)}>{{ hoy: 'Hoy', ayer: 'Ayer', '7d': '7 días', mes: 'Mes', rango: 'Rango' }[p]}</button>)}</div>
        <button aria-label="Periodo anterior" onClick={() => move(-1)}>‹</button>
        <input type="date" value={from} aria-label="Desde" onChange={(e) => { setPreset('rango'); setRange([e.target.value, e.target.value > to ? e.target.value : to]); }} />
        <input type="date" value={to} aria-label="Hasta" onChange={(e) => { setPreset('rango'); setRange([e.target.value < from ? e.target.value : from, e.target.value]); }} />
        <button aria-label="Periodo siguiente" onClick={() => move(1)}>›</button>
        <select value={group} onChange={(e) => setGroup(e.target.value as Group)} aria-label="Agrupar por">{(Object.keys(GROUPS) as Group[]).map((k) => <option key={k} value={k}>Agrupar por {GROUPS[k].toLowerCase()}</option>)}</select>
        <span className="grow" />
        <button onClick={() => void exportCsv()}>Exportar CSV</button><button onClick={print}>Imprimir</button>
      </div>
      {c && rep && (
        <motion.div key={`${from}${to}${group}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <div className="kpis">
            <div className="kpi"><div className="l">Ventas brutas</div><div className="v">{money(c.gross)}</div></div>
            <div className="kpi"><div className="l">− Descuentos</div><div className="v">{money(c.discounts)}</div></div>
            <div className="kpi"><div className="l">− Devoluciones ({c.returns_count})</div><div className="v">{money(c.returns)}</div></div>
            <div className="kpi"><div className="l">= Ventas netas</div><div className="v lead">{money(c.net)}</div></div>
          </div>
          <div className="cols">
            <div className="card"><table><tbody>
              <tr><td>IVA incluido</td><td className="n">{money(c.tax)}</td></tr>
              <tr><td>Ventas netas sin IVA</td><td className="n">{money(c.net_without_tax)}</td></tr>
              <tr><td>Margen bruto (sin IVA)</td><td className="n">{money(c.margin)}</td></tr>
              <tr><td>Tickets · promedio</td><td className="n">{c.tickets} · {money(c.avg_ticket)}</td></tr>
            </tbody></table></div>
            <div className="card"><h3 style={{ marginTop: 0 }}>Por método de pago</h3><table><tbody>
              {rep.by_method.map((m) => <tr key={m.k}><td>{m.k}</td><td className="n">{m.tickets} tickets</td><td className="n">{money(m.total)}</td></tr>)}
              {!rep.by_method.length && <tr><td className="muted">Sin ventas</td></tr>}
            </tbody></table></div>
          </div>
          <h3>Detalle por {GROUPS[group].toLowerCase()}</h3>
          <div className="tablewrap"><table>
            <thead><tr>{cols.map((k) => <th key={k} className={k === 'key' ? '' : 'n'}>{k === 'key' ? GROUPS[group] : LBL[k] ?? k}</th>)}</tr></thead>
            <tbody>
              {rep.rows.map((r, i) => <tr key={i}>{cols.map((k) => <td key={k} className={k === 'key' ? '' : 'n'}>{k === 'key' ? String(r[k]) : ['tickets', 'qty'].includes(k) ? qtyFmt(Number(r[k])) : money(Number(r[k]))}</td>)}</tr>)}
              {!rep.rows.length && <tr><td className="muted" colSpan={Math.max(1, cols.length)}>No hay ventas en este periodo</td></tr>}
            </tbody>
          </table></div>
        </motion.div>
      )}
    </>
  );
}
