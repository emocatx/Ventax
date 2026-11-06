import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore, type Tab } from '../store';
import { useUi } from '../ui';

interface Step { target?: string; tab?: Tab; title: string; text: string }
const nav = (t: Tab) => `nav [data-tab="${t}"]`;

function buildSteps(name: string, can: (p: string) => boolean): Step[] {
  const s: Step[] = [
    { title: `Bienvenido, ${name}`, text: 'Te muestro en un minuto cómo trabajar con VENTAX. Avanza con el botón o las flechas del teclado; Esc lo cierra. Lo repites cuando quieras con el botón Guía.' },
    { target: nav('turno'), tab: 'turno', title: '1. Abre tu turno', text: 'Antes de vender abre tu turno aquí. Quien recibe la caja confirma el efectivo con su PIN. Al terminar haces el corte ciego: cuentas el dinero sin ver cuánto debería haber.' },
    { target: '.scan', tab: 'venta', title: '2. Escanea o busca', text: 'Apunta el lector al código de barras y el producto se agrega solo. También puedes escribir el nombre y oprimir Enter.' },
    { target: '.cats', tab: 'venta', title: 'O toca el producto', text: 'Filtra por categoría y toca la tarjeta. Los productos por peso (kg, L) piden la cantidad. El punto de color es el semáforo de existencias: verde bien, amarillo bajo, rojo se agota.' },
    { target: '.ticket-panel', tab: 'venta', title: '3. Cobra', text: 'Aquí ves el ticket, el IVA incluido y el total. Elige efectivo, tarjeta o transferencia (F9 abre el cobro). En efectivo se calcula el cambio y puedes imprimir el ticket.' },
    { target: '.ticket-panel .row', tab: 'venta', title: 'Descuentos y devoluciones', text: 'Solo los autoriza el dueño: se te pedirá su PIN (o el de un encargado con permiso) y siempre un motivo. Para devolver, busca el ticket por su número.' },
    { target: nav('alertas'), tab: 'alertas', title: 'Alertas de inventario', text: 'Rojo: se agota pronto según lo que vendes. Amarillo: stock bajo. También avisa lo que está por caducar, y desde ahí registras la entrada o la merma.' },
    { target: nav('inventario'), tab: 'inventario', title: 'Catálogo', text: can('productos') ? 'Da de alta productos con su foto, cambia precios (queda historial), importa un CSV o da de baja lo que ya no vendes. Las entradas de almacén se registran aquí.' : 'Consulta precios y existencias. Los cambios los hace el dueño o el encargado.' },
  ];
  if (can('reportes')) s.push(
    { target: nav('reportes'), tab: 'reportes', title: 'Reportes', text: 'Ventas brutas, descuentos, devoluciones y netas con el IVA desglosado. Cambia el periodo con las flechas, agrupa por día, turno, cajero o producto y exporta a CSV.' },
    { target: nav('dashboard'), tab: 'dashboard', title: 'Dashboard y asistente', text: 'Cómo vas contra ayer, los productos estrella, los que no se mueven y las horas pico. El Asistente IA responde preguntas como "¿qué reordeno hoy?".' });
  if (can('empleados')) s.push({ target: nav('equipo'), tab: 'equipo', title: 'Equipo', text: 'Da de alta a tus empleados con un PIN de 4 dígitos y asígnales su turno.' });
  if (can('ajustes')) s.push({ target: nav('config'), tab: 'config', title: 'Ajustes', text: 'Define de 1 a 3 turnos, activa el rol de encargado y sus permisos, y elige la carpeta de copias de seguridad.' });
  s.push({ target: '.userbtn', title: 'Tu sesión', text: 'Toca tu nombre para bloquear la pantalla; también se bloquea sola a los 5 minutos. Con "Salir" entra otro compañero con su PIN.' },
    { target: '.helpbtn', title: '¡Listo!', text: 'Este botón repite el recorrido cuando lo necesites.' });
  return s;
}

export function Tour() {
  const open = useUi((s) => s.tourOpen);
  const user = useStore((s) => s.user);
  const steps = useMemo(() => (user ? buildSteps(user.name, (p) => user.perms.includes(p)) : []), [user]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const startTab = useRef<Tab>('venta');

  const close = () => {
    useUi.getState().set({ tourOpen: false });
    if (user) try { localStorage.setItem(`ventax_tour_${user.id}`, '1'); } catch { /* ignorar */ }
    useStore.getState().setTab(startTab.current);
  };
  useEffect(() => { if (open) { setI(0); startTab.current = useStore.getState().tab; } }, [open]);

  const step = steps[i];
  // cambia de pantalla si hace falta y mide el elemento cuando termina la transición
  useEffect(() => {
    if (!open || !step) return;
    if (step.tab && useStore.getState().tab !== step.tab) useStore.getState().setTab(step.tab);
    const t = setTimeout(() => {
      const el = step.target ? document.querySelector(step.target) : null;
      el?.scrollIntoView({ block: 'center' });
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 4 && r.height > 4 ? r : null);
    }, step.tab ? 260 : 30);
    return () => clearTimeout(t);
  }, [open, step]);

  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const cw = card.current.offsetWidth, ch = card.current.offsetHeight, vw = innerWidth, vh = innerHeight;
    if (!rect) { setPos({ left: (vw - cw) / 2, top: (vh - ch) / 2 }); return; }
    let x: number, y: number;
    if (rect.right + cw + 24 < vw) { x = rect.right + 18; y = rect.top; }
    else if (rect.bottom + ch + 24 < vh) { x = rect.left; y = rect.bottom + 14; }
    else if (rect.top - ch - 24 > 0) { x = rect.left; y = rect.top - ch - 14; }
    else { x = rect.left - cw - 18; y = rect.top; }
    setPos({ left: Math.min(Math.max(12, x), vw - cw - 12), top: Math.min(Math.max(12, y), vh - ch - 12) });
  }, [rect, open, i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setI((n) => (n < steps.length - 1 ? n + 1 : n));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!open || !step) return null;
  const last = i === steps.length - 1;
  return (
    <div className={`tour ${rect ? '' : 'center'}`} role="dialog" aria-modal="true" aria-label="Recorrido de bienvenida">
      {rect && <motion.div className="tour-hole" animate={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
      <motion.div ref={card} className="tour-card" style={{ width: Math.min(340, innerWidth - 24) }} animate={pos} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <div className="tour-step">Paso {i + 1} de {steps.length}</div>
            <h2 className="tour-title">{step.title}</h2>
            <p className="tour-text">{step.text}</p>
          </motion.div>
        </AnimatePresence>
        <div className="tour-actions">
          {!last && <button className="ghost" onClick={close}>Saltar</button>}
          <span className="grow" />
          {i > 0 && <button onClick={() => setI(i - 1)}>Anterior</button>}
          <button className="primary" autoFocus onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Terminar' : 'Siguiente'}</button>
        </div>
      </motion.div>
    </div>
  );
}

// Primera vez de cada usuario: abre el recorrido solo
export function useAutoTour() {
  const user = useStore((s) => s.user);
  useEffect(() => {
    if (!user) return;
    let seen = false;
    try { seen = localStorage.getItem(`ventax_tour_${user.id}`) === '1'; } catch { /* ignorar */ }
    if (!seen) { const t = setTimeout(() => useUi.getState().set({ tourOpen: true }), 700); return () => clearTimeout(t); }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
