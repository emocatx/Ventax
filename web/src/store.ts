import { create } from 'zustand';
import { api, setToken, getToken, wireApi } from './api';
import type { CartLine, Discount, Employee, Giro, Product, Settings, Shift, ShiftDef, StateResponse } from './types';
import { r2, qtyFmt } from './util';

export type Tab = 'venta' | 'turno' | 'alertas' | 'inventario' | 'reportes' | 'dashboard' | 'asistente' | 'equipo' | 'config';
type User = Employee & { perms: string[] };
interface Toast { id: number; msg: string; err: boolean; action?: { label: string; fn: () => void } }
interface PinRequest { message: string; resolve: (pin: string | null) => void }

interface Store {
  ready: boolean;
  user: User | null;
  settings: Settings | null;
  giros: Record<string, Giro>;
  shiftDefs: ShiftDef[];
  shift: Shift | null;
  encargadoPerms: string[];
  lockedId: number | null;
  tab: Tab;
  cart: CartLine[];
  discount: Discount | null;
  alertCount: number;
  toast: Toast | null;
  pinRequest: PinRequest | null;

  refresh: () => Promise<void>;
  boot: () => Promise<void>;
  logout: () => Promise<void>;
  lock: () => void;
  setLoggedIn: (token: string) => Promise<void>;
  setTab: (t: Tab) => void;
  addToCart: (p: Product, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  removeLine: (id: number) => void;
  clearCart: () => void;
  setDiscount: (d: Discount | null) => void;
  showToast: (msg: string, err?: boolean, action?: Toast['action']) => void;
  askPin: (message: string) => Promise<string | null>;
  refreshAlerts: () => Promise<void>;
}

let toastSeq = 0;
export const useStore = create<Store>((set, get) => ({
  ready: false, user: null, settings: null, giros: {}, shiftDefs: [], shift: null, encargadoPerms: [], lockedId: null,
  tab: 'venta', cart: [], discount: null, alertCount: 0, toast: null, pinRequest: null,

  async refresh() {
    const s = await api<StateResponse>('/state');
    set({ user: s.user, settings: s.settings, giros: s.giros, shiftDefs: s.shift_defs, shift: s.shift, encargadoPerms: s.encargado_perms });
    void get().refreshAlerts();
  },
  async boot() {
    if (getToken()) {
      try { await get().refresh(); } catch { setToken(''); set({ user: null }); }
    }
    set({ ready: true });
  },
  async setLoggedIn(token) {
    setToken(token);
    const prev = get().lockedId;
    await get().refresh();
    if (prev && get().user?.id !== prev) set({ cart: [], discount: null });
    set({ lockedId: null, tab: 'venta' });
  },
  async logout() {
    try { await api('/auth/logout', { body: {} }); } catch { /* ya expiró */ }
    setToken('');
    set({ user: null, cart: [], discount: null, lockedId: null, tab: 'venta', shift: null });
  },
  lock() { const u = get().user; if (u) { set({ lockedId: u.id, user: null }); setToken(''); } },
  setTab: (tab) => set({ tab }),

  addToCart(p, qty = 1) {
    set((s) => {
      const i = s.cart.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return { cart: s.cart.map((l, k) => (k === i ? { ...l, qty: qtyFmt(l.qty + qty) } : l)) };
      return { cart: [...s.cart, { product: p, qty }] };
    });
  },
  setQty: (id, qty) => set((s) => ({ cart: s.cart.map((l) => (l.product.id === id ? { ...l, qty: Math.max(0.001, qty) } : l)) })),
  removeLine: (id) => set((s) => ({ cart: s.cart.filter((l) => l.product.id !== id) })),
  clearCart: () => set({ cart: [], discount: null }),
  setDiscount: (discount) => set({ discount }),

  showToast(msg, err = false, action) {
    const id = ++toastSeq;
    set({ toast: { id, msg, err, action } });
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, action ? 8000 : 3200);
  },
  askPin: (message) => new Promise((resolve) => set({ pinRequest: { message, resolve } })),
  async refreshAlerts() {
    try {
      const [a, e] = await Promise.all([api<{ level: string }[]>('/alerts'), api<unknown[]>('/expiry')]);
      set({ alertCount: a.filter((x) => x.level === 'critico').length + e.length });
    } catch { /* sin permiso o sin sesión */ }
  },
}));

export const can = (perm: string) => !!useStore.getState().user?.perms.includes(perm);
export const useCan = (perm: string) => useStore((s) => !!s.user?.perms.includes(perm));

// Totales del ticket (el precio ya incluye IVA)
export function cartTotals(cart: CartLine[], d: Discount | null) {
  const gross = r2(cart.reduce((s, l) => s + l.product.price * l.qty, 0));
  const discount = !d ? 0 : d.type === 'pct' ? r2((gross * d.value) / 100) : Math.min(r2(d.value), gross);
  const total = r2(gross - discount);
  const f = gross ? total / gross : 0;
  const tax = r2(cart.reduce((s, l) => { const paid = l.product.price * l.qty * f; return s + (paid - paid / (1 + l.product.tax_rate / 100)); }, 0));
  return { gross, discount, total, tax };
}

wireApi({
  askPin: (m) => useStore.getState().askPin(m),
  onUnauthorized: () => useStore.setState({ user: null }),
});
