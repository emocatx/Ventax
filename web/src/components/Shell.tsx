import { useEffect, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore, useCan, type Tab } from '../store';
import { useSearch } from '../search';
import { ROLE } from '../util';
import { Cobro } from '../screens/Cobro';
import { Turnos } from '../screens/Turnos';
import { Alertas } from '../screens/Alertas';
import { Catalogo } from '../screens/Catalogo';
import { Reportes } from '../screens/Reportes';
import { Dashboard } from '../screens/Dashboard';
import { Asistente } from '../screens/Asistente';
import { Equipo } from '../screens/Equipo';
import { Ajustes } from '../screens/Ajustes';
import { Tour, useAutoTour } from './Tour';
import { useUi } from '../ui';

const I = ({ children }: { children: ReactNode }) => <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
interface Item { tab: Tab; label: string; icon: ReactNode; perm?: string }
const GROUPS: { name: string; perm?: string; items: Item[] }[] = [
  { name: 'Operación', items: [
    { tab: 'venta', label: 'Cobro', icon: <I><path d="M3 4h2l2.4 11h10.2L20 7H6" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /></I> },
    { tab: 'turno', label: 'Turnos', icon: <I><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I> } ] },
  { name: 'Inventario', items: [
    { tab: 'alertas', label: 'Alertas', icon: <I><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.5" /></I> },
    { tab: 'inventario', label: 'Catálogo', icon: <I><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></I> } ] },
  { name: 'Gestión', perm: 'reportes', items: [
    { tab: 'reportes', label: 'Reportes', perm: 'reportes', icon: <I><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7M9 8h3" /></I> },
    { tab: 'dashboard', label: 'Dashboard', perm: 'reportes', icon: <I><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></I> },
    { tab: 'asistente', label: 'Asistente IA', perm: 'reportes', icon: <I><path d="M5 5h14v10H10l-5 4z" /></I> } ] },
  { name: 'Sistema', perm: 'empleados', items: [
    { tab: 'equipo', label: 'Equipo', perm: 'empleados', icon: <I><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 100-6M18 14c2 .6 3 2.4 3 5" /></I> },
    { tab: 'config', label: 'Ajustes', perm: 'ajustes', icon: <I><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></I> } ] },
];

function NavButton({ item }: { item: Item }) {
  const tab = useStore((s) => s.tab);
  const allowed = useCan(item.perm ?? 'x') || !item.perm;
  const alerts = useStore((s) => s.alertCount);
  if (!allowed) return null;
  return (
    <button data-tab={item.tab} className={tab === item.tab ? 'on' : ''} onClick={() => useStore.getState().setTab(item.tab)}>
      {item.icon}{item.label}
      {item.tab === 'alertas' && alerts > 0 && <span className="count">{alerts}</span>}
    </button>
  );
}

function Group({ g }: { g: (typeof GROUPS)[number] }) {
  const ok = useCan(g.perm ?? 'x') || !g.perm;
  if (!ok) return null;
  return <><div className="grp">{g.name}</div>{g.items.map((it) => <NavButton key={it.tab} item={it} />)}</>;
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return <span className="chip plain">{now.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })} · {now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>;
}

function Topbar() {
  const { user, shift, tab } = useStore();
  const query = useSearch((s) => s.query);
  const online = useOnline();
  const toggleTheme = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* ignorar */ }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const code = query.trim();
    if (!code) return;
    const st = useStore.getState();
    if (!st.shift) { st.setTab('turno'); useSearch.getState().setQuery(''); return st.showToast('Abre un turno para vender', true); }
    if (tab !== 'venta') st.setTab('venta');
    useSearch.getState().submit(code);
  };
  return (
    <header className="top">
      <input className="scan" value={query} onChange={(e) => useSearch.getState().setQuery(e.target.value)} onKeyDown={onKey} placeholder="Escanear código o buscar producto…" autoComplete="off" aria-label="Escanear código o buscar producto" />
      <Clock />
      <span className={`chip ${shift ? 'ok' : ''}`}>{shift ? `Turno${shift.shift_name ? ' ' + shift.shift_name : ''}: ${shift.cashier}` : 'Sin turno'}</span>
      <span className={`chip net ${online ? 'ok' : ''}`}>{online ? 'Online' : 'Sin internet (opera local)'}</span>
      <button className="ghost helpbtn" title="Ver el recorrido de ayuda" onClick={() => useUi.getState().set({ tourOpen: true })}>Guía</button>
      <button className="userbtn" title="Bloquear sesión" onClick={() => useStore.getState().lock()}>{user?.name} · {user ? ROLE[user.role] : ''}</button>
      <button className="ghost" onClick={() => void useStore.getState().logout()}>Salir</button>
      <button className="ghost" title="Modo claro/oscuro" onClick={toggleTheme}>◐</button>
    </header>
  );
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

// Bloqueo automático tras 5 minutos sin actividad
function useIdleLock(ms = 5 * 60 * 1000) {
  useEffect(() => {
    let t = window.setTimeout(() => useStore.getState().lock(), ms);
    const reset = () => { window.clearTimeout(t); t = window.setTimeout(() => useStore.getState().lock(), ms); };
    const ev = ['click', 'keydown', 'mousemove', 'touchstart'] as const;
    ev.forEach((e) => addEventListener(e, reset, { passive: true }));
    return () => { window.clearTimeout(t); ev.forEach((e) => removeEventListener(e, reset)); };
  }, [ms]);
}

const SCREENS: Record<Tab, () => React.ReactElement> = {
  venta: Cobro, turno: Turnos, alertas: Alertas, inventario: Catalogo, reportes: Reportes, dashboard: Dashboard, asistente: Asistente, equipo: Equipo, config: Ajustes,
};
const NEED: Partial<Record<Tab, string>> = { reportes: 'reportes', dashboard: 'reportes', asistente: 'reportes', equipo: 'empleados', config: 'ajustes' };

function Screen({ tab }: { tab: Tab }) {
  const allowed = useCan(NEED[tab] ?? 'x') || !NEED[tab];
  if (!allowed) return <div className="card narrow"><p>No tienes permiso para esta sección.</p></div>;
  const S = SCREENS[tab];
  return <S />;
}

export function Shell() {
  useIdleLock();
  useAutoTour();
  useEffect(() => () => useUi.getState().set({ tourOpen: false }), []);
  const tab = useStore((s) => s.tab);
  const shift = useStore((s) => s.shift);
  const bizName = useStore((s) => s.settings?.business_name);
  return (
    <div className="app">
      <aside className="side">
        <div className="logo">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#ffc933" /><path d="M6 7l6 11 6-11" fill="none" stroke="#2a2f3a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Ventax</span>
        </div>
        <nav>{GROUPS.map((g) => <Group key={g.name} g={g} />)}</nav>
        <div className="biz muted">{bizName}</div>
      </aside>
      <div className="content">
        <Topbar />
        <main>
          {shift && shift.overdue_minutes > 0 && (
            <div className="banner">El turno {shift.shift_name} de {shift.cashier} debió cerrar hace {shift.overdue_minutes} min. Haz el corte para no dejarlo abierto.</div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
              <Screen tab={tab} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Tour />
    </div>
  );
}
