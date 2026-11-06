import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useCan, useStore } from '../store';
import { toastErr, useUi } from '../ui';
import type { Product, Unit } from '../types';
import { UNIT, initials, money, qtyFmt, tint } from '../util';
import { Modal } from '../components/Modal';
import { Title } from './Placeholder';

const SEM = { ok: 'Ok', aviso: 'Bajo', critico: 'Escasez' } as const;
interface PriceRow { id: number; created_at: string; old_price: number; new_price: number; old_cost: number; new_cost: number; changed_by: string; source: string }

export function Catalogo() {
  const canEdit = useCan('productos');
  const canImport = useCan('importar');
  const [q, setQ] = useState('');
  const [list, setList] = useState<Product[]>([]);
  const [editing, setEditing] = useState<{ p: Product | null; code?: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try { setList(await api<Product[]>('/products?all=1&q=' + encodeURIComponent(q))); } catch (e) { toastErr(e); }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t); }, [load]);

  // llegando desde Cobro con un código que no existe
  const newCode = useUi((s) => s.newProductCode);
  useEffect(() => { if (newCode !== null) { setEditing({ p: null, code: newCode }); useUi.getState().set({ newProductCode: null }); } }, [newCode]);

  const seeCost = list[0]?.cost !== undefined;
  const refreshAll = () => { void load(); void useStore.getState().refreshAlerts(); };
  return (
    <>
      <Title text="Catálogo" sub={`${list.length} productos`} />
      <div className="bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, código o categoría…" aria-label="Buscar en el catálogo" />
        {canImport && <button onClick={() => setImporting(true)}>Importar CSV</button>}
        {canEdit && <button className="primary" onClick={() => setEditing({ p: null })}>+ Nuevo producto</button>}
      </div>
      <div className={canEdit ? 'grid2' : ''}>
        {canEdit && <StockForm onDone={refreshAll} />}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Unidad</th>{seeCost && <th className="n">Costo</th>}<th className="n">Precio</th><th>IVA</th><th className="n">Stock</th><th>Estado</th><th>Caduca</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
                  <td><span className="mini" style={p.image ? undefined : tint(p.category)}>{p.image ? <img src={p.image} alt="" /> : initials(p.name)}</span>{p.name}</td>
                  <td>{p.barcode ?? ''}</td><td>{p.category}</td><td>{UNIT[p.unit]}</td>
                  {seeCost && <td className="n">{money(p.cost)}</td>}
                  <td className="n">{money(p.price)}</td><td>{p.tax_rate}%</td><td className="n">{qtyFmt(p.stock)}</td>
                  <td><span className={`tag ${p.level}`}>{SEM[p.level]}</span></td><td>{p.expires_at ?? '—'}</td>
                  <td>{canEdit && <button onClick={() => setEditing({ p })}>Editar</button>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={11} className="muted">Sin productos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <ProductForm editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refreshAll(); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refreshAll(); }} />
    </>
  );
}

// ---- Entradas y salidas de almacén (escaneo directo) ----
function StockForm({ onDone }: { onDone: () => void }) {
  const empty = { barcode: '', type: 'entrada', qty: '', cost: '', note: '' };
  const [f, setF] = useState(empty);
  const [msg, setMsg] = useState('');
  const qtyRef = useRef<HTMLInputElement>(null);
  const prefill = useUi((s) => s.stockPrefill);
  useEffect(() => {
    if (!prefill) return;
    setF({ ...empty, ...prefill });
    useUi.getState().set({ stockPrefill: null });
    setTimeout(() => qtyRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await api<Product>('/stock', { body: { barcode: f.barcode, type: f.type, qty: Number(f.qty), note: f.note, cost: f.cost === '' ? undefined : Number(f.cost) } });
      setMsg(`${p.name}: stock ahora ${qtyFmt(p.stock)}`); setF({ ...empty, type: f.type }); onDone();
    } catch (er) { toastErr(er); }
  };
  return (
    <form className="card form" onSubmit={(e) => void submit(e)}>
      <h3 style={{ margin: 0 }}>Entrada / salida de almacén</h3>
      <input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); qtyRef.current?.focus(); } }} placeholder="Escanea código de barras" required aria-label="Código de barras" />
      <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} aria-label="Tipo de movimiento">
        <option value="entrada">Entrada (compra / reabasto)</option><option value="merma">Merma / caducidad</option>
        <option value="devolucion_proveedor">Devolución a proveedor</option><option value="devolucion_cliente">Devolución de cliente</option><option value="ajuste">Ajuste (+/−)</option>
      </select>
      <input ref={qtyRef} type="number" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="Cantidad" required aria-label="Cantidad" />
      {f.type === 'entrada' && <input type="number" step="0.01" min="0" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="Costo de compra (opcional, actualiza el costo)" aria-label="Costo de compra" />}
      <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Nota (opcional)" aria-label="Nota" />
      <button className="primary">Registrar</button>
      {msg && <div className="muted">{msg}</div>}
    </form>
  );
}

// ---- Alta / edición de producto (con foto) ----
function ProductForm({ editing, onClose, onSaved }: { editing: { p: Product | null; code?: string } | null; onClose: () => void; onSaved: () => void }) {
  const giro = useStore((s) => (s.settings ? s.giros[s.settings.giro] : undefined));
  const p = editing?.p ?? null;
  const [price, setPrice] = useState('0');
  const [cost, setCost] = useState('0');
  const [tax, setTax] = useState('16');
  const [image, setImage] = useState('');
  const [name, setName] = useState('');
  const [hist, setHist] = useState<PriceRow[] | null>(null);
  useEffect(() => {
    if (!editing) return;
    setPrice(String(p?.price ?? 0)); setCost(String(p?.cost ?? 0)); setTax(String(p?.tax_rate ?? 16)); setImage(p?.image ?? ''); setName(p?.name ?? '');
  }, [editing, p]);

  const net = Number(price) / (1 + Number(tax) / 100);
  const margin = net ? ((net - Number(cost)) / net) * 100 : 0;

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setImage(c.toDataURL('image/jpeg', 0.82)); URL.revokeObjectURL(url);
    };
    img.onerror = () => useStore.getState().showToast('No se pudo leer esa imagen', true);
    img.src = url;
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body: Record<string, unknown> = { ...Object.fromEntries(new FormData(e.currentTarget)), image };
    if (p && Number(price) !== p.price && !confirm(`Cambiar el precio de ${money(p.price)} a ${money(Number(price))}. ¿Confirmas?`)) return;
    try { await api(p ? '/products/' + p.id : '/products', { method: p ? 'PUT' : 'POST', body }); useStore.getState().showToast('Producto guardado'); onSaved(); }
    catch (er) { toastErr(er); }
  };
  const toggleActive = async () => {
    if (!p) return;
    if (p.active && !confirm(`¿Dar de baja "${p.name}"? Dejará de aparecer en caja y en alertas; el historial se conserva y puedes reactivarlo.`)) return;
    try { await api('/products/' + p.id, { method: 'PUT', body: { active: !p.active } }); useStore.getState().showToast(p.active ? 'Producto dado de baja' : 'Producto reactivado'); onSaved(); }
    catch (er) { toastErr(er); }
  };
  const showHistory = async () => { if (p) try { setHist(await api<PriceRow[]>(`/products/${p.id}/history`)); } catch (er) { toastErr(er); } };

  return (
    <>
      <Modal open={!!editing} onClose={onClose} wide>
        <h2>{p ? 'Editar' : 'Nuevo'} producto</h2>
        <form className="form" onSubmit={(e) => void submit(e)}>
          <div className="row">
            <div className="imgpick">
              <span className="thumb" style={image ? undefined : tint(p?.category ?? name)}>{image ? <img src={image} alt="" /> : initials(name || 'Foto')}</span>
              <div className="form"><label>Foto del producto<input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])} /></label>{image && <button type="button" className="ghost" onClick={() => setImage('')}>Quitar foto</button>}</div>
            </div>
          </div>
          <div className="row">
            <label className="grow">Código de barras<input name="barcode" defaultValue={p?.barcode ?? editing?.code ?? ''} placeholder="Escanéalo aquí" autoFocus={!p && !editing?.code} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget.form?.elements.namedItem('name') as HTMLInputElement | null)?.focus(); } }} /></label>
            <label className="grow">Nombre<input name="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus={!!editing?.code} /></label>
          </div>
          <div className="row">
            <label className="grow">Categoría<input name="category" list="cats" defaultValue={p?.category ?? ''} /><datalist id="cats">{giro?.categories.map((c) => <option key={c} value={c} />)}</datalist></label>
            <label>Unidad<select name="unit" defaultValue={p?.unit ?? 'pieza'}>{(Object.keys(UNIT) as Unit[]).map((u) => <option key={u} value={u}>{u === 'pieza' ? 'Pieza' : UNIT[u]}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="grow">Costo (sin IVA)<input name="cost" type="number" step="0.01" min="0" required value={cost} onChange={(e) => setCost(e.target.value)} /></label>
            <label className="grow">Precio público (con IVA)<input name="price" type="number" step="0.01" min="0" required value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label>IVA<select name="tax_rate" value={tax} onChange={(e) => setTax(e.target.value)}><option value="16">16 %</option><option value="0">0 % / exento</option></select></label>
          </div>
          <div className="margin">{Number(price) > 0 && <>Margen: <b>{margin.toFixed(1)}%</b> ({money(net - Number(cost))} por unidad, sin IVA){Number(price) < Number(cost) && <span className="down"> · El precio está por debajo del costo</span>}</>}</div>
          <div className="row">
            <label className="grow">Stock mín.<input name="min_stock" type="number" step="any" min="0" defaultValue={p?.min_stock ?? 0} /></label>
            <label className="grow">Stock máx.<input name="max_stock" type="number" step="any" min="0" defaultValue={p?.max_stock ?? 0} /></label>
            {!p && <label className="grow">Stock inicial<input name="stock" type="number" step="any" min="0" defaultValue={0} /></label>}
            <label className="grow">Caducidad<input name="expires_at" type="date" defaultValue={p?.expires_at ?? ''} /></label>
          </div>
          {p && (
            <>
              <p className="muted">Stock actual: {qtyFmt(p.stock)}. Cámbialo con entradas/salidas de almacén.{p.active ? '' : ' Este producto está dado de baja.'}</p>
              <div className="row"><button type="button" className="ghost" onClick={() => void showHistory()}>Historial de precios</button><button type="button" className={p.active ? 'danger' : ''} onClick={() => void toggleActive()}>{p.active ? 'Dar de baja' : 'Reactivar'}</button></div>
            </>
          )}
          <div className="row"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary big grow">Guardar</button></div>
        </form>
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} wide>
        <h2>Historial · {p?.name}</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Fecha</th><th className="n">Precio</th><th className="n">Costo</th><th>Quién</th><th>Origen</th></tr></thead>
          <tbody>
            {hist?.map((x) => <tr key={x.id}><td>{x.created_at}</td><td className="n">{money(x.old_price)} → {money(x.new_price)}</td><td className="n">{money(x.old_cost)} → {money(x.new_cost)}</td><td>{x.changed_by}</td><td>{x.source}</td></tr>)}
            {!hist?.length && <tr><td colSpan={5} className="muted">Sin cambios registrados</td></tr>}
          </tbody>
        </table></div>
        <button className="primary big" style={{ marginTop: 12 }} onClick={() => setHist(null)}>Cerrar</button>
      </Modal>
    </>
  );
}

// ---- Importar catálogo (CSV) con vista previa ----
interface PlanRow { line: number; name: string; action: string; errors: string[]; old_price?: number; price?: number; pct: number | null; big: boolean }
interface Plan { rows: PlanRow[]; summary: { nuevo: number; actualizar: number; sin_cambios: number; error: number; cambios_grandes: number } }

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  useEffect(() => { if (open) { setCsv(''); setPlan(null); } }, [open]);
  const load = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    try { setPlan(await api<Plan>('/import/preview', { body: { csv: text } })); setCsv(text); } catch (e) { toastErr(e); }
  };
  const apply = async () => {
    const pin = await useStore.getState().askPin('PIN del dueño para confirmar la importación');
    if (!pin) return;
    try {
      const r = await api<{ created: number; updated: number }>('/import/apply', { body: { csv, auth_pin: pin } });
      useStore.getState().showToast(`Importación lista: ${r.created} nuevos, ${r.updated} actualizados`); onDone();
    } catch (e) { toastErr(e); }
  };
  const s = plan?.summary;
  return (
    <Modal open={open} onClose={onClose} wide>
      <h2>Importar catálogo (CSV)</h2>
      <p className="muted">Columnas: código, nombre, precio, costo, stock, categoría, unidad, iva. Si el código ya existe se actualizan precio y costo; el stock se suma solo si trae esa columna.</p>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void load(e.target.files?.[0])} aria-label="Archivo CSV" />
      {plan && s && (
        <>
          <p><b>{s.nuevo}</b> nuevos · <b>{s.actualizar}</b> a actualizar · {s.sin_cambios} sin cambios · <b className={s.error ? 'down' : ''}>{s.error}</b> con error{s.cambios_grandes > 0 && <b className="down"> · {s.cambios_grandes} cambios de precio mayores a 30 %</b>}</p>
          <div className="tablewrap short"><table>
            <thead><tr><th>Fila</th><th>Producto</th><th>Acción</th><th className="n">Precio anterior</th><th className="n">Precio nuevo</th><th className="n">Cambio</th></tr></thead>
            <tbody>{plan.rows.map((r) => (
              <tr key={r.line} className={r.big ? 'bigchg' : ''}><td>{r.line}</td><td>{r.name || '(sin nombre)'}</td><td>{r.action}{r.errors.length > 0 && <span className="down"> {r.errors.join(', ')}</span>}</td>
                <td className="n">{r.old_price === undefined ? '—' : money(r.old_price)}</td><td className="n">{r.price === undefined ? '—' : money(r.price)}</td><td className="n">{r.pct === null ? '—' : `${r.pct > 0 ? '+' : ''}${r.pct}%`}</td></tr>
            ))}</tbody>
          </table></div>
          <button className="primary big" style={{ marginTop: 12 }} disabled={!(s.nuevo + s.actualizar)} onClick={() => void apply()}>Confirmar importación (pide PIN del dueño)</button>
        </>
      )}
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cerrar</button>
    </Modal>
  );
}
