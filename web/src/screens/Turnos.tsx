import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, setToken } from '../api';
import { useStore, useCan } from '../store';
import { money } from '../util';
import { Modal } from '../components/Modal';
import { Title } from './Placeholder';

interface Summary {
  shift: { id: number; cashier: string; opened_at: string; opening_float: number; handover_diff: number | null; shift_name: string | null } | null;
  by_method: Record<string, number>; refunds: number; cash_in: number; cash_out: number; tickets: number; mine: boolean; can_close: boolean;
  handover_from: { cashier: string } | null;
}
interface Closed { expected_cash: number; counted_cash: number; difference: number; by_method: Record<string, number>; refunds: number; tickets: number; backup_file: string | null; backup_error: string | null }
interface HistoryRow { id: number; shift_name: string | null; cashier: string; opened_at: string; closed_at: string; expected_cash: number; counted_cash: number; difference: number; handover_diff: number | null; status: string }

const msgOf = (e: unknown) => (e instanceof ApiError && e.silent ? null : e instanceof Error ? e.message : 'Error');
const toast = (e: unknown) => { const m = msgOf(e); if (m) useStore.getState().showToast(m, true); };

export function Turnos() {
  const shift = useStore((s) => s.shift);
  return shift ? <OpenShiftView /> : <OpenForm />;
}

// ---- Abrir turno (con relevo de caja) ----
function OpenForm() {
  const { shiftDefs, settings, user } = useStore();
  const enabled = settings?.shifts_enabled === '1';
  const [prev, setPrev] = useState<{ cashier: string; counted_cash: number } | null | undefined>(undefined);
  const guess = () => {
    if (user?.shift_def_id) return user.shift_def_id;
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const hit = shiftDefs.find((d) => { const a = mins(d.start), b = mins(d.end); return a < b ? now >= a && now < b : now >= a || now < b; });
    return (hit ?? shiftDefs[0])?.id;
  };
  const [def, setDef] = useState<number | undefined>(guess());
  const [float, setFloat] = useState('0');
  const [recount, setRecount] = useState(false);
  const [amount, setAmount] = useState('');

  useEffect(() => { api<{ previous: { cashier: string; counted_cash: number } | null }>('/shift/handover').then((r) => setPrev(r.previous)).catch(toast); }, []);

  const open = async (extra: Record<string, unknown>) => {
    try { await api('/shift/open', { body: { shift_def_id: enabled ? def : undefined, ...extra } }); await useStore.getState().refresh(); useStore.getState().setTab('venta'); }
    catch (e) { toast(e); }
  };
  // el que llega confirma con su propio PIN
  const confirmHandover = async () => {
    const pin = await useStore.getState().askPin('Confirma que recibes la caja con tu PIN');
    if (!pin) return;
    try {
      const r = await api<{ token: string }>('/auth/login', { body: { employee_id: user!.id, pin }, noAuthRedirect: true, noPin: true });
      setToken(r.token);
      await open({});
    } catch (e) { toast(e); }
  };
  const doRecount = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecount(false);
    const pin = await useStore.getState().askPin(`PIN de ${prev?.cashier} para confirmar el recuento (${money(Number(amount))})`);
    if (pin) await open({ opening_float: Number(amount), outgoing_pin: pin });
  };

  return (
    <>
      <Title text="Turnos" sub="Abre tu turno para empezar a vender" />
      <div className="card narrow">
        <h3 style={{ marginTop: 0 }}>Abrir turno</h3>
        <div className="form">
          {enabled && (
            <label>Turno<select value={def} onChange={(e) => setDef(Number(e.target.value))}>{shiftDefs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.start}–{d.end})</option>)}</select></label>
          )}
          {prev === undefined ? <p className="muted">Cargando…</p> : prev ? (
            <div className="handover">
              <p>Recibes la caja de <b>{prev.cashier}</b>, que contó y entregó:</p>
              <div className="bigline"><span>Efectivo entregado</span><b>{money(prev.counted_cash)}</b></div>
              <button className="primary big" onClick={() => void confirmHandover()}>Confirmo con mi PIN y abro turno</button>
              <button className="ghost" onClick={() => { setAmount(''); setRecount(true); }}>No coincide: recontar juntos</button>
            </div>
          ) : (
            <>
              <label>Saldo inicial en caja<input type="number" step="0.01" min="0" value={float} onChange={(e) => setFloat(e.target.value)} /></label>
              <button className="primary big" onClick={() => void open({ opening_float: Number(float) })}>Abrir turno</button>
            </>
          )}
        </div>
      </div>
      <Modal open={recount} onClose={() => setRecount(false)}>
        <h2>Recuento conjunto</h2>
        <p className="muted">Cuenten el efectivo juntos y escribe lo que hay realmente. Después {prev?.cashier} confirma con su PIN.</p>
        <form className="form" onSubmit={(e) => void doRecount(e)}>
          <input type="number" step="0.01" min="0" placeholder="Efectivo recontado" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
          <button className="primary big">Continuar</button>
        </form>
      </Modal>
    </>
  );
}

// ---- Turno abierto: resumen, efectivo y corte ciego ----
function OpenShiftView() {
  const canReports = useCan('reportes');
  const [cur, setCur] = useState<Summary | null>(null);
  const [hist, setHist] = useState<HistoryRow[]>([]);
  const [closed, setClosed] = useState<Closed | null>(null);
  const [cash, setCash] = useState({ type: 'out', amount: '', note: '' });
  const [counted, setCounted] = useState('');

  const load = useCallback(async () => {
    try {
      setCur(await api<Summary>('/shift/current'));
      if (canReports) setHist((await api<HistoryRow[]>('/shifts')).filter((s) => s.status === 'closed'));
    } catch (e) { toast(e); }
  }, [canReports]);
  useEffect(() => { void load(); }, [load]);

  const addCash = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/shift/cash', { body: { type: cash.type, amount: Number(cash.amount), note: cash.note } }); setCash({ ...cash, amount: '', note: '' }); useStore.getState().showToast('Movimiento registrado'); await load(); }
    catch (er) { toast(er); }
  };
  const close = async (e: React.FormEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    if (st.cart.length && !confirm('Hay una venta sin cobrar en el ticket; se descartará. ¿Cerrar turno?')) return;
    try { const r = await api<Closed>('/shift/close', { body: { counted_cash: Number(counted) } }); st.clearCart(); setClosed(r); }
    catch (er) { toast(er); }
  };

  if (!cur?.shift) return <Title text="Turnos" />;
  const s = cur.shift, m = cur.by_method;
  return (
    <>
      <Title text="Turnos" sub={`Turno #${s.id}${s.shift_name ? ' · ' + s.shift_name : ''} de ${s.cashier}`} />
      <div className="cols" style={{ marginTop: 0 }}>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Abierto: {s.opened_at}{cur.handover_from ? ` · recibió de ${cur.handover_from.cashier}` : ''}{s.handover_diff ? ` · diferencia en el relevo: ${money(s.handover_diff)}` : ''}</p>
          <table><tbody>
            <tr><td>Saldo inicial</td><td className="n">{money(s.opening_float)}</td></tr>
            <tr><td>Ventas efectivo (neto de devoluciones)</td><td className="n">{money(m.efectivo)}</td></tr>
            <tr><td>Ventas tarjeta</td><td className="n">{money(m.tarjeta)}</td></tr>
            <tr><td>Transferencias</td><td className="n">{money(m.transferencia)}</td></tr>
            <tr><td>Depósitos de efectivo</td><td className="n">{money(cur.cash_in)}</td></tr>
            <tr><td>Retiros de efectivo</td><td className="n">{money(cur.cash_out)}</td></tr>
            <tr><td>Devoluciones del turno</td><td className="n">{money(cur.refunds)}</td></tr>
            <tr><td>Tickets</td><td className="n">{cur.tickets}</td></tr>
          </tbody></table>
          <p className="muted">El efectivo esperado se oculta (corte ciego) hasta que cuentes y cierres.</p>
        </div>
        <div className="card">
          {cur.mine ? (
            <>
              <h3 style={{ marginTop: 0 }}>Entrada / salida de efectivo</h3>
              <form className="form" onSubmit={(e) => void addCash(e)}>
                <select value={cash.type} onChange={(e) => setCash({ ...cash, type: e.target.value })}><option value="out">Retiro (proveedor, resguardo)</option><option value="in">Depósito menor</option></select>
                <input type="number" step="0.01" min="0.01" placeholder="Monto" value={cash.amount} onChange={(e) => setCash({ ...cash, amount: e.target.value })} required />
                <input placeholder="Justificación" value={cash.note} onChange={(e) => setCash({ ...cash, note: e.target.value })} required />
                <button className="primary">Registrar</button>
              </form>
            </>
          ) : <p>Este turno es de <b>{s.cashier}</b>.</p>}
          {cur.can_close && (
            <>
              <h3>Cierre de turno (corte ciego)</h3>
              <form className="form" onSubmit={(e) => void close(e)}>
                <input type="number" step="0.01" min="0" placeholder="Efectivo contado en caja" value={counted} onChange={(e) => setCounted(e.target.value)} required />
                <button className="primary">Cerrar turno</button>
              </form>
            </>
          )}
        </div>
      </div>

      {canReports && (
        <>
          <h3>Cortes anteriores</h3>
          <div className="tablewrap"><table>
            <thead><tr><th>#</th><th>Turno</th><th>Cajero</th><th>Apertura</th><th>Cierre</th><th className="n">Esperado</th><th className="n">Contado</th><th className="n">Diferencia</th><th className="n">Dif. relevo</th></tr></thead>
            <tbody>
              {hist.map((h) => (
                <tr key={h.id}><td>{h.id}</td><td>{h.shift_name ?? '—'}</td><td>{h.cashier}</td><td>{h.opened_at}</td><td>{h.closed_at}</td><td className="n">{money(h.expected_cash)}</td><td className="n">{money(h.counted_cash)}</td>
                  <td className={`n ${h.difference === 0 ? 'up' : 'down'}`}>{money(h.difference)}</td><td className={`n ${h.handover_diff ? 'down' : ''}`}>{h.handover_diff == null ? '—' : money(h.handover_diff)}</td></tr>
              ))}
              {!hist.length && <tr><td colSpan={9} className="muted">Sin cortes aún</td></tr>}
            </tbody>
          </table></div>
        </>
      )}

      <Modal open={!!closed} onClose={() => { setClosed(null); void useStore.getState().logout(); }}>
        {closed && (
          <>
            <h2>Arqueo del turno</h2>
            <div className="bigline"><span>Efectivo esperado</span><b>{money(closed.expected_cash)}</b></div>
            <div className="bigline"><span>Efectivo contado</span><b>{money(closed.counted_cash)}</b></div>
            <div className="bigline"><span>Diferencia</span><b className={closed.difference === 0 ? 'up' : 'down'}>{closed.difference > 0 ? '+' : ''}{money(closed.difference)} {closed.difference === 0 ? '(cuadra)' : closed.difference > 0 ? '(sobrante)' : '(faltante)'}</b></div>
            <p className="muted">{closed.tickets} tickets: efectivo {money(closed.by_method.efectivo)} · tarjeta {money(closed.by_method.tarjeta)} · transferencia {money(closed.by_method.transferencia)} · devoluciones {money(closed.refunds)}</p>
            <p className="muted">Entrega {money(closed.counted_cash)} al siguiente turno; quien llegue confirmará con su PIN. {closed.backup_file ? 'Copia de seguridad guardada.' : `No se pudo guardar la copia: ${closed.backup_error ?? ''}`}</p>
            <button className="primary big" onClick={() => { setClosed(null); void useStore.getState().logout(); }}>Entregar caja y salir</button>
          </>
        )}
      </Modal>
    </>
  );
}
