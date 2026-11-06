// Cliente de la API: añade el token, manda a la pantalla de acceso si expira la sesión y pide el PIN
// de quien autoriza cuando el servidor responde "needs_auth".
const KEY = 'ventax_token';
let token = '';
try { token = sessionStorage.getItem(KEY) ?? ''; } catch { /* sin almacenamiento */ }

export const getToken = () => token;
export function setToken(t: string) {
  token = t;
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignorar */ }
}

type PinAsker = (message: string) => Promise<string | null>;
let askPin: PinAsker = async () => null;
let onUnauthorized: () => void = () => {};
export const wireApi = (h: { askPin: PinAsker; onUnauthorized: () => void }) => { askPin = h.askPin; onUnauthorized = h.onUnauthorized; };

export const PERM_LABEL: Record<string, string> = {
  productos: 'Productos, precios y almacén', descuentos: 'Descuentos', devoluciones: 'Devoluciones', reportes: 'Reportes y dashboard',
  empleados: 'Equipo y turnos ajenos', ajustes: 'Ajustes', importar: 'Importar catálogo',
};

export class ApiError extends Error {
  constructor(message: string, public status = 0, public data: Record<string, unknown> = {}, public silent = false) { super(message); }
}

interface Opts { method?: string; body?: Record<string, unknown>; noAuthRedirect?: boolean; noPin?: boolean; _retry?: boolean }

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const body = opts.body ? { ...opts.body } : undefined;
  const res = await fetch('/api' + path, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noAuthRedirect) { setToken(''); onUnauthorized(); throw new ApiError(data.error ?? 'Inicia sesión', 401, data, true); }
  if (res.status === 403 && data.needs_auth && body && !opts.noPin) {
    const pin = await askPin(opts._retry ? data.error : `Requiere autorización: ${PERM_LABEL[data.needs_auth] ?? data.needs_auth}. PIN del dueño o de quien tenga el permiso.`);
    if (!pin) throw new ApiError('Autorización cancelada', 403, data, true);
    return api<T>(path, { ...opts, _retry: true, body: { ...body, auth_pin: pin } });
  }
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`, res.status, data);
  return data as T;
}
