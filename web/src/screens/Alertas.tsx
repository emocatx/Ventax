import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { useCan, useStore } from '../store';
import { toastErr, useUi } from '../ui';
import type { Product } from '../types';
import { qtyFmt } from '../util';
import { Title } from './Placeholder';

interface StockAlert { id: number; name: string; barcode: string | null; stock: number; level: 'critico' | 'aviso'; reason: string; suggested: number }
interface ExpiryAlert { id: number; name: string; barcode: string | null; stock: number; expires_at: string; days_left: number; suggest_discount: number }

const rise = (i: number) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: Math.min(i, 10) * 0.03, duration: 0.2 } });

export function Alertas() {
  const canAct = useCan('productos');
  const [data, setData] = useState<{ a: StockAlert[]; e: ExpiryAlert[]; ok: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, e, p] = await Promise.all([api<StockAlert[]>('/alerts'), api<ExpiryAlert[]>('/expiry'), api<Product[]>('/products')]);
        setData({ a, e, ok: p.filter((x) => x.level === 'ok').length });
      } catch (er) { toastErr(er); }
    })();
  }, []);

  const go = (barcode: string | null, type: 'entrada' | 'merma', qty: number) => {
    useUi.getState().set({ stockPrefill: { barcode: barcode ?? '', type, qty: qty ? String(qty) : '', note: type === 'merma' ? 'Caducidad' : 'Reabasto' } });
    useStore.getState().setTab('inventario');
  };

  if (!data) return <Title text="Alertas" />;
  const red = data.a.filter((x) => x.level === 'critico'), yel = data.a.filter((x) => x.level === 'aviso');
  const sub = red.length || data.e.length ? `${red.length} por agotarse y ${data.e.length} por caducar${red[0] ? '. Lo más urgente: ' + red[0].name : ''}` : 'Todo el inventario está en orden';
  const Card = ({ a, i }: { a: StockAlert; i: number }) => (
    <motion.div className={`alert ${a.level}`} {...rise(i)}>
      <div><b>{a.name}</b><br /><span className="muted">{a.reason}.{a.suggested ? ` Pedir ~${a.suggested}.` : ''}</span></div>
      {canAct && <button onClick={() => go(a.barcode, 'entrada', a.suggested)}>Registrar entrada</button>}
    </motion.div>
  );
  return (
    <>
      <Title text="Alertas" sub={sub} />
      <div className="kpis">
        <div className="kpi"><div className="l">En orden</div><div className="v">{data.ok}</div></div>
        <div className="kpi"><div className="l">Stock bajo</div><div className="v">{yel.length}</div></div>
        <div className="kpi"><div className="l">Escasez inminente</div><div className="v">{red.length}</div></div>
        <div className="kpi"><div className="l">Por caducar en 7 días</div><div className="v">{data.e.length}</div></div>
      </div>
      <div className="cols">
        <div>
          <h3>Escasez inminente</h3>
          <div className="alerts">{red.map((a, i) => <Card key={a.id} a={a} i={i} />)}{!red.length && <p className="muted">Nada crítico</p>}</div>
          <h3>Stock bajo</h3>
          <div className="alerts">{yel.map((a, i) => <Card key={a.id} a={a} i={i} />)}{!yel.length && <p className="muted">Sin avisos</p>}</div>
        </div>
        <div>
          <h3>Próximos a caducar</h3>
          <div className="alerts">
            {data.e.map((e, i) => (
              <motion.div key={e.id} className="alert exp" {...rise(i)}>
                <div><b>{e.name}</b><br /><span className="muted">{e.days_left <= 0 ? 'Vencido' : `Caduca en ${e.days_left} día(s)`} ({e.expires_at}) · {qtyFmt(e.stock)} en stock · sugerido {e.suggest_discount}% de descuento</span></div>
                {canAct && <button onClick={() => go(e.barcode, 'merma', e.stock)}>Registrar merma</button>}
              </motion.div>
            ))}
            {!data.e.length && <p className="muted">Nada por caducar</p>}
          </div>
        </div>
      </div>
    </>
  );
}
