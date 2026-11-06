import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { useStore } from '../store';
import { toastErr } from '../ui';
import { money, qtyFmt } from '../util';
import { Title } from './Placeholder';

interface Top { name: string; qty: number; revenue: number; margin: number }
interface Dash {
  today: { total: number; tickets: number; avg: number; margin: number }; yesterday: { avg: number };
  vs_yesterday: number | null; vs_last_week: number | null; margin_pct: number;
  top_sellers: Top[]; top_margin: Top[]; ghosts: { id: number; name: string; stock: number; capital: number }[]; ghost_capital: number;
  heatmap: { cells: { dow: number; hour: number; tickets: number }[]; hourly: { hour: number; tickets: number }[]; peak: { hour: number }[] };
  alerts: { name: string; level: string; reason: string }[]; expiring: { name: string; days_left: number }[];
  prediction: { days: number; estimate: number; avg_daily: number };
}
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function Pct({ v }: { v: number | null }) {
  if (v === null) return <span className="muted">sin datos</span>;
  return <span className={v >= 0 ? 'up' : 'down'}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}%</span>;
}

export function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [by, setBy] = useState<'qty' | 'margin'>('qty');
  useEffect(() => { api<Dash>('/dashboard').then(setD).catch(toastErr); }, []);
  if (!d) return <Title text="Dashboard" />;

  const urgent = d.alerts.find((a) => a.level === 'critico');
  const finding = urgent ? `${urgent.name}: ${urgent.reason}.` : d.expiring[0] ? `${d.expiring[0].name} caduca ${d.expiring[0].days_left <= 0 ? 'ya' : `en ${d.expiring[0].days_left} día(s)`}.` : '';
  const list = by === 'qty' ? d.top_sellers : d.top_margin;
  const max = Math.max(1, ...list.map((x) => x[by]));
  const maxH = Math.max(1, ...d.heatmap.hourly.map((h) => h.tickets));
  const cells = new Map(d.heatmap.cells.map((c) => [`${c.dow}-${c.hour}`, c.tickets]));
  const maxC = Math.max(1, ...d.heatmap.cells.map((c) => c.tickets));
  const lvl = (n: number) => (!n ? 0 : n / maxC > 0.66 ? 3 : n / maxC > 0.33 ? 2 : 1);

  return (
    <>
      <Title text="Dashboard" />
      {finding && <p className="finding"><b>Hallazgo de hoy:</b> {finding} <a href="#" onClick={(e) => { e.preventDefault(); useStore.getState().setTab('alertas'); }}>Ver alertas</a></p>}
      <div className="kpis">
        <div className="kpi"><div className="l">Total cobrado hoy (neto de devoluciones)</div><div className="v lead">{money(d.today.total)}</div><div className="l">vs ayer <Pct v={d.vs_yesterday} /> · vs hace 7 días <Pct v={d.vs_last_week} /></div></div>
        <div className="kpi"><div className="l">Ticket promedio</div><div className="v">{money(d.today.avg)}</div><div className="l">{d.today.tickets} tickets · ayer {money(d.yesterday.avg)}</div></div>
        <div className="kpi"><div className="l">Margen bruto hoy (sin IVA)</div><div className="v">{money(d.today.margin)}</div><div className="l">{d.margin_pct}% de las ventas</div></div>
        <div className="kpi"><div className="l">Proyección {d.prediction.days} días</div><div className="v">{money(d.prediction.estimate)}</div><div className="l">prom. diario {money(d.prediction.avg_daily)}</div></div>
      </div>
      <div className="cols">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Top 10 productos (30 días)</h3>
          <div className="seg"><button className={by === 'qty' ? 'on' : ''} onClick={() => setBy('qty')}>Por volumen</button><button className={by === 'margin' ? 'on' : ''} onClick={() => setBy('margin')}>Por utilidad</button></div>
          {list.map((x, i) => (
            <div className="hbar" key={x.name}>
              <span title={x.name}>{x.name}</span>
              <span className="t"><motion.i key={by} initial={{ width: 0 }} animate={{ width: `${(x[by] / max) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.03 }} /></span>
              <span>{by === 'margin' ? money(x.margin) : qtyFmt(x.qty)}</span>
            </div>
          ))}
          {!list.length && <p className="muted">Sin datos</p>}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Productos fantasma</h3>
          <p className="muted">Sin ventas en 30 días · capital inmovilizado: <b>{money(d.ghost_capital)}</b></p>
          {d.ghosts.map((x) => <div key={x.id}>{x.name} — {qtyFmt(x.stock)} ({money(x.capital)})</div>)}
          {!d.ghosts.length && <p className="muted">Sin datos</p>}
        </div>
      </div>
      <div className="cols">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Tickets por hora (30 días)</h3>
          <div className="bars">{d.heatmap.hourly.map((h) => <motion.div key={h.hour} title={`${h.hour}:00 — ${h.tickets} tickets`} initial={{ height: 0 }} animate={{ height: `${(h.tickets / maxH) * 100}%` }} transition={{ duration: 0.5, delay: h.hour * 0.015 }} />)}</div>
          <div className="axis">{d.heatmap.hourly.map((h) => <span key={h.hour}>{h.hour % 3 === 0 ? h.hour : ''}</span>)}</div>
          <p className="muted">Horas pico: {d.heatmap.peak.map((p) => p.hour + ':00').join(', ') || '—'}</p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Mapa de calor de horas pico</h3>
          <div className="heat">
            <span />{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 6 === 0 ? h : ''}</span>)}
            {[1, 2, 3, 4, 5, 6, 0].map((dw) => [
              <span key={`l${dw}`}>{DOW[dw]}</span>,
              ...Array.from({ length: 24 }, (_, h) => { const n = cells.get(`${dw}-${h}`) ?? 0; return <i key={`${dw}-${h}`} style={{ background: `var(--heat${lvl(n)})` }} title={`${DOW[dw]} ${h}:00 — ${n} tickets`} />; }),
            ])}
          </div>
        </div>
      </div>
    </>
  );
}
