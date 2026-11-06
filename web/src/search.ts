import { create } from 'zustand';

// Caja de búsqueda / lector de código de barras de la barra superior.
// El lector "teclea" el código y manda Enter: `submitted` lleva ese código a la pantalla de Cobro.
interface SearchStore {
  query: string;
  submitted: { code: string; n: number } | null;
  setQuery: (q: string) => void;
  submit: (code: string) => void;
  consume: () => void;
}
let n = 0;
export const useSearch = create<SearchStore>((set) => ({
  query: '', submitted: null,
  setQuery: (query) => set({ query }),
  submit: (code) => set({ submitted: { code, n: ++n }, query: '' }),
  consume: () => set({ submitted: null }),
}));
