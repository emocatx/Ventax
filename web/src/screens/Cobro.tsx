import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, animate, motion } from 'motion/react';
import { api, ApiError } from '../api';
import { cartTotals, useStore, useCan } from '../store';
import { useSearch } from '../search';
import type { Method, Product, Sale } from '../types';
import { UNIT, initials, money, qtyFmt, tint } from '../util';
import { Modal } from '../components/Modal';
import { Title } from './Placeholder';
import { ReturnDialog } from './ReturnDialog';
import { useUi } from '../ui';

const err = (e: unknown) => (e instanceof ApiError && e.silent ? null : e instanceof Error ? e.message : 'Error');

// Importe que "cuenta" hasta el nuevo valor
function Money({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const c = animate(shown, value, { duration: 0.35, ease: 'easeOut', onUpdate: setShown });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{money(shown)}</>;
}

function Thumb({ p }: { p: Product }) {
  return p.image
    ? <span className="thumb"><img src={p.image} alt="" onError={(e) => e.currentTarget.remove()} /></span>
    : <span className="thumb" style={tint(p.category)}>{initials(p.name)}</span>;
}

export function Cobro() {
  const shift = useStore((s) => s.shift);
  const cart = useStore((s) => s.cart);
  const discount = useStore((s) => s.discount);
  const st = useStore.getState;
  const canDiscount = useCan('descuentos');
  const [products, setProducts] = useState<Product[]>([]);
  const [cat, setCat] = useState('Todos');
  const [kg, setKg] = useState<Product | null>(null);
  const [discOpen, setDiscOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<Method | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [nextNo, setNextNo] = useState(1);
  const [returning, setReturning] = useState(false);
  const canProducts = useCan('productos');

  const load = useCallback(async (q = '') => {
    try { setProducts(await api<Product[]>('/products?q=' + encodeURIComponent(q))); } catch (e) { const m = err(e); if (m) st().showToast(m, true); }
  }, [st]);
  useEffect(() => { void load(); api<{ id: number }[]>('/sales').then((s) => setNextNo((s[0]?.id ?? 0) + 1)).catch(() => {}); }, [load]);

  // búsqueda en vivo al escribir en la barra superior
  const query = useSearch((s) => s.query);
  useEffect(() => { const t = setTimeout(() => { if (query.trim().length !== 1) void load(query.trim()); }, 200); return () => clearTimeout(t); }, [query, load]);

  const pick = useCallback((p: Product) => { if (p.unit === 'pieza') st().addToCart(p); else setKg(p); }, [st]);

  // código leído por el escáner (o Enter en la búsqueda)
  const submitted = useSearch((s) => s.submitted);
  useEffect(() => {
    if (!submitted) return;
    const code = submitted.code;
    useSearch.getState().consume();
    (async () => {
      try { pick(await api<Product>('/products/barcode/' + encodeURIComponent(code))); }
      catch (e) {
        if (e instanceof ApiError && e.silent) return;
        const list = await api<Product[]>('/products?q=' + encodeURIComponent(code));
        if (list.length === 1) pick(list[0]);
        else {
          setProducts(list); setCat('Todos');
          st().showToast(list.length ? 'Elige un producto' : `No existe "${code}"`, !list.length,
            !list.length && canProducts ? { label: 'Crear producto con este código', fn: () => { useUi.getState().set({ newProductCode: code }); st().setTab('inventario'); } } : undefined);
        }
      }
    })();
  }, [submitted, pick, st, canProducts]);

  const cats = useMemo(() => ['Todos', ...new Set(products.map((p) => p.category).filter(Boolean))], [products]);
  const shown = products.filter((p) => cat === 'Todos' || p.category === cat);
  const t = cartTotals(cart, discount);

  // ¿cambió algún precio mientras el producto estaba en el ticket?
  const startPay = async (m: Method) => {
    if (!cart.length) return st().showToast('El ticket está vacío', true);
    try {
      const fresh = new Map((await api<Product[]>('/products?all=1')).map((p) => [p.id, p]));
      const notes: string[] = [];
      const kept = cart.filter((l) => {
        const f = fresh.get(l.product.id);
        if (!f || !f.active) { notes.push(`${l.product.name} ya no está disponible`); return false; }
        if (f.price !== l.product.price) { notes.push(`${l.product.name}: de ${money(l.product.price)} a ${money(f.price)}`); l.product = { ...l.product, ...f }; }
        return true;
      });
      if (notes.length) { useStore.setState({ cart: kept.map((l) => ({ ...l })) }); return st().showToast('Cambió el precio: ' + notes.join('; ') + '. Revisa el ticket y vuelve a cobrar.', true); }
      setPayMethod(m);
    } catch (e) { const msg = err(e); if (msg) st().showToast(msg, true); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); void startPay('efectivo'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!shift) return (
    <>
      <Title text="Cobro" />
      <div className="card narrow"><p>Abre tu turno para poder vender.</p><button className="primary" onClick={() => st().setTab('turno')}>Ir a Turnos</button></div>
    </>
  );

  return (
    <>
      <Title text="Cobro" sub={`Turno${shift.shift_name ? ' ' + shift.shift_name : ''} de ${shift.cashier} desde las ${shift.opened_at.slice(11, 16)}`} />
      <div className="pos">
        <div className="catalog">
          <div className="cats">
            {cats.map((c) => (
              <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>
                <b>{c}</b><small>{c === 'Todos' ? products.length : products.filter((p) => p.category === c).length} productos</small>
              </button>
            ))}
          </div>
          <div className="results">
            {shown.map((p, i) => (
              <motion.button key={p.id} className="prod" onClick={() => pick(p)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 14) * 0.015 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}>
                <Thumb p={p} /><span className={`dot ${p.level}`} title={`Existencias: ${qtyFmt(p.stock)} ${UNIT[p.unit]}`} />
                <span className="pn">{p.name}</span>
                <span className="pf">
                  <span className="price">{money(p.price)}{p.unit !== 'pieza' && <small className="muted"> /{UNIT[p.unit]}</small>}</span>
                  <span className="pill" style={tint(p.category)}>{p.category || 'General'}</span>
                </span>
              </motion.button>
            ))}
            {!shown.length && <p className="muted">Sin resultados. Agrega productos en Catálogo.</p>}
          </div>
        </div>

        <aside className="ticket-panel">
          <div className="tp-head"><div><b>TICKET #{nextNo}</b><small>Cajero: {shift.cashier}</small></div><button className="ghost" onClick={() => st().clearCart()}>Vaciar</button></div>
          <div className="cart">
            <AnimatePresence initial={false}>
              {cart.map((l) => (
                <motion.div key={l.product.id} layout="position" className="line" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
                  <div>{l.product.name}<br /><small className="muted">{money(l.product.price)} / {UNIT[l.product.unit]}</small></div>
                  <div><b>{money(l.product.price * l.qty)}</b> <button className="ghost danger" onClick={() => st().removeLine(l.product.id)} aria-label={`Quitar ${l.product.name}`}>Quitar</button></div>
                  <div className="qty">
                    {l.product.unit === 'pieza' ? (
                      <><button aria-label="Menos" onClick={() => st().setQty(l.product.id, Math.max(1, l.qty - 1))}>−</button><b>{l.qty}</b><button aria-label="Más" onClick={() => st().setQty(l.product.id, l.qty + 1)}>+</button></>
                    ) : (
                      <><input type="number" step="0.001" min="0.001" value={l.qty} onChange={(e) => st().setQty(l.product.id, Number(e.target.value))} aria-label="Cantidad" /> {UNIT[l.product.unit]}</>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {!cart.length && <div className="empty">Escanea o toca un producto</div>}
          </div>
          {cart.length > 0 && (
            <div className="sums">
              <div className="srow"><span>Subtotal</span><span>{money(t.gross)}</span></div>
              {t.discount > 0 && <div className="srow disc"><span>Descuento ({discount?.reason})</span><span>−{money(t.discount)}</span></div>}
              <div className="srow muted"><span>IVA incluido</span><span>{money(t.tax)}</span></div>
            </div>
          )}
          <div className="totalbar"><div className="muted"><span>{qtyFmt(cart.reduce((s, l) => s + (l.product.unit === 'pieza' ? l.qty : 1), 0))}</span> artículos</div><div className="total"><Money value={t.total} /></div></div>
          <div className="payquick">
            {(['efectivo', 'tarjeta', 'transferencia'] as Method[]).map((m) => <button key={m} onClick={() => void startPay(m)}>{m === 'transferencia' ? 'Transferencia' : m[0].toUpperCase() + m.slice(1)}</button>)}
          </div>
          <motion.button className="primary big" id="payBtn" whileTap={{ scale: 0.98 }} onClick={() => void startPay('efectivo')}>{cart.length ? `Cobrar ${money(t.total)}` : 'Cobrar (F9)'}</motion.button>
          <div className="row">
            <button className="ghost grow" onClick={() => (discount ? st().setDiscount(null) : cart.length ? setDiscOpen(true) : st().showToast('Agrega productos primero', true))}>{discount ? 'Quitar descuento' : 'Descuento'}</button>
            <button className="ghost grow" onClick={() => setReturning(true)}>Devolución</button>
          </div>
        </aside>
      </div>

      <KgDialog product={kg} onClose={() => setKg(null)} />
      <DiscountDialog open={discOpen} onClose={() => setDiscOpen(false)} canApply={canDiscount} />
      <PayDialog method={payMethod} onClose={() => setPayMethod(null)} onDone={(s) => { setPayMethod(null); setSale(s); setNextNo(s.id + 1); void load(); void st().refreshAlerts(); }} />
      <TicketDialog sale={sale} onClose={() => setSale(null)} />
      <ReturnDialog open={returning} onClose={() => setReturning(false)} onDone={() => { setReturning(false); void load(); void st().refreshAlerts(); }} />
    </>
  );
}

function KgDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [q, setQ] = useState('1');
  useEffect(() => { if (product) setQ('1'); }, [product]);
  return (
    <Modal open={!!product} onClose={onClose}>
      {product && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); useStore.getState().addToCart(product, Number(q)); onClose(); }}>
          <h2>{product.name}</h2>
          <p>{money(product.price)} por {UNIT[product.unit]}</p>
          <label>Cantidad ({UNIT[product.unit]})<input type="number" step="0.001" min="0.001" value={q} onChange={(e) => setQ(e.target.value)} required autoFocus onFocus={(e) => e.target.select()} /></label>
          <div className="bigline"><span>Importe</span><b>{money(product.price * Number(q))}</b></div>
          <button className="primary big">Agregar al ticket</button>
        </form>
      )}
    </Modal>
  );
}

function DiscountDialog({ open, onClose, canApply }: { open: boolean; onClose: () => void; canApply: boolean }) {
  const [type, setType] = useState<'pct' | 'amount'>('pct');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose}>
      <h2>Descuento</h2>
      <form className="form" onSubmit={(e) => { e.preventDefault(); useStore.getState().setDiscount({ type, value: Number(value), reason: reason.trim() }); setValue(''); setReason(''); onClose(); }}>
        <div className="row">
          <select value={type} onChange={(e) => setType(e.target.value as 'pct' | 'amount')}><option value="pct">Porcentaje (%)</option><option value="amount">Monto ($)</option></select>
          <input type="number" step="0.01" min="0.01" placeholder="Valor" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
        </div>
        <input placeholder="Motivo (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} required />
        {!canApply && <p className="muted">Al cobrar se pedirá el PIN del dueño (o de quien tenga este permiso).</p>}
        <div className="row"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary grow">Aplicar</button></div>
      </form>
    </Modal>
  );
}

function PayDialog({ method, onClose, onDone }: { method: Method | null; onClose: () => void; onDone: (s: Sale) => void }) {
  const cart = useStore((s) => s.cart);
  const discount = useStore((s) => s.discount);
  const total = cartTotals(cart, discount).total;
  const [m, setM] = useState<Method>('efectivo');
  const [recv, setRecv] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (method) { setM(method); setRecv(String(total)); } }, [method, total]);

  const confirm = async () => {
    setBusy(true);
    try {
      const sale = await api<Sale>('/sales', { body: {
        method: m, cash_received: m === 'efectivo' ? Number(recv) : undefined, discount: discount ?? undefined,
        items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty })) } });
      useStore.getState().clearCart();
      onDone(sale);
    } catch (e) { const msg = err(e); if (msg) useStore.getState().showToast(msg, true); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={!!method} onClose={onClose}>
      <h2>Cobrar</h2>
      <div className="bigline"><span>Total</span><b>{money(total)}</b></div>
      <div className="methods">
        {(['efectivo', 'tarjeta', 'transferencia'] as Method[]).map((x) => <button key={x} className={m === x ? 'on' : ''} onClick={() => setM(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}
      </div>
      {m === 'efectivo' && (
        <div className="form" style={{ marginTop: 12 }}>
          <label>Efectivo recibido<input type="number" step="0.01" min="0" value={recv} onChange={(e) => setRecv(e.target.value)} onFocus={(e) => e.target.select()} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void confirm(); }} /></label>
          <div className="quick">
            <button onClick={() => setRecv(String(total))}>Exacto</button>
            {[50, 100, 200, 500, 1000].filter((v) => v >= total).slice(0, 4).map((v) => <button key={v} onClick={() => setRecv(String(v))}>{money(v)}</button>)}
          </div>
          <div className="bigline"><span>Cambio</span><b>{money(Math.max(0, Number(recv) - total))}</b></div>
        </div>
      )}
      <div className="row" style={{ marginTop: 14 }}><button className="ghost" onClick={onClose}>Cancelar</button><button className="primary big" disabled={busy} onClick={() => void confirm()}>Confirmar</button></div>
    </Modal>
  );
}

function TicketDialog({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const print = () => { document.body.classList.remove('print-report'); window.print(); };
  return (
    <>
      <Modal open={!!sale} onClose={onClose}>
        {sale && (
          <>
            <h2>Venta registrada</h2>
            {sale.method === 'efectivo' && <div className="bigline"><span>Cambio</span><b>{money(sale.change_given)}</b></div>}
            <div className="bigline"><span>Total</span><b>{money(sale.total)}</b></div>
            <div className="row" style={{ marginTop: 14 }}><button onClick={print}>Imprimir ticket</button><button className="primary big" autoFocus onClick={onClose}>Nueva venta</button></div>
          </>
        )}
      </Modal>
      <div id="ticketPrint">
        {sale && (
          <div className="ticket">
            <div className="c"><b>{sale.business}</b><br />Ticket #{sale.id}<br />{sale.created_at}<br />Cajero: {sale.cashier}</div><hr />
            {sale.items.map((i) => <div key={i.id}><div>{i.name}</div><div className="r"><span>{qtyFmt(i.qty)} x {money(i.price)}</span><span>{money(i.qty * i.price)}</span></div></div>)}
            <hr />
            {sale.discount > 0 && <div className="r"><span>Descuento</span><span>−{money(sale.discount)}</span></div>}
            <div className="r"><span>Subtotal sin IVA</span><span>{money(sale.subtotal)}</span></div><div className="r"><span>IVA</span><span>{money(sale.tax)}</span></div>
            <div className="r"><b>TOTAL</b><b>{money(sale.total)}</b></div><div className="r"><span>Pago: {sale.method}</span><span /></div>
            {sale.method === 'efectivo' && <><div className="r"><span>Recibido</span><span>{money(sale.cash_received)}</span></div><div className="r"><span>Cambio</span><span>{money(sale.change_given)}</span></div></>}
            <hr /><div className="c">¡Gracias por su compra!</div>
          </div>
        )}
      </div>
    </>
  );
}
