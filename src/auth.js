// PIN, sesiones y permisos. Los PIN se guardan con scrypt + sal; nunca en claro.
import crypto from 'node:crypto';
import { get, all, run, getSettings, ENCARGADO_PERMS } from './db.js';

export const PIN_RE = /^\d{4}$/;
const MAX_FAILS = 5, LOCK_MS = 60_000;

export const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
};
export const checkPin = (pin, stored) => {
  const [salt, hash] = String(stored).split(':');
  const a = crypto.scryptSync(String(pin), salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Permisos: dueño todo; encargado solo lo que el dueño delegó (si lo activó); cajero nada extra.
export function permsOf(emp) {
  if (!emp) return [];
  if (emp.role === 'dueno') return [...ENCARGADO_PERMS, 'empleados', 'ajustes', 'importar'];
  if (emp.role === 'encargado') {
    const s = getSettings();
    if (s.encargado_enabled !== '1') return [];
    return s.encargado_perms.split(',').filter((p) => ENCARGADO_PERMS.includes(p));
  }
  return [];
}
export const can = (emp, perm) => permsOf(emp).includes(perm);

export const publicEmployee = (e) => ({ id: e.id, name: e.name, role: e.role, shift_def_id: e.shift_def_id, active: e.active });

// Pin duplicado entre empleados activos: se rechaza (así un PIN identifica a quien autoriza).
export function pinInUse(pin, exceptId = 0) {
  return all('SELECT id, pin_hash FROM employees WHERE active=1 AND id<>?', exceptId).some((e) => checkPin(pin, e.pin_hash));
}

// ---- Sesiones en memoria (se pierden al reiniciar: hay que volver a poner el PIN) ----
const sessions = new Map();
const SESSION_MS = 12 * 3600_000;

export function login(employeeId, pin) {
  const e = get('SELECT * FROM employees WHERE id=? AND active=1', Number(employeeId));
  if (!e) return { error: 'Empleado no encontrado' };
  if (e.locked_until > Date.now()) return { error: `Bloqueado. Intenta en ${Math.ceil((e.locked_until - Date.now()) / 1000)} s` };
  if (!checkPin(pin, e.pin_hash)) {
    const fails = e.failed_attempts + 1;
    if (fails >= MAX_FAILS) run('UPDATE employees SET failed_attempts=0, locked_until=? WHERE id=?', Date.now() + LOCK_MS, e.id);
    else run('UPDATE employees SET failed_attempts=? WHERE id=?', fails, e.id);
    return { error: fails >= MAX_FAILS ? 'Demasiados intentos: bloqueado 1 minuto' : `PIN incorrecto (${MAX_FAILS - fails} intentos restantes)` };
  }
  run('UPDATE employees SET failed_attempts=0, locked_until=0 WHERE id=?', e.id);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { id: e.id, at: Date.now() });
  return { token, employee: e };
}
export const logout = (token) => sessions.delete(token);
export function sessionUser(token) {
  const s = sessions.get(token);
  if (!s || Date.now() - s.at > SESSION_MS) { sessions.delete(token); return null; }
  s.at = Date.now();
  return get('SELECT * FROM employees WHERE id=? AND active=1', s.id) || null;
}

// ---- Autorización por PIN de otra persona (descuentos, devoluciones, etc.) ----
let authFails = [];
export function authorizerByPin(pin, perm) {
  const now = Date.now();
  authFails = authFails.filter((t) => now - t < LOCK_MS);
  if (authFails.length >= MAX_FAILS) return { error: 'Demasiados intentos de autorización: espera 1 minuto' };
  for (const e of all('SELECT * FROM employees WHERE active=1')) {
    if (can(e, perm) && checkPin(String(pin), e.pin_hash)) return { employee: e };
  }
  authFails.push(now);
  return { error: 'PIN no válido o sin permiso para esta acción' };
}
