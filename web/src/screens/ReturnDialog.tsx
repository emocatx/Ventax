import { useEffect, useState } from 'react';
import { api } from '../api';
import { useCan, useStore } from '../store';
import { toastErr } from '../ui';
import type { Method, Sale } from '../types';
import { money, qtyFmt } from '../util';
import { Modal } from '../components/Modal';

// Devolución: se busca el ticket, se eligen cantidades y se autoriza con PIN del dueño (o de quien tenga el permiso).
export function ReturnDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const canReturn = useCan('devoluciones');
  const [id, setId] = useState('');
  const [sale, setSale] = useState<Sale | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [method, setMethod] = useState<Method>('efectivo');
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setId(''); setSale(null); setQty({}); setReason(''); } }, [open]);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const s = await api<Sale>('/sales/' + Number(id)); setSale(s); setMethod(s.method); setQty({}); } catch (er) { toastErr(er); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const items = Object.entries(qty).map(([k, v]) => ({ sale_item_id: Number(k), qty: Number(v) })).filter((x) => x.qty > 0);
    if (!items.length) return useStore.getState().showToast('Indica qué cantidad se devuelve', true);
    try {
      const r = await api<{ total: number; method: string; authorized_by: string }>('/returns', { body: { sale_id: sale!.id, items, method, reason } });
      useStore.getState().showToast(`Devolución registrada: ${money(r.total)} (${r.method}). Autorizó ${r.authorized_by}.`); onDone();
    } catch (er) { toastErr(er); }
  };
  const items = sale?.items.filter((i) => i.qty - i.returned > 0) ?? [];

  return (
    <Modal open={open} onClose={onClose}>
      <h2>Devolución</h2>
      <form className="row" onSubmit={(e) => void find(e)}>
        <input type="number" min={1} placeholder="Número de ticket" value={id} onChange={(e) => setId(e.target.value)} required autoFocus aria-label="Número de ticket" />
        <button className="primary">Buscar</button>
      </form>
      {sale && (items.length ? (
        <form className="form" style={{ marginTop: 12 }} onSubmit={(e) => void submit(e)}>
          <p className="muted">Ticket #{sale.id} · {sale.created_at} · {money(sale.total)} · {sale.method}</p>
          {items.map((i) => (
            <label key={i.id} className="rline"><span>{i.name} <small className="muted">(hasta {qtyFmt(i.qty - i.returned)})</small></span>
              <input type="number" step="any" min={0} max={qtyFmt(i.qty - i.returned)} value={qty[i.id] ?? '0'} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Cantidad de ${i.name}`} /></label>
          ))}
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} aria-label="Cómo se reembolsa">{(['efectivo', 'tarjeta', 'transferencia'] as Method[]).map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <input placeholder="Motivo (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} required aria-label="Motivo" />
          {!canReturn && <p className="muted">Se pedirá el PIN del dueño (o de quien tenga este permiso).</p>}
          <button className="primary big">Registrar devolución</button>
        </form>
      ) : <p className="muted">Ese ticket no tiene artículos por devolver.</p>)}
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cerrar</button>
    </Modal>
  );
}
