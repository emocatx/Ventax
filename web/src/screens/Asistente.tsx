import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { useUi } from '../ui';
import { Title } from './Placeholder';

const SUGGEST = ['¿Cuál fue el producto más vendido el fin de semana pasado?', '¿Qué artículos debo reordenar hoy?', 'Genera una predicción de ventas para la próxima quincena', '¿Cuáles son mis horas pico?', '¿Cuánto vendí ayer?', '¿Qué productos son fantasma?'];

// **negritas** → <b>
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part))}</>;
}

export function Asistente() {
  const chat = useUi((s) => s.chat);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!chat.length) useUi.getState().set({ chat: [{ who: 'ai', text: '¡Hola! Soy tu asistente de negocio. Pregúntame por ventas, productos estrella, reorden o proyecciones.' }] }); }, [chat.length]);
  useEffect(() => { log.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [chat, busy]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    const add = (m: (typeof chat)[number]) => useUi.getState().set({ chat: [...useUi.getState().chat, m] });
    add({ who: 'me', text: question }); setQ(''); setBusy(true);
    try { add({ who: 'ai', text: (await api<{ answer: string }>('/assistant', { body: { question } })).answer }); }
    catch (e) { add({ who: 'ai', text: 'Error: ' + (e instanceof Error ? e.message : 'sin respuesta') }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Title text="Asistente IA" sub="Pregunta en lenguaje natural sobre tu negocio" />
      <div className="chat">
        <div className="chatlog" ref={log}>
          <AnimatePresence initial={false}>
            {chat.map((m, i) => (
              <motion.div key={i} className={`msg ${m.who}`} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.2 }}><Rich text={m.text} /></motion.div>
            ))}
            {busy && <motion.div key="typing" className="msg ai typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><i /><i /><i /></motion.div>}
          </AnimatePresence>
        </div>
        <div className="chips">{SUGGEST.map((s) => <button key={s} onClick={() => void send(s)}>{s}</button>)}</div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
          <input id="chatInput" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregunta sobre tu negocio…" autoComplete="off" autoFocus aria-label="Pregunta" />
          <button className="primary" disabled={busy}>Enviar</button>
        </form>
      </div>
    </>
  );
}
