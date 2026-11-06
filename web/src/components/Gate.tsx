import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import type { Employee, PublicInfo, ShiftDef } from '../types';
import { ROLE, initials, tint } from '../util';
import { PinPad } from './PinPad';

// Puerta de entrada: primer arranque, elegir quién eres y PIN (también el bloqueo por inactividad).
export function Gate() {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [picked, setPicked] = useState<Employee | null>(null);
  const [error, setError] = useState('');
  const [error2, setError2] = useState('');
  const lockedId = useStore((s) => s.lockedId);

  const load = () => api<PublicInfo>('/public', { noAuthRedirect: true }).then(setInfo).catch((e: Error) => setError2(e.message));
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (info && lockedId) setPicked(info.employees.find((e) => e.id === lockedId) ?? null);
  }, [info, lockedId]);

  if (error2) return <div className="gate"><div className="gatebox"><h1>VENTAX</h1><p className="muted">No se pudo conectar con el servidor: {error2}</p></div></div>;
  if (!info) return <div className="gate" />;
  if (info.needs_setup) return <Setup info={info} onDone={load} />;

  const login = async (pin: string) => {
    try {
      const r = await api<{ token: string }>('/auth/login', { body: { employee_id: picked!.id, pin }, noAuthRedirect: true, noPin: true });
      await useStore.getState().setLoggedIn(r.token);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo entrar'); }
  };

  return (
    <div className="gate">
      <motion.div className="gatebox" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.25 }}>
        {picked ? (
          <>
            <span className="av big" style={tint(picked.name)}>{initials(picked.name)}</span>
            <h1>{lockedId ? 'Sesión bloqueada' : picked.name}</h1>
            <p className="muted">{lockedId ? `${picked.name}, escribe tu PIN para continuar` : 'Escribe tu PIN'}</p>
            <PinPad onSubmit={login} error={error} />
            <button className="ghost" onClick={() => { setPicked(null); setError(''); useStore.setState({ lockedId: null, cart: [], discount: null }); }}>
              {lockedId ? 'Cambiar de usuario' : 'Volver'}
            </button>
          </>
        ) : (
          <>
            <div className="gatelogo">VENT<b>AX</b></div>
            <h1>{info.business_name}</h1>
            <p className="muted">¿Quién va a usar la caja?</p>
            <div className="people">
              {info.employees.map((e, i) => (
                <motion.button key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} whileTap={{ scale: 0.97 }} onClick={() => { setPicked(e); setError(''); }}>
                  <span className="av" style={tint(e.name)}>{initials(e.name)}</span><b>{e.name}</b><small className="muted">{ROLE[e.role]}</small>
                </motion.button>
              ))}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

type Row = { name: string; start: string; end: string };

function Setup({ info, onDone }: { info: PublicInfo; onDone: () => void }) {
  const [shiftsOn, setShiftsOn] = useState(true);
  const [rows, setRows] = useState<Row[]>([{ name: 'Matutino', start: '06:00', end: '14:00' }, { name: 'Vespertino', start: '14:00', end: '22:00' }]);
  const [msg, setMsg] = useState('');
  const set = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('owner_pin') !== f.get('owner_pin2')) return setMsg('Los PIN no coinciden');
    try {
      await api('/setup', { noAuthRedirect: true, noPin: true, body: {
        business_name: f.get('business_name'), giro: f.get('giro'), open_hours: Number(f.get('open_hours')), shifts_enabled: shiftsOn,
        shifts: shiftsOn ? rows : undefined, owner_name: f.get('owner_name'), owner_pin: f.get('owner_pin') } });
      onDone();
    } catch (err) { setMsg(err instanceof ApiError ? err.message : 'No se pudo guardar'); }
  };

  return (
    <div className="gate">
      <div className="gatebox wide">
        <div className="gatelogo">VENT<b>AX</b></div>
        <h1>Primer arranque</h1>
        <p className="muted">Configura tu negocio. Podrás cambiarlo después en Ajustes.</p>
        <form className="form" onSubmit={submit}>
          <label>Nombre del negocio<input name="business_name" required /></label>
          <div className="row">
            <label className="grow">Giro<select name="giro">{Object.entries(info.giros).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select></label>
            <label>Horas de operación al día<input name="open_hours" type="number" min={1} max={24} defaultValue={12} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={shiftsOn} onChange={(e) => setShiftsOn(e.target.checked)} /> Controlar cortes por turno (de 1 a 3 turnos)</label>
          {shiftsOn && (
            <div className="shiftrows">
              {rows.map((r, i) => (
                <div className="shiftrow" key={i}>
                  <input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Nombre del turno" aria-label={`Nombre del turno ${i + 1}`} />
                  <input type="time" value={r.start} onChange={(e) => set(i, 'start', e.target.value)} aria-label="Inicio" />
                  <input type="time" value={r.end} onChange={(e) => set(i, 'end', e.target.value)} aria-label="Fin" />
                  {rows.length > 1 && <button type="button" className="ghost danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button>}
                </div>
              ))}
              {rows.length < 3 && <button type="button" className="ghost" onClick={() => setRows([...rows, { name: '', start: '14:00', end: '22:00' } satisfies ShiftDefLike])}>+ Agregar turno (máx. 3)</button>}
            </div>
          )}
          <h3>Dueño</h3>
          <label>Nombre<input name="owner_name" required /></label>
          <div className="row">
            <label className="grow">PIN (4 dígitos)<input name="owner_pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
            <label className="grow">Repite el PIN<input name="owner_pin2" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="new-password" /></label>
          </div>
          <button className="primary big">Crear y entrar</button>
          <div className="pinmsg" role="alert">{msg}</div>
        </form>
      </div>
    </div>
  );
}
type ShiftDefLike = Pick<ShiftDef, 'name' | 'start' | 'end'>;
