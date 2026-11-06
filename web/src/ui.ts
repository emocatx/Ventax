import { create } from 'zustand';
import { ApiError } from './api';
import { useStore } from './store';

// Estado de interfaz compartido entre pantallas (no es dato de negocio).
export interface StockPrefill { barcode: string; type: string; qty: string; note: string }
export interface ChatMsg { who: 'me' | 'ai'; text: string }
interface Ui {
  stockPrefill: StockPrefill | null;   // Alertas → Catálogo: entrada o merma ya llenada
  newProductCode: string | null;       // Cobro → Catálogo: crear producto con el código escaneado
  tourOpen: boolean;
  chat: ChatMsg[];
  set: (p: Partial<Omit<Ui, 'set'>>) => void;
}
export const useUi = create<Ui>((set) => ({ stockPrefill: null, newProductCode: null, tourOpen: false, chat: [], set: (p) => set(p) }));

export function toastErr(e: unknown) {
  if (e instanceof ApiError && e.silent) return;
  useStore.getState().showToast(e instanceof Error ? e.message : 'Error', true);
}
