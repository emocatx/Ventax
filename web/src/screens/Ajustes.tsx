import { useEffect, useState } from 'react';
import { api, PERM_LABEL } from '../api';
import { useStore } from '../store';
import { toastErr } from '../ui';
import { Title } from './Placeholder';

type Row = { id?: number; name: string; start: string; end: string };

export function Ajustes() {
  const { settings, giros, shiftDefs, encargadoPerms } = useStore();
  const [form, setForm] = useState({ business_name: '', giro: 'abarrotes', open_hours: '12', backup_dir: '' });
  const [shiftsOn, setShiftsOn] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [encOn, setEncOn] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({ business_name: settings.business_name, giro: settings.giro, open_hours: settings.open_hours, backup_dir: settings.backup_dir });
    setShiftsOn(settings.shifts_enabled === '1'); setEncOn(settings.encargado_enabled === '1');
    setPerms(settings.encargado_perms.split(',').filter(Boolean));
    setRows(shiftDefs.map((d) => ({ id: d.id, name: d.name, start: d.start, end: d.end })));
  }, [settings, shiftDefs]);

  const setRow = (i: number, k: keyof Row, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/settings', { body: { ...form, open_hours: Number(form.open_hours), shifts_enabled: shiftsOn, encargado_enabled: encOn, encargado_perms: perms, shifts: shiftsOn ? rows : undefined } });
      await useStore.getState().refresh(); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (er) { toastErr(er); }
  };
  const backup = async () => { try { const r = await api<{ file: string }>('/backup', { body: {} }); useStore.getState().showToast('Copia guardada en ' + r.file); } catch (er) { toastErr(er); } };

  if (!settings) return <Title text="Ajustes" />;
  return (
    <>
      <Title text="Ajustes" />
      <form className="card form narrow" onSubmit={(e) => void save(e)}>
        <h3 style={{ margin: 0 }}>Negocio</h3>
        <label>Nombre del negocio<input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></label>
        <label>Giro<select value={form.giro} onChange={(e) => setForm({ ...form, giro: e.target.value })}>{Object.entries(giros).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select></label>
        <label>Horas de operación al día<input type="number" min={1} max={24} value={form.open_hours} onChange={(e) => setForm({ ...form, open_hours: e.target.value })} /></label>

        <h3>Turnos</h3>
        <label className="check"><input type="checkbox" checked={shiftsOn} onChange={(e) => setShiftsOn(e.target.checked)} /> Controlar cortes por turno</label>
        {shiftsOn && (
          <div className="shiftrows">
            {rows.map((r, i) => (
              <div className="shiftrow" key={r.id ?? `n${i}`}>
                <input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} placeholder="Nombre del turno" aria-label={`Nombre del turno ${i + 1}`} />
                <input type="time" value={r.start} onChange={(e) => setRow(i, 'start', e.target.value)} aria-label="Inicio" />
                <input type="time" value={r.end} onChange={(e) => setRow(i, 'end', e.target.value)} aria-label="Fin" />
                {rows.length > 1 && <button type="button" className="ghost danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button>}
              </div>
            ))}
            {rows.length < 3 && <button type="button" className="ghost" onClick={() => setRows([...rows, { name: '', start: '14:00', end: '22:00' }])}>+ Agregar turno (máx. 3)</button>}
          </div>
        )}

        <h3>Encargado</h3>
        <label className="check"><input type="checkbox" checked={encOn} onChange={(e) => setEncOn(e.target.checked)} /> Activar el rol de encargado</label>
        {encOn && encargadoPerms.map((p) => (
          <label className="check" key={p}><input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} /> {PERM_LABEL[p]}</label>
        ))}

        <h3>Copias de seguridad</h3>
        <label>Carpeta de copias (vacío = carpeta data/backups)<input value={form.backup_dir} onChange={(e) => setForm({ ...form, backup_dir: e.target.value })} placeholder="D:\Respaldos VENTAX" /></label>
        <div className="row"><button className="primary grow">Guardar</button><button type="button" onClick={() => void backup()}>Copia ahora</button></div>
        {saved && <div className="up">Guardado</div>}
      </form>
    </>
  );
}
