import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { useStore } from '../store';
import { toastErr } from '../ui';
import type { Employee, Role } from '../types';
import { ROLE, initials, tint } from '../util';
import { Modal } from '../components/Modal';
import { Title } from './Placeholder';

export function Equipo() {
  const defs = useStore((s) => s.shiftDefs);
  const [list, setList] = useState<Employee[]>([]);
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const load = useCallback(() => api<Employee[]>('/employees').then(setList).catch(toastErr), []);
  useEffect(() => { void load(); }, [load]);
  const defName = (id: number | null) => defs.find((d) => d.id === id)?.name ?? 'Cualquiera';

  return (
    <>
      <Title text="Equipo" sub={`${list.filter((e) => e.active).length} empleados activos`} />
      <div className="bar"><span className="grow" /><button className="primary" onClick={() => setEditing('new')}>+ Nuevo empleado</button></div>
      <div className="team">
        {list.map((e, i) => (
          <motion.button key={e.id} className="member" style={e.active ? undefined : { opacity: 0.5 }} onClick={() => setEditing(e)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: e.active ? 1 : 0.5, y: 0 }} transition={{ delay: i * 0.03 }} whileHover={{ y: -2 }}>
            <span className="av" style={tint(e.name)}>{initials(e.name)}</span>
            <span><b>{e.name}</b><br /><small className="muted">{ROLE[e.role]} · {defName(e.shift_def_id)}{e.active ? '' : ' · baja'}</small></span>
          </motion.button>
        ))}
      </div>
      <p className="muted">El rol Encargado solo tiene permisos si lo activas en Ajustes y eliges cuáles. Los PIN son de 4 dígitos y no se pueden repetir entre empleados.</p>
      <EmployeeForm emp={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
    </>
  );
}

function EmployeeForm({ emp, onClose, onSaved }: { emp: Employee | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const defs = useStore((s) => s.shiftDefs);
  const e = emp === 'new' ? null : emp;
  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = { name: f.get('name'), role: f.get('role'), shift_def_id: f.get('shift_def_id') || null };
    if (f.get('pin')) body.pin = f.get('pin');
    if (e) body.active = f.get('active') === 'on';
    try { await api(e ? '/employees/' + e.id : '/employees', { method: e ? 'PUT' : 'POST', body }); useStore.getState().showToast('Empleado guardado'); onSaved(); }
    catch (er) { toastErr(er); }
  };
  return (
    <Modal open={!!emp} onClose={onClose}>
      <h2>{e ? 'Editar' : 'Nuevo'} empleado</h2>
      <form className="form" onSubmit={(ev) => void submit(ev)}>
        <label>Nombre<input name="name" required defaultValue={e?.name ?? ''} autoFocus /></label>
        <div className="row">
          <label className="grow">Rol<select name="role" defaultValue={e?.role ?? 'cajero'}>{(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></label>
          <label className="grow">Turno asignado<select name="shift_def_id" defaultValue={e?.shift_def_id ?? ''}><option value="">Cualquiera</option>{defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        </div>
        <label>{e ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN (4 dígitos)'}<input name="pin" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4} required={!e} autoComplete="new-password" /></label>
        {e && <label className="check"><input type="checkbox" name="active" defaultChecked={!!e.active} /> Activo</label>}
        <div className="row"><button type="button" className="ghost" onClick={onClose}>Cancelar</button><button className="primary big grow">Guardar</button></div>
      </form>
    </Modal>
  );
}
