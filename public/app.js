// VENTAX — interfaz (JS plano, sin dependencias, funciona sin internet en la red local)
import { runTour, endTour } from './tour.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const money = (n) => fmt.format(n || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNIT = { pieza: 'pza', kg: 'kg', g: 'g', l: 'L' };
const qtyFmt = (q) => Math.round(q * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
const hue = (t) => { let h = 0; for (const c of String(t || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = (n) => String(n).replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const tint = (t) => `background:hsl(${hue(t)} 45% 92%);color:hsl(${hue(t)} 40% 30%)`;
const ROLE = { dueno: 'Dueño', encargado: 'Encargado', cajero: 'Cajero' };
const PERM_LABEL = { productos: 'Productos, precios y almacén', descuentos: 'Descuentos', devoluciones: 'Devoluciones', reportes: 'Reportes y dashboard', empleados: 'Equipo y turnos ajenos', ajustes: 'Ajustes', importar: 'Importar catálogo' };
const thumb = (p) => p.image
  ? `<span class="thumb"><img src="${esc(p.image)}" alt="" onerror="this.remove()"></span>`
  : `<span class="thumb" style="${tint(p.category)}">${esc(initials(p.name))}</span>`;

// ---------- Sesión y API ----------
const KEY = 'ventax_token';
// La versión nueva (React) abre esta con "#t=<token>" para compartir la sesión; se borra de la barra enseguida.
try { const m = /^#t=([0-9a-f]+)$/.exec(location.hash); if (m) { sessionStorage.setItem(KEY, m[1]); history.replaceState(null, '', location.pathname + location.search); } } catch {}
let token = ''; try { token = sessionStorage.getItem(KEY) || ''; } catch {}
const setToken = (t) => { token = t; try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {} };
const state = { user: null, settings: {}, giros: {}, shift: null, shift_defs: [], cart: [], tab: 'venta', cat: 'Todos', products: [], discount: null, lockedId: null, encargado_perms: [] };
const can = (p) => !!state.user && state.user.perms.includes(p);

async function api(path, opts = {}) {
  const body = opts.body ? { ...opts.body } : undefined;
  const res = await fetch('/api' + path, { method: opts.method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-token': token }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noAuthRedirect) { setToken(''); showGate(); throw Object.assign(new Error(data.error || 'Inicia sesión'), { silent: true }); }
  if (res.status === 403 && data.needs_auth && body && !opts.noPin) {
    const pin = await askPin(opts._msg ? data.error : `Requiere autorización: ${PERM_LABEL[data.needs_auth] || data.needs_auth}. PIN del dueño o de quien tenga el permiso.`);
    if (!pin) throw Object.assign(new Error('Autorización cancelada'), { silent: true });
    return api(path, { ...opts, _msg: true, body: { ...body, auth_pin: pin } });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status, data });
  return data;
}
function toast(msg, err = false, action) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { t.classList.add('hidden'); action.fn(); }; t.append(b); }
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), action ? 8000 : 3200);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (!e.silent) toast(e.message, true); } };

// ---------- Tema, red, diálogos ----------
const savedTheme = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })();
document.documentElement.dataset.theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch {} };
const netUpdate = () => { const n = $('#netBadge'); n.className = 'chip' + (navigator.onLine ? ' ok' : ''); n.textContent = navigator.onLine ? 'Online' : 'Sin internet (opera local)'; };
addEventListener('online', netUpdate); addEventListener('offline', netUpdate); netUpdate();
const tickClock = () => { const d = new Date(); $('#clock').textContent = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); };
tickClock(); setInterval(tickClock, 30000);

const dlg = $('#dlg');
function openDialog(html, cls = '') { dlg.className = cls; dlg.innerHTML = html; dlg.onkeydown = null; if (!dlg.open) dlg.showModal(); return dlg; }
function closeDialog() { if (dlg.open) dlg.close(); focusScan(); }
dlg.addEventListener('cancel', () => setTimeout(focusScan, 0));
const focusScan = () => { if (!dlg.open && !$('#pinDlg').open && state.user && state.tab === 'venta') $('#scan').focus(); };

// ---------- Teclado numérico de PIN (táctil + teclado físico) ----------
function pinPad(root, onSubmit) {
  let pin = '';
  root.innerHTML = `<div class="pindots" aria-live="polite"></div><div class="pinhint">PIN de 4 dígitos</div><div class="pinmsg" role="alert"></div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="back" aria-label="Borrar">⌫</button><button type="button" data-k="0">0</button><button type="button" data-k="ok" class="primary">OK</button></div>`;
  const draw = () => { $('.pindots', root).innerHTML = Array.from({ length: 4 }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  draw();
  const msg = (t) => { $('.pinmsg', root).textContent = t || ''; };
  const press = (k) => {
    if (k === 'back') pin = pin.slice(0, -1);
    else if (k === 'ok') { if (pin.length >= 4) { const p = pin; pin = ''; draw(); onSubmit(p, msg); } else msg('El PIN tiene 4 dígitos'); return; }
    else if (pin.length < 4) pin += k;
    msg(''); draw();
    if (pin.length === 4) { const p = pin; setTimeout(() => { pin = ''; draw(); onSubmit(p, msg); }, 120); }   // PIN de 4 dígitos: entra solo
  };
  root.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
  root._key = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back'); else if (e.key === 'Enter') press('ok'); else return; e.preventDefault(); };
  return { msg, clear: () => { pin = ''; draw(); } };
}

function askPin(message) {
  return new Promise((resolve) => {
    const d = $('#pinDlg');
    d.innerHTML = `<h2>Autorización</h2><p class="muted">${esc(message)}</p><div id="pinRoot"></div><button type="button" id="pinCancel" class="ghost" style="width:100%;margin-top:8px">Cancelar</button>`;
    const root = $('#pinRoot', d);
    const finish = (v) => { d.onkeydown = null; if (d.open) d.close(); resolve(v); };
    pinPad(root, (pin) => finish(pin));
    d.onkeydown = root._key;
    $('#pinCancel', d).onclick = () => finish(null);
    d.oncancel = () => resolve(null);
    if (!d.open) d.showModal();
  });
}

// ---------- Puerta: primer arranque, inicio de sesión y bloqueo ----------
const gate = $('#gate');
const showApp = (on) => { $('#app').classList.toggle('hidden', !on); gate.classList.toggle('hidden', on); };
let idleTimer;
const IDLE_MS = 5 * 60 * 1000;
function resetIdle() { clearTimeout(idleTimer); if (state.user) idleTimer = setTimeout(lockSession, IDLE_MS); }
['click', 'keydown', 'mousemove', 'touchstart'].forEach((ev) => addEventListener(ev, resetIdle, { passive: true }));

async function showGate() {
  endTour(); clearTimeout(idleTimer); showApp(false);
  if ($('#pinDlg').open) $('#pinDlg').close();
  if (dlg.open) dlg.close();
  let pub;
  try { pub = await api('/public', { noAuthRedirect: true }); } catch (e) { gate.innerHTML = `<div class="gatebox"><h1>VENTAX</h1><p class="muted">No se pudo conectar con el servidor: ${esc(e.message)}</p></div>`; return; }
  if (pub.needs_setup) return renderSetup(pub);
  if (state.lockedId && pub.employees.some((e) => e.id === state.lockedId)) return renderPinFor(pub, pub.employees.find((e) => e.id === state.lockedId), true);
  renderLogin(pub);
}
function renderLogin(pub) {
  state.lockedId = null;
  gate.innerHTML = `<div class="gatebox"><div class="gatelogo">VENT<b>AX</b></div><h1>${esc(pub.business_name)}</h1><p class="muted">¿Quién va a usar la caja?</p>
    <div class="people">${pub.employees.map((e) => `<button data-id="${e.id}"><span class="av" style="${tint(e.name)}">${esc(initials(e.name))}</span><b>${esc(e.name)}</b><small class="muted">${ROLE[e.role]}</small></button>`).join('')}</div></div>`;
  $('.people', gate).onclick = (ev) => { const b = ev.target.closest('button'); if (b) renderPinFor(pub, pub.employees.find((e) => e.id == b.dataset.id), false); };
}
function renderPinFor(pub, emp, locked) {
  gate.innerHTML = `<div class="gatebox"><span class="av big" style="${tint(emp.name)}">${esc(initials(emp.name))}</span><h1>${locked ? 'Sesión bloqueada' : esc(emp.name)}</h1><p class="muted">${locked ? esc(emp.name) + ', escribe tu PIN para continuar' : 'Escribe tu PIN'}</p><div id="gpin"></div>
    <button class="ghost" id="gback">${locked ? 'Cambiar de usuario' : 'Volver'}</button></div>`;
  const pad = pinPad($('#gpin', gate), async (pin, msg) => {
    try {
      const r = await api('/auth/login', { body: { employee_id: emp.id, pin }, noAuthRedirect: true, noPin: true });
      if (state.lockedId && state.lockedId !== emp.id) state.cart = [];
      setToken(r.token); state.lockedId = null; document.removeEventListener('keydown', gateKey); await enterApp();
    } catch (e) { msg(e.message); }
  });
  const gateKey = (e) => { if (!gate.classList.contains('hidden')) $('#gpin', gate)._key?.(e); };
  $('#gpin', gate)._key = $('#gpin', gate)._key || null;
  document.addEventListener('keydown', gateKey);
  $('#gback', gate).onclick = () => { document.removeEventListener('keydown', gateKey); if (locked) { state.lockedId = null; state.cart = []; } renderLogin(pub); };
  void pad;
}
function lockSession() { if (!state.user) return; state.lockedId = state.user.id; showGate(); }

function shiftRowsHTML(defs) {
  return `<div class="shiftrows">${defs.map((d, i) => `<div class="shiftrow" data-id="${d.id || ''}"><input name="n" value="${esc(d.name)}" placeholder="Nombre del turno" aria-label="Nombre del turno ${i + 1}"><input name="s" type="time" value="${esc(d.start)}" aria-label="Inicio"><input name="e" type="time" value="${esc(d.end)}" aria-label="Fin"><button type="button" class="ghost danger" data-rm>Quitar</button></div>`).join('')}</div>
    <button type="button" class="ghost" data-addshift>+ Agregar turno (máx. 3)</button>`;
}
function wireShiftRows(root) {
  const rows = () => $$('.shiftrow', root);
  const sync = () => { $('[data-addshift]', root).classList.toggle('hidden', rows().length >= 3); $$('[data-rm]', root).forEach((b) => b.classList.toggle('hidden', rows().length <= 1)); };
  root.addEventListener('click', (e) => {
    if (e.target.matches('[data-rm]')) { e.target.closest('.shiftrow').remove(); sync(); }
    if (e.target.matches('[data-addshift]') && rows().length < 3) {
      const div = document.createElement('div'); div.className = 'shiftrow';
      div.innerHTML = `<input name="n" placeholder="Nombre del turno"><input name="s" type="time" value="14:00"><input name="e" type="time" value="22:00"><button type="button" class="ghost danger" data-rm>Quitar</button>`;
      $('.shiftrows', root).append(div); sync();
    }
  });
  sync();
}
const readShiftRows = (root) => $$('.shiftrow', root).map((r) => ({ id: r.dataset.id ? Number(r.dataset.id) : undefined, name: $('[name=n]', r).value, start: $('[name=s]', r).value, end: $('[name=e]', r).value }));

function renderSetup(pub) {
  gate.innerHTML = `<div class="gatebox wide"><div class="gatelogo">VENT<b>AX</b></div><h1>Primer arranque</h1><p class="muted">Configura tu negocio. Podrás cambiarlo después en Ajustes.</p>
    <form id="setupForm" class="form">
      <label>Nombre del negocio<input name="business_name" required></label>
      <div class="row"><label class="grow">Giro<select name="giro">${Object.entries(pub.giros).map(([k, g]) => `<option value="${k}">${esc(g.label)}</option>`).join('')}</select></label>
      <label>Horas de operación al día<input name="open_hours" type="number" min="1" max="24" value="12"></label></div>
      <label class="check"><input type="checkbox" name="shifts_enabled" checked> Controlar cortes por turno (de 1 a 3 turnos)</label>
      <div id="shiftBox">${shiftRowsHTML([{ name: 'Matutino', start: '06:00', end: '14:00' }, { name: 'Vespertino', start: '14:00', end: '22:00' }])}</div>
      <h3>Dueño</h3>
      <label>Nombre<input name="owner_name" required></label>
      <div class="row"><label class="grow">PIN (4 dígitos)<input name="owner_pin" type="password" inputmode="numeric" pattern="\\d{4}" required autocomplete="new-password"></label>
      <label class="grow">Repite el PIN<input name="owner_pin2" type="password" inputmode="numeric" pattern="\\d{4}" required autocomplete="new-password"></label></div>
      <button class="primary big">Crear y entrar</button><div class="pinmsg" id="setupMsg"></div>
    </form></div>`;
  wireShiftRows($('#shiftBox', gate));
  const f = $('#setupForm', gate);
  f.shifts_enabled.onchange = () => $('#shiftBox', gate).classList.toggle('hidden', !f.shifts_enabled.checked);
  f.onsubmit = guard(async (e) => {
    e.preventDefault();
    if (f.owner_pin.value !== f.owner_pin2.value) return ($('#setupMsg').textContent = 'Los PIN no coinciden');
    try {
      await api('/setup', { noAuthRedirect: true, noPin: true, body: { business_name: f.business_name.value, giro: f.giro.value, open_hours: Number(f.open_hours.value), shifts_enabled: f.shifts_enabled.checked,
        shifts: f.shifts_enabled.checked ? readShiftRows($('#shiftBox', gate)) : undefined, owner_name: f.owner_name.value, owner_pin: f.owner_pin.value } });
      showGate();
    } catch (err) { $('#setupMsg').textContent = err.message; }
  });
}

$('#userBtn').onclick = lockSession;
$('#logoutBtn').onclick = guard(async () => { try { await api('/auth/logout', { body: {} }); } catch {} setToken(''); state.user = null; state.cart = []; state.lockedId = null; state.discount = null; showGate(); });

// ---------- Estado y navegación ----------
async function refreshState() {
  const s = await api('/state');
  Object.assign(state, { settings: s.settings, giros: s.giros, shift: s.shift, shift_defs: s.shift_defs, user: s.user, encargado_perms: s.encargado_perms });
  $('#biz').textContent = state.settings.business_name;
  $('#userName').textContent = `${state.user.name} · ${ROLE[state.user.role]}`;
  const b = $('#shiftBadge');
  b.className = 'chip' + (state.shift ? ' ok' : '');
  b.textContent = state.shift ? `Turno${state.shift.shift_name ? ' ' + state.shift.shift_name : ''}: ${state.shift.cashier}` : 'Sin turno';
  $$('[data-perm]').forEach((el) => el.classList.toggle('hidden', !can(el.dataset.perm)));
  $$('[data-need]').forEach((el) => el.classList.toggle('hidden', !can(el.dataset.need)));
  const bn = $('#banner');
  if (state.shift?.overdue_minutes > 0) { bn.textContent = `El turno ${state.shift.shift_name || ''} de ${state.shift.cashier} debió cerrar hace ${state.shift.overdue_minutes} min. Haz el corte para no dejarlo abierto.`; bn.classList.remove('hidden'); }
  else bn.classList.add('hidden');
  refreshAlertCount();
}
async function refreshAlertCount() {
  try {
    const [a, e] = await Promise.all([api('/alerts'), api('/expiry')]);
    const n = a.filter((x) => x.level === 'critico').length + e.length;
    const c = $('#alertCount'); c.textContent = n; c.classList.toggle('hidden', !n);
  } catch {}
}
async function enterApp() {
  showApp(true);
  await refreshState();
  resetIdle();
  showTab('venta');
  maybeAutoTour();
}

const NEED = { reportes: 'reportes', dashboard: 'reportes', asistente: 'reportes', equipo: 'empleados', config: 'ajustes' };
const TITLES = { venta: 'Cobro', turno: 'Turnos', alertas: 'Alertas', inventario: 'Catálogo', reportes: 'Reportes', dashboard: 'Dashboard', asistente: 'Asistente IA', equipo: 'Equipo', config: 'Ajustes' };
const setSub = (t) => { $('#pageSub').textContent = t || ''; };
const RENDER = () => ({ venta: renderVenta, inventario: renderInventario, turno: renderTurno, dashboard: renderDashboard, alertas: renderAlertas, reportes: renderReportes, asistente: renderAsistente, equipo: renderEquipo, config: renderConfig });
function showTab(name) {
  if (NEED[name] && !can(NEED[name])) return toast('No tienes permiso para esta sección', true);
  state.tab = name;
  $('#pageTitle').textContent = TITLES[name]; setSub('');
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
  Promise.resolve(RENDER()[name]()).catch((e) => { if (!e.silent) toast(e.message, true); });
}
$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };

// ---------- COBRO ----------
async function renderVenta() {
  if (!state.shift) { toast('Abre tu turno para poder vender'); return showTab('turno'); }
  setSub(`Turno${state.shift.shift_name ? ' ' + state.shift.shift_name : ''} de ${state.shift.cashier} desde las ${state.shift.opened_at.slice(11, 16)}`);
  $('#ticketWho').textContent = state.shift.cashier;
  renderCart();
  api('/sales').then((s) => { $('#ticketNo').textContent = 'TICKET #' + ((s[0]?.id || 0) + 1); }).catch(() => {});
  await loadProducts();
  focusScan();
}
async function loadProducts(q = '') { state.products = await api('/products?q=' + encodeURIComponent(q)); renderCats(); renderGrid(); }
function renderCats() {
  const cats = ['Todos', ...new Set(state.products.map((p) => p.category).filter(Boolean))];
  if (!cats.includes(state.cat)) state.cat = 'Todos';
  const count = (c) => (c === 'Todos' ? state.products.length : state.products.filter((p) => p.category === c).length);
  $('#cats').innerHTML = cats.map((c) => `<button class="${c === state.cat ? 'on' : ''}" data-c="${esc(c)}"><b>${esc(c)}</b><small>${count(c)} productos</small></button>`).join('');
}
$('#cats').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.cat = b.dataset.c; renderCats(); renderGrid(); focusScan(); } };
function renderGrid() {
  const list = state.products.filter((p) => state.cat === 'Todos' || p.category === state.cat);
  $('#results').innerHTML = list.map((p) => `
    <button class="prod" data-id="${p.id}">
      ${thumb(p)}<span class="dot ${p.level}" title="Existencias: ${qtyFmt(p.stock)} ${UNIT[p.unit]}"></span>
      <span class="pn">${esc(p.name)}</span>
      <span class="pf"><span class="price">${money(p.price)}${p.unit === 'pieza' ? '' : `<small class="muted"> /${UNIT[p.unit]}</small>`}</span><span class="pill" style="${tint(p.category)}">${esc(p.category || 'General')}</span></span>
    </button>`).join('') || '<p class="muted">Sin resultados. Agrega productos en Catálogo.</p>';
}
$('#results').onclick = (e) => { const b = e.target.closest('.prod'); if (b) pickProduct(state.products.find((p) => p.id == b.dataset.id)); };

function pickProduct(p) {
  if (p.unit === 'pieza') { addToCart(p); return focusScan(); }
  openDialog(`<h2>${esc(p.name)}</h2><p>${money(p.price)} por ${UNIT[p.unit]}</p>
    <form id="kgForm" class="form"><label>Cantidad (${UNIT[p.unit]})<input name="q" type="number" step="0.001" min="0.001" value="1" required autofocus></label>
    <div class="bigline"><span>Importe</span><b id="kgTotal">${money(p.price)}</b></div><button class="primary big">Agregar al ticket</button></form>`);
  const f = $('#kgForm', dlg), upd = () => { $('#kgTotal', dlg).textContent = money(p.price * f.q.value); };
  f.q.oninput = upd; f.q.select();
  f.onsubmit = (e) => { e.preventDefault(); addToCart(p, Number(f.q.value)); closeDialog(); };
}

let searchTimer;
$('#scan').addEventListener('input', (e) => {
  if (state.tab !== 'venta') return;
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => { if (q.length !== 1) loadProducts(q).catch(() => {}); }, 200);
});
$('#scan').addEventListener('keydown', guard(async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) return;
  e.target.value = ''; clearTimeout(searchTimer);
  if (!state.shift) { showTab('turno'); return toast('Abre un turno para vender', true); }
  if (state.tab !== 'venta') showTab('venta');
  try { pickProduct(await api('/products/barcode/' + encodeURIComponent(q))); }
  catch (err) {
    if (err.silent) return;
    const list = await api('/products?q=' + encodeURIComponent(q));
    if (list.length === 1) pickProduct(list[0]);
    else { state.products = list; state.cat = 'Todos'; renderCats(); renderGrid(); toast(list.length ? 'Elige un producto' : `No existe "${q}"`, !list.length, list.length || !can('productos') ? undefined : { label: 'Crear producto con este código', fn: () => productForm(null, q) }); }
  }
}));

function addToCart(p, qty = 1) {
  const line = state.cart.find((l) => l.p.id === p.id);
  if (line) line.qty = qtyFmt(line.qty + qty); else state.cart.push({ p, qty });
  renderCart();
}
const cartGross = () => r2(state.cart.reduce((s, l) => s + l.p.price * l.qty, 0));
const discountAmount = (gross) => { const d = state.discount; if (!d) return 0; return d.type === 'pct' ? r2(gross * d.value / 100) : Math.min(r2(d.value), gross); };
const cartTotal = () => { const g = cartGross(); return r2(g - discountAmount(g)); };
function cartTax() { const g = cartGross(), f = g ? cartTotal() / g : 0; return r2(state.cart.reduce((s, l) => { const paid = l.p.price * l.qty * f; return s + (paid - paid / (1 + (l.p.tax_rate ?? 16) / 100)); }, 0)); }

function renderCart() {
  $('#cart').innerHTML = state.cart.length ? state.cart.map((l, i) => `
    <div class="line">
      <div>${esc(l.p.name)}<br><small class="muted">${money(l.p.price)} / ${UNIT[l.p.unit]}</small></div>
      <div><b>${money(l.p.price * l.qty)}</b> <button class="ghost danger" data-a="del" data-i="${i}" aria-label="Quitar">Quitar</button></div>
      <div class="qty">${l.p.unit === 'pieza'
        ? `<button data-a="dec" data-i="${i}" aria-label="Menos">−</button><b>${l.qty}</b><button data-a="inc" data-i="${i}" aria-label="Más">+</button>`
        : `<input type="number" step="0.001" min="0.001" value="${l.qty}" data-a="set" data-i="${i}" aria-label="Cantidad"> ${UNIT[l.p.unit]}`}</div>
    </div>`).join('') : '<div class="empty">Escanea o toca un producto</div>';
  const g = cartGross(), d = discountAmount(g);
  $('#sums').innerHTML = state.cart.length ? `<div class="srow"><span>Subtotal</span><span>${money(g)}</span></div>${d ? `<div class="srow disc"><span>Descuento (${esc(state.discount.reason)})</span><span>−${money(d)}</span></div>` : ''}<div class="srow muted"><span>IVA incluido</span><span>${money(cartTax())}</span></div>` : '';
  $('#total').textContent = money(cartTotal());
  $('#payBtn').textContent = state.cart.length ? `Cobrar ${money(cartTotal())}` : 'Cobrar (F9)';
  $('#count').textContent = qtyFmt(state.cart.reduce((s, l) => s + (l.p.unit === 'pieza' ? l.qty : 1), 0));
  $('#discBtn').textContent = state.discount ? 'Quitar descuento' : 'Descuento';
}
$('#cart').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const l = state.cart[b.dataset.i];
  if (b.dataset.a === 'inc') l.qty++;
  if (b.dataset.a === 'dec') l.qty = Math.max(1, l.qty - 1);
  if (b.dataset.a === 'del') state.cart.splice(b.dataset.i, 1);
  renderCart(); focusScan();
};
$('#cart').onchange = (e) => { if (e.target.dataset.a !== 'set') return; const v = Number(e.target.value); if (v > 0) state.cart[e.target.dataset.i].qty = v; renderCart(); };
$('#clearBtn').onclick = () => { state.cart = []; state.discount = null; renderCart(); focusScan(); };
$('#payBtn').onclick = () => openPayment('efectivo');
$('.payquick').onclick = (e) => { const b = e.target.closest('button'); if (b) openPayment(b.dataset.m); };
document.addEventListener('keydown', (e) => { if (e.key === 'F9' && state.tab === 'venta' && !dlg.open && state.user) { e.preventDefault(); openPayment('efectivo'); } });

$('#discBtn').onclick = () => {
  if (state.discount) { state.discount = null; renderCart(); return; }
  if (!state.cart.length) return toast('Agrega productos primero', true);
  openDialog(`<h2>Descuento</h2><form id="dForm" class="form">
    <div class="row"><select name="type"><option value="pct">Porcentaje (%)</option><option value="amount">Monto ($)</option></select><input name="value" type="number" step="0.01" min="0.01" placeholder="Valor" required autofocus></div>
    <input name="reason" placeholder="Motivo (obligatorio)" required>
    ${can('descuentos') ? '' : '<p class="muted">Al cobrar se pedirá el PIN del dueño (o de quien tenga este permiso).</p>'}
    <div class="row"><button type="button" class="ghost" id="dCancel">Cancelar</button><button class="primary grow">Aplicar</button></div></form>`);
  $('#dCancel', dlg).onclick = closeDialog;
  $('#dForm', dlg).onsubmit = (e) => { e.preventDefault(); const f = e.target; state.discount = { type: f.type.value, value: Number(f.value.value), reason: f.reason.value.trim() }; closeDialog(); renderCart(); };
};

async function openPayment(method = 'efectivo') {
  if (!state.shift) return showTab('turno');
  if (!state.cart.length) return toast('El ticket está vacío', true);
  // ¿Cambió algún precio mientras el producto estaba en el ticket?
  const fresh = new Map((await api('/products?all=1')).map((p) => [p.id, p]));
  const notes = [];
  state.cart = state.cart.filter((l) => {
    const f = fresh.get(l.p.id);
    if (!f || !f.active) { notes.push(`${l.p.name} ya no está disponible`); return false; }
    if (f.price !== l.p.price) { notes.push(`${l.p.name}: de ${money(l.p.price)} a ${money(f.price)}`); l.p = { ...l.p, ...f }; }
    return true;
  });
  if (notes.length) { renderCart(); return toast('Cambió el precio: ' + notes.join('; ') + '. Revisa el ticket y vuelve a cobrar.', true); }
  const total = cartTotal();
  const mbtn = (m, label) => `<button data-m="${m}" class="${m === method ? 'on' : ''}">${label}</button>`;
  openDialog(`<h2>Cobrar</h2><div class="bigline"><span>Total</span><b>${money(total)}</b></div>
    <div class="methods" id="methods">${mbtn('efectivo', 'Efectivo')}${mbtn('tarjeta', 'Tarjeta')}${mbtn('transferencia', 'Transferencia')}</div>
    <div id="cashBox" class="form ${method === 'efectivo' ? '' : 'hidden'}" style="margin-top:12px">
      <label>Efectivo recibido<input id="recv" type="number" step="0.01" min="0" value="${total}"></label>
      <div class="quick"><button data-q="${total}">Exacto</button>${[50, 100, 200, 500, 1000].filter((v) => v >= total).slice(0, 4).map((v) => `<button data-q="${v}">${money(v)}</button>`).join('')}</div>
      <div class="bigline"><span>Cambio</span><b id="change">${money(0)}</b></div></div>
    <div class="row" style="margin-top:14px"><button id="cancelPay" class="ghost">Cancelar</button><button id="confirmPay" class="primary big">Confirmar</button></div>`);
  const recv = $('#recv', dlg);
  const upd = () => { $('#change', dlg).textContent = money(Math.max(0, recv.value - total)); };
  recv.oninput = upd; if (method === 'efectivo') recv.select();
  $('#methods', dlg).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; method = b.dataset.m; $$('#methods button', dlg).forEach((x) => x.classList.toggle('on', x === b)); $('#cashBox', dlg).classList.toggle('hidden', method !== 'efectivo'); };
  $('#cashBox', dlg).onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) { recv.value = b.dataset.q; upd(); } };
  $('#cancelPay', dlg).onclick = closeDialog;
  const confirmPay = guard(async () => {
    const sale = await api('/sales', { body: { method, cash_received: method === 'efectivo' ? Number(recv.value) : undefined, discount: state.discount || undefined, items: state.cart.map((l) => ({ product_id: l.p.id, qty: l.qty })) } });
    state.cart = []; state.discount = null; renderCart(); loadProducts(); refreshAlertCount();
    $('#ticketNo').textContent = 'TICKET #' + (sale.id + 1);
    showTicket(sale);
  });
  $('#confirmPay', dlg).onclick = confirmPay;
  dlg.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); confirmPay(); } };
}

function ticketHtml(s) {
  return `<div class="ticket"><div class="c"><b>${esc(s.business)}</b><br>Ticket #${s.id}<br>${esc(s.created_at)}<br>Cajero: ${esc(s.cashier)}</div><hr>
    ${s.items.map((i) => `<div>${esc(i.name)}</div><div class="r"><span>${qtyFmt(i.qty)} x ${money(i.price)}</span><span>${money(i.qty * i.price)}</span></div>`).join('')}
    <hr>${s.discount ? `<div class="r"><span>Descuento</span><span>−${money(s.discount)}</span></div>` : ''}
    <div class="r"><span>Subtotal sin IVA</span><span>${money(s.subtotal)}</span></div><div class="r"><span>IVA</span><span>${money(s.tax)}</span></div>
    <div class="r"><b>TOTAL</b><b>${money(s.total)}</b></div><div class="r"><span>Pago: ${esc(s.method)}</span><span></span></div>
    ${s.method === 'efectivo' ? `<div class="r"><span>Recibido</span><span>${money(s.cash_received)}</span></div><div class="r"><span>Cambio</span><span>${money(s.change_given)}</span></div>` : ''}
    <hr><div class="c">¡Gracias por su compra!</div></div>`;
}
function showTicket(s) {
  $('#ticketPrint').innerHTML = ticketHtml(s);
  openDialog(`<h2>Venta registrada</h2>${s.method === 'efectivo' ? `<div class="bigline"><span>Cambio</span><b>${money(s.change_given)}</b></div>` : ''}<div class="bigline"><span>Total</span><b>${money(s.total)}</b></div>
    <div class="row" style="margin-top:14px"><button id="printBtn">Imprimir ticket</button><button id="doneBtn" class="primary big">Nueva venta</button></div>`);
  $('#printBtn', dlg).onclick = () => { document.body.classList.remove('print-report'); window.print(); };
  $('#doneBtn', dlg).onclick = closeDialog;
  $('#doneBtn', dlg).focus();
}

// Devoluciones
$('#retBtn').onclick = () => {
  openDialog(`<h2>Devolución</h2><form id="rSearch" class="row"><input name="id" type="number" min="1" placeholder="Número de ticket" required autofocus><button class="primary">Buscar</button></form><div id="rBody"></div><button id="rClose" class="ghost" style="width:100%;margin-top:8px">Cerrar</button>`);
  $('#rClose', dlg).onclick = closeDialog;
  $('#rSearch', dlg).onsubmit = guard(async (e) => {
    e.preventDefault();
    const s = await api('/sales/' + e.target.id.value);
    const items = s.items.filter((i) => i.qty - i.returned > 0);
    $('#rBody', dlg).innerHTML = items.length ? `<p class="muted">Ticket #${s.id} · ${esc(s.created_at)} · ${money(s.total)} · ${esc(s.method)}</p>
      <form id="rForm" class="form">${items.map((i) => `<label class="rline"><span>${esc(i.name)} <small class="muted">(hasta ${qtyFmt(i.qty - i.returned)})</small></span><input type="number" step="any" min="0" max="${qtyFmt(i.qty - i.returned)}" value="0" data-item="${i.id}"></label>`).join('')}
      <select name="method">${['efectivo', 'tarjeta', 'transferencia'].map((m) => `<option ${m === s.method ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input name="reason" placeholder="Motivo (obligatorio)" required>${can('devoluciones') ? '' : '<p class="muted">Se pedirá el PIN del dueño (o de quien tenga este permiso).</p>'}
      <button class="primary big">Registrar devolución</button></form>` : '<p class="muted">Ese ticket no tiene artículos por devolver.</p>';
    const rf = $('#rForm', dlg);
    if (rf) rf.onsubmit = guard(async (ev) => {
      ev.preventDefault();
      const picked = $$('[data-item]', rf).map((i) => ({ sale_item_id: Number(i.dataset.item), qty: Number(i.value) })).filter((i) => i.qty > 0);
      if (!picked.length) return toast('Indica qué cantidad se devuelve', true);
      const r = await api('/returns', { body: { sale_id: s.id, items: picked, method: rf.method.value, reason: rf.reason.value } });
      closeDialog(); toast(`Devolución registrada: ${money(r.total)} (${r.method}). Autorizó ${r.authorized_by}.`); loadProducts(); refreshAlertCount();
    });
  });
};

// ---------- CATÁLOGO ----------
async function renderInventario() {
  const prods = await api('/products?all=1&q=' + encodeURIComponent($('#invSearch').value));
  state.inv = prods; setSub(`${prods.length} productos`);
  const sem = { ok: 'Ok', aviso: 'Bajo', critico: 'Escasez' };
  const edit = can('productos'), seeCost = prods[0] && prods[0].cost !== undefined;
  $('#prodTable').innerHTML = `<thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Unidad</th>${seeCost ? '<th class="n">Costo</th>' : ''}<th class="n">Precio</th><th>IVA</th><th class="n">Stock</th><th>Estado</th><th>Caduca</th><th></th></tr></thead><tbody>` +
    prods.map((p) => `<tr style="${p.active ? '' : 'opacity:.5'}"><td>${esc(p.name)}</td><td>${esc(p.barcode || '')}</td><td>${esc(p.category)}</td><td>${UNIT[p.unit]}</td>${seeCost ? `<td class="n">${money(p.cost)}</td>` : ''}<td class="n">${money(p.price)}</td><td>${p.tax_rate}%</td><td class="n">${qtyFmt(p.stock)}</td>
      <td><span class="tag ${p.level}">${sem[p.level]}</span></td><td>${esc(p.expires_at || '—')}</td><td>${edit ? `<button data-id="${p.id}">Editar</button>` : ''}</td></tr>`).join('') + '</tbody>';
}
let invTimer;
$('#invSearch').oninput = () => { clearTimeout(invTimer); invTimer = setTimeout(() => renderInventario().catch(() => {}), 250); };
$('#prodTable').onclick = (e) => { const b = e.target.closest('button'); if (b) productForm(state.inv.find((p) => p.id == b.dataset.id)); };
$('#newProd').onclick = () => productForm(null);

function productForm(p, code = '') {
  const cats = state.giros[state.settings.giro]?.categories || [];
  openDialog(`<h2>${p ? 'Editar' : 'Nuevo'} producto</h2>
    <form id="pForm" class="form">
      <label>Código de barras<input name="barcode" value="${esc(p?.barcode ?? code)}" placeholder="Escanéalo aquí" ${p || code ? '' : 'autofocus'}></label>
      <label>Nombre<input name="name" required value="${esc(p?.name)}"></label>
      <div class="row"><label class="grow">Categoría<input name="category" list="cats" value="${esc(p?.category)}"><datalist id="cats">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</datalist></label>
      <label>Unidad<select name="unit">${Object.keys(UNIT).map((u) => `<option value="${u}" ${p?.unit === u ? 'selected' : ''}>${u === 'pieza' ? 'Pieza' : UNIT[u]}</option>`).join('')}</select></label></div>
      <div class="row"><label class="grow">Costo (sin IVA)<input name="cost" type="number" step="0.01" min="0" required value="${p?.cost ?? 0}"></label>
      <label class="grow">Precio público (con IVA)<input name="price" type="number" step="0.01" min="0" required value="${p?.price ?? 0}"></label>
      <label>IVA<select name="tax_rate"><option value="16" ${(p?.tax_rate ?? 16) == 16 ? 'selected' : ''}>16 %</option><option value="0" ${p && p.tax_rate == 0 ? 'selected' : ''}>0 % / exento</option></select></label></div>
      <div id="margin" class="margin"></div>
      <div class="row"><label class="grow">Stock mín.<input name="min_stock" type="number" step="any" min="0" value="${p?.min_stock ?? 0}"></label>
      <label class="grow">Stock máx.<input name="max_stock" type="number" step="any" min="0" value="${p?.max_stock ?? 0}"></label>
      ${p ? '' : '<label class="grow">Stock inicial<input name="stock" type="number" step="any" min="0" value="0"></label>'}</div>
      <div class="row"><label class="grow">Caducidad (opcional)<input name="expires_at" type="date" value="${esc(p?.expires_at || '')}"></label>
      <div class="imgpick grow"><span class="thumb" id="imgPrev" style="${tint(p?.category)}">${p?.image ? `<img src="${esc(p.image)}" alt="">` : esc(initials(p?.name || 'Foto'))}</span><div class="form"><label>Foto del producto<input type="file" id="imgFile" accept="image/*"></label><input name="image" type="hidden" value="${esc(p?.image)}"><button type="button" id="imgClear" class="ghost">Quitar foto</button></div></div></div>
      ${p ? `<p class="muted">Stock actual: ${qtyFmt(p.stock)}. Cámbialo con entradas/salidas de almacén. ${p.active ? '' : 'Este producto está dado de baja.'}</p>
      <div class="row"><button type="button" id="histP" class="ghost">Historial de precios</button><button type="button" id="bajaP" class="${p.active ? 'danger' : ''}">${p.active ? 'Dar de baja' : 'Reactivar'}</button></div>` : ''}
      <div class="row"><button type="button" id="cancelP" class="ghost">Cancelar</button><button class="primary big grow">Guardar</button></div>
    </form>`);
  const f = $('#pForm', dlg);
  const marginUpd = () => {
    const price = Number(f.price.value), cost = Number(f.cost.value), net = price / (1 + Number(f.tax_rate.value) / 100);
    const m = net ? ((net - cost) / net) * 100 : 0;
    $('#margin', dlg).innerHTML = price > 0 ? `Margen: <b>${m.toFixed(1)}%</b> (${money(net - cost)} por unidad, sin IVA)${price < cost ? ' <span class="down">El precio está por debajo del costo</span>' : ''}` : '';
  };
  ['price', 'cost', 'tax_rate'].forEach((k) => f[k].addEventListener('input', marginUpd)); marginUpd();
  $('#cancelP', dlg).onclick = closeDialog;
  $('#imgFile', dlg).onchange = (e) => {
    const fl = e.target.files[0]; if (!fl) return;
    const img = new Image(), url = URL.createObjectURL(fl);
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.82);
      f.image.value = data; $('#imgPrev', dlg).innerHTML = `<img src="${data}" alt="">`; URL.revokeObjectURL(url);
    };
    img.onerror = () => toast('No se pudo leer esa imagen', true);
    img.src = url;
  };
  $('#imgClear', dlg).onclick = () => { f.image.value = ''; $('#imgPrev', dlg).textContent = initials(f.name.value || 'Foto'); };
  f.barcode.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f.name.focus(); } });   // el Enter del lector no envía el formulario
  const baja = $('#bajaP', dlg);
  if (baja) baja.onclick = guard(async () => {
    if (p.active && !confirm(`¿Dar de baja "${p.name}"? Dejará de aparecer en caja y en alertas; el historial se conserva y puedes reactivarlo.`)) return;
    await api('/products/' + p.id, { method: 'PUT', body: { active: !p.active } });
    closeDialog(); toast(p.active ? 'Producto dado de baja' : 'Producto reactivado'); renderInventario(); refreshAlertCount();
  });
  const hist = $('#histP', dlg);
  if (hist) hist.onclick = guard(async () => {
    const h = await api(`/products/${p.id}/history`);
    openDialog(`<h2>Historial · ${esc(p.name)}</h2><div class="tablewrap"><table><thead><tr><th>Fecha</th><th class="n">Precio</th><th class="n">Costo</th><th>Quién</th><th>Origen</th></tr></thead><tbody>${
      h.map((x) => `<tr><td>${esc(x.created_at)}</td><td class="n">${money(x.old_price)} → ${money(x.new_price)}</td><td class="n">${money(x.old_cost)} → ${money(x.new_cost)}</td><td>${esc(x.changed_by)}</td><td>${esc(x.source)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin cambios registrados</td></tr>'}</tbody></table></div><button id="hClose" class="primary big" style="margin-top:12px">Cerrar</button>`);
    $('#hClose', dlg).onclick = closeDialog;
  });
  f.onsubmit = guard(async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    if (p && Number(body.price) !== p.price && !confirm(`Cambiar el precio de ${money(p.price)} a ${money(Number(body.price))}. ¿Confirmas?`)) return;
    await api(p ? '/products/' + p.id : '/products', { method: p ? 'PUT' : 'POST', body });
    closeDialog(); toast('Producto guardado'); renderInventario(); refreshAlertCount(); if (state.tab === 'venta') loadProducts();
  });
}

$('#stockForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const p = await api('/stock', { body: { barcode: f.barcode, type: f.type, qty: Number(f.qty), note: f.note, cost: f.cost === '' ? undefined : Number(f.cost) } });
  $('#stockMsg').textContent = `${p.name}: stock ahora ${qtyFmt(p.stock)}`;
  e.target.qty.value = ''; e.target.barcode.value = ''; e.target.cost.value = ''; e.target.barcode.focus();
  renderInventario(); refreshAlertCount();
});

// Importar CSV
$('#importBtn').onclick = () => {
  openDialog(`<h2>Importar catálogo (CSV)</h2><p class="muted">Columnas: código, nombre, precio, costo, stock, categoría, unidad, iva. Si el código ya existe se actualiza precio y costo, y el stock se suma solo si trae esa columna.</p>
    <input type="file" id="csvFile" accept=".csv,text/csv,text/plain"><div id="impBody"></div><button id="impClose" class="ghost" style="width:100%;margin-top:8px">Cerrar</button>`, 'wide');
  $('#impClose', dlg).onclick = closeDialog;
  $('#csvFile', dlg).onchange = guard(async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const csv = await file.text();
    const plan = await api('/import/preview', { body: { csv } });
    const s = plan.summary;
    $('#impBody', dlg).innerHTML = `<p><b>${s.nuevo}</b> nuevos · <b>${s.actualizar}</b> a actualizar · ${s.sin_cambios} sin cambios · <b class="${s.error ? 'down' : ''}">${s.error}</b> con error${s.cambios_grandes ? ` · <b class="down">${s.cambios_grandes} cambios de precio mayores a 30 %</b>` : ''}</p>
      <div class="tablewrap short"><table><thead><tr><th>Fila</th><th>Producto</th><th>Acción</th><th class="n">Precio anterior</th><th class="n">Precio nuevo</th><th class="n">Cambio</th></tr></thead><tbody>${plan.rows.map((r) => `<tr class="${r.big ? 'bigchg' : ''}"><td>${r.line}</td><td>${esc(r.name || '(sin nombre)')}</td><td>${r.action}${r.errors.length ? ` <span class="down">${esc(r.errors.join(', '))}</span>` : ''}</td><td class="n">${r.old_price === undefined ? '—' : money(r.old_price)}</td><td class="n">${r.price === undefined ? '—' : money(r.price)}</td><td class="n">${r.pct === null ? '—' : (r.pct > 0 ? '+' : '') + r.pct + '%'}</td></tr>`).join('')}</tbody></table></div>
      <button id="impGo" class="primary big" style="margin-top:12px" ${s.nuevo + s.actualizar ? '' : 'disabled'}>Confirmar importación (pide PIN del dueño)</button>`;
    const go = $('#impGo', dlg);
    if (go) go.onclick = guard(async () => {
      const pin = await askPin('PIN del dueño para confirmar la importación');
      if (!pin) return;
      const r = await api('/import/apply', { body: { csv, auth_pin: pin } });
      closeDialog(); toast(`Importación lista: ${r.created} nuevos, ${r.updated} actualizados`); renderInventario(); refreshAlertCount();
    });
  });
};

// ---------- TURNOS ----------
function guessShiftDef() {
  if (state.user.shift_def_id) return state.user.shift_def_id;
  const now = new Date().getHours() * 60 + new Date().getMinutes(), mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hit = state.shift_defs.find((d) => { const a = mins(d.start), b = mins(d.end); return a < b ? now >= a && now < b : now >= a || now < b; });
  return (hit || state.shift_defs[0])?.id;
}
async function verifyOwnPin(message) {
  const pin = await askPin(message);
  if (!pin) return false;
  const r = await api('/auth/login', { body: { employee_id: state.user.id, pin }, noAuthRedirect: true, noPin: true });
  setToken(r.token);
  return true;
}
async function renderTurno() {
  const body = $('#turnoBody');
  if (!state.shift) return renderOpenShift(body);
  const cur = await api('/shift/current');
  const s = cur.shift;
  body.innerHTML = `
    <div class="cols" style="margin-top:0">
      <div class="card"><h3 style="margin-top:0">Turno #${s.id}${s.shift_name ? ' · ' + esc(s.shift_name) : ''} · ${esc(s.cashier)}</h3>
        <p class="muted">Abierto: ${esc(s.opened_at)}${cur.handover_from ? ` · recibió de ${esc(cur.handover_from.cashier)}` : ''}${s.handover_diff ? ` · diferencia en el relevo: ${money(s.handover_diff)}` : ''}</p>
        <table><tr><td>Saldo inicial</td><td class="n">${money(s.opening_float)}</td></tr>
        <tr><td>Ventas efectivo (neto de devoluciones)</td><td class="n">${money(cur.by_method.efectivo)}</td></tr>
        <tr><td>Ventas tarjeta</td><td class="n">${money(cur.by_method.tarjeta)}</td></tr>
        <tr><td>Transferencias</td><td class="n">${money(cur.by_method.transferencia)}</td></tr>
        <tr><td>Depósitos de efectivo</td><td class="n">${money(cur.cash_in)}</td></tr>
        <tr><td>Retiros de efectivo</td><td class="n">${money(cur.cash_out)}</td></tr>
        <tr><td>Devoluciones del turno</td><td class="n">${money(cur.refunds)}</td></tr>
        <tr><td>Tickets</td><td class="n">${cur.tickets}</td></tr></table>
        <p class="muted">El efectivo esperado se oculta (corte ciego) hasta que cuentes y cierres.</p></div>
      <div class="card">${cur.mine ? `<h3 style="margin-top:0">Entrada / salida de efectivo</h3>
        <form id="cashForm" class="form"><select name="type"><option value="out">Retiro (proveedor, resguardo)</option><option value="in">Depósito menor</option></select>
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="Monto" required><input name="note" placeholder="Justificación" required><button class="primary">Registrar</button></form>` : `<p>Este turno es de <b>${esc(s.cashier)}</b>.</p>`}
        ${cur.can_close ? `<h3>Cierre de turno (corte ciego)</h3><form id="closeForm" class="form"><input name="counted_cash" type="number" step="0.01" min="0" placeholder="Efectivo contado en caja" required><button class="primary">Cerrar turno</button></form>` : ''}</div>
    </div><div id="hist"></div>`;
  const cf = $('#cashForm');
  if (cf) cf.onsubmit = guard(async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api('/shift/cash', { body: { type: f.type, amount: Number(f.amount), note: f.note } }); toast('Movimiento registrado'); renderTurno(); });
  const cl = $('#closeForm');
  if (cl) cl.onsubmit = guard(async (e) => {
    e.preventDefault();
    if (state.cart.length && !confirm('Hay una venta sin cobrar en el ticket; se descartará. ¿Cerrar turno?')) return;
    const r = await api('/shift/close', { body: { counted_cash: Number(new FormData(e.target).get('counted_cash')) } });
    state.cart = []; state.discount = null;
    const d = r.difference, m = r.by_method;
    openDialog(`<h2>Arqueo del turno</h2>
      <div class="bigline"><span>Efectivo esperado</span><b>${money(r.expected_cash)}</b></div><div class="bigline"><span>Efectivo contado</span><b>${money(r.counted_cash)}</b></div>
      <div class="bigline"><span>Diferencia</span><b class="${d === 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${money(d)} ${d === 0 ? '(cuadra)' : d > 0 ? '(sobrante)' : '(faltante)'}</b></div>
      <p class="muted">${r.tickets} tickets: efectivo ${money(m.efectivo)} · tarjeta ${money(m.tarjeta)} · transferencia ${money(m.transferencia)} · devoluciones ${money(r.refunds)}</p>
      <p class="muted">Entrega ${money(r.counted_cash)} al siguiente turno; quien llegue confirmará con su PIN. ${r.backup_file ? 'Copia de seguridad guardada.' : 'No se pudo guardar la copia: ' + esc(r.backup_error || '')}</p>
      <button id="okClose" class="primary big" style="margin-top:8px">Entregar caja y salir</button>`);
    $('#okClose', dlg).onclick = () => { dlg.close(); $('#logoutBtn').click(); };
  });
  if (can('reportes')) renderShiftHistory($('#hist'));
}

async function renderOpenShift(body) {
  const enabled = state.settings.shifts_enabled === '1';
  const ho = (await api('/shift/handover')).previous;
  const def = guessShiftDef();
  setSub('Abre tu turno para empezar a vender');
  body.innerHTML = `<div class="card narrow"><h3 style="margin-top:0">Abrir turno</h3><div class="form">
    ${enabled ? `<label>Turno<select id="defSel">${state.shift_defs.map((d) => `<option value="${d.id}" ${d.id === def ? 'selected' : ''}>${esc(d.name)} (${d.start}–${d.end})</option>`).join('')}</select></label>` : ''}
    ${ho ? `<div class="handover"><p>Recibes la caja de <b>${esc(ho.cashier)}</b>, que contó y entregó:</p><div class="bigline"><span>Efectivo entregado</span><b>${money(ho.counted_cash)}</b></div>
        <button id="confirmHo" class="primary big">Confirmo con mi PIN y abro turno</button><button id="recount" class="ghost">No coincide: recontar juntos</button></div>`
      : `<label>Saldo inicial en caja<input id="floatIn" type="number" step="0.01" min="0" value="0"></label><button id="openFirst" class="primary big">Abrir turno</button>`}
    </div></div>`;
  const chosen = () => (enabled ? Number($('#defSel').value) : undefined);
  const open = guard(async (extra) => {
    await api('/shift/open', { body: { shift_def_id: chosen(), ...extra } });
    await refreshState(); showTab('venta');
  });
  $('#confirmHo')?.addEventListener('click', guard(async () => { if (await verifyOwnPin('Confirma que recibes la caja con tu PIN')) await open({}); }));
  $('#openFirst')?.addEventListener('click', () => open({ opening_float: Number($('#floatIn').value) }));
  $('#recount')?.addEventListener('click', () => {
    openDialog(`<h2>Recuento conjunto</h2><p class="muted">Cuenten el efectivo juntos y escribe lo que hay realmente. Después ${esc(ho.cashier)} confirma con su PIN.</p>
      <form id="rcForm" class="form"><input name="amount" type="number" step="0.01" min="0" placeholder="Efectivo recontado" required autofocus><button class="primary big">Continuar</button></form>`);
    $('#rcForm', dlg).onsubmit = guard(async (e) => {
      e.preventDefault();
      const amount = Number(e.target.amount.value); closeDialog();
      const pin = await askPin(`PIN de ${ho.cashier} para confirmar el recuento (${money(amount)})`);
      if (!pin) return;
      await open({ opening_float: amount, outgoing_pin: pin });
    });
  });
}

async function renderShiftHistory(el) {
  const list = (await api('/shifts')).filter((s) => s.status === 'closed');
  el.insertAdjacentHTML('beforeend', `<h3>Cortes anteriores</h3><div class="tablewrap"><table><thead><tr><th>#</th><th>Turno</th><th>Cajero</th><th>Apertura</th><th>Cierre</th><th class="n">Esperado</th><th class="n">Contado</th><th class="n">Diferencia</th><th class="n">Dif. relevo</th></tr></thead><tbody>${
    list.map((s) => `<tr><td>${s.id}</td><td>${esc(s.shift_name || '—')}</td><td>${esc(s.cashier)}</td><td>${esc(s.opened_at)}</td><td>${esc(s.closed_at)}</td><td class="n">${money(s.expected_cash)}</td><td class="n">${money(s.counted_cash)}</td>
      <td class="n ${s.difference === 0 ? 'up' : 'down'}">${money(s.difference)}</td><td class="n ${s.handover_diff ? 'down' : ''}">${s.handover_diff == null ? '—' : money(s.handover_diff)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Sin cortes aún</td></tr>'}</tbody></table></div>`);
}

// ---------- ALERTAS ----------
async function renderAlertas() {
  const [alerts, exp, prods] = await Promise.all([api('/alerts'), api('/expiry'), api('/products')]);
  const ok = prods.filter((p) => p.level === 'ok').length;
  const red = alerts.filter((a) => a.level === 'critico'), yel = alerts.filter((a) => a.level === 'aviso');
  setSub(red.length || exp.length ? `${red.length} por agotarse y ${exp.length} por caducar${red[0] ? '. Lo más urgente: ' + red[0].name : ''}` : 'Todo el inventario está en orden');
  const act = can('productos');
  const card = (a) => `<div class="alert ${a.level}"><div><b>${esc(a.name)}</b><br><span class="muted">${esc(a.reason)}.${a.suggested ? ` Pedir ~${a.suggested}.` : ''}</span></div>${act ? `<button data-act="entrada" data-code="${esc(a.barcode || '')}" data-qty="${a.suggested || ''}">Registrar entrada</button>` : ''}</div>`;
  const expCard = (e) => `<div class="alert exp"><div><b>${esc(e.name)}</b><br><span class="muted">${e.days_left <= 0 ? 'Vencido' : `Caduca en ${e.days_left} día(s)`} (${esc(e.expires_at)}) · ${qtyFmt(e.stock)} en stock · sugerido ${e.suggest_discount}% de descuento</span></div>${act ? `<button data-act="merma" data-code="${esc(e.barcode || '')}" data-qty="${e.stock}">Registrar merma</button>` : ''}</div>`;
  $('#alertBody').innerHTML = `
    <div class="kpis"><div class="kpi"><div class="l">En orden</div><div class="v">${ok}</div></div><div class="kpi"><div class="l">Stock bajo</div><div class="v">${yel.length}</div></div>
      <div class="kpi"><div class="l">Escasez inminente</div><div class="v">${red.length}</div></div><div class="kpi"><div class="l">Por caducar en 7 días</div><div class="v">${exp.length}</div></div></div>
    <div class="cols"><div><h3>Escasez inminente</h3><div class="alerts">${red.map(card).join('') || '<p class="muted">Nada crítico</p>'}</div><h3>Stock bajo</h3><div class="alerts">${yel.map(card).join('') || '<p class="muted">Sin avisos</p>'}</div></div>
      <div><h3>Próximos a caducar</h3><div class="alerts">${exp.map(expCard).join('') || '<p class="muted">Nada por caducar</p>'}</div></div></div>`;
}
$('#alertBody').onclick = (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  showTab('inventario');
  const f = $('#stockForm');
  f.barcode.value = b.dataset.code; f.type.value = b.dataset.act; f.qty.value = b.dataset.qty || ''; f.note.value = b.dataset.act === 'merma' ? 'Caducidad' : 'Reabasto';
  (b.dataset.code ? f.qty : f.barcode).focus();
};

// ---------- REPORTES ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const rep = { preset: 'hoy', from: ymd(new Date()), to: ymd(new Date()), group: 'dia' };
function applyPreset(p) {
  const t = new Date(); rep.preset = p;
  if (p === 'hoy') rep.from = rep.to = ymd(t);
  if (p === 'ayer') rep.from = rep.to = ymd(addDays(t, -1));
  if (p === '7d') { rep.from = ymd(addDays(t, -6)); rep.to = ymd(t); }
  if (p === 'mes') { rep.from = ymd(new Date(t.getFullYear(), t.getMonth(), 1)); rep.to = ymd(t); }
}
function shiftPeriod(dir) {
  const f = new Date(rep.from + 'T00:00'), t = new Date(rep.to + 'T00:00');
  if (rep.preset === 'mes') { rep.from = ymd(new Date(f.getFullYear(), f.getMonth() + dir, 1)); rep.to = ymd(new Date(f.getFullYear(), f.getMonth() + dir + 1, 0)); }
  else { const span = Math.round((t - f) / 864e5) + 1; rep.from = ymd(addDays(f, dir * span)); rep.to = ymd(addDays(t, dir * span)); if (rep.preset !== 'rango') rep.preset = 'rango'; }
}
const GROUPS = { dia: 'Día', turno: 'Turno', cajero: 'Cajero', metodo: 'Método de pago', categoria: 'Categoría', producto: 'Producto' };
async function renderReportes() {
  const d = await api(`/report?from=${rep.from}&to=${rep.to}&group=${rep.group}`);
  const c = d.cascade, pr = (id, l) => `<button data-p="${id}" class="${rep.preset === id ? 'on' : ''}">${l}</button>`;
  setSub(rep.from === rep.to ? rep.from : `${rep.from} al ${rep.to}`);
  const cols = d.rows[0] ? Object.keys(d.rows[0]) : [];
  const LBL = { key: GROUPS[rep.group], tickets: 'Tickets', gross: 'Brutas', discounts: 'Descuentos', returns: 'Devoluciones', net: 'Netas', tax: 'IVA', qty: 'Cantidad', margin: 'Margen' };
  $('#repBody').innerHTML = `
    <div class="repctl"><div class="seg">${pr('hoy', 'Hoy')}${pr('ayer', 'Ayer')}${pr('7d', '7 días')}${pr('mes', 'Mes')}${pr('rango', 'Rango')}</div>
      <button id="prevP" aria-label="Periodo anterior">‹</button><input type="date" id="fromD" value="${rep.from}"><input type="date" id="toD" value="${rep.to}"><button id="nextP" aria-label="Periodo siguiente">›</button>
      <select id="groupSel">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}" ${k === rep.group ? 'selected' : ''}>Agrupar por ${v.toLowerCase()}</option>`).join('')}</select>
      <span class="grow"></span><button id="csvBtn">Exportar CSV</button><button id="printRep">Imprimir</button></div>
    <div class="kpis"><div class="kpi"><div class="l">Ventas brutas</div><div class="v">${money(c.gross)}</div></div><div class="kpi"><div class="l">− Descuentos</div><div class="v">${money(c.discounts)}</div></div>
      <div class="kpi"><div class="l">− Devoluciones (${c.returns_count})</div><div class="v">${money(c.returns)}</div></div><div class="kpi"><div class="l">= Ventas netas</div><div class="v lead">${money(c.net)}</div></div></div>
    <div class="cols"><div class="card"><table><tr><td>IVA incluido</td><td class="n">${money(c.tax)}</td></tr><tr><td>Ventas netas sin IVA</td><td class="n">${money(c.net_without_tax)}</td></tr><tr><td>Margen bruto (sin IVA)</td><td class="n">${money(c.margin)}</td></tr>
      <tr><td>Tickets · promedio</td><td class="n">${c.tickets} · ${money(c.avg_ticket)}</td></tr></table></div>
      <div class="card"><h3 style="margin-top:0">Por método de pago</h3><table>${d.by_method.map((m) => `<tr><td>${esc(m.k)}</td><td class="n">${m.tickets} tickets</td><td class="n">${money(m.total)}</td></tr>`).join('') || '<tr><td class="muted">Sin ventas</td></tr>'}</table></div></div>
    <h3>Detalle por ${GROUPS[rep.group].toLowerCase()}</h3>
    <div class="tablewrap"><table><thead><tr>${cols.map((k) => `<th class="${k === 'key' ? '' : 'n'}">${LBL[k] || k}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r) => `<tr>${cols.map((k) => `<td class="${k === 'key' ? '' : 'n'}">${k === 'key' ? esc(r[k]) : ['tickets', 'qty'].includes(k) ? qtyFmt(r[k]) : money(r[k])}</td>`).join('')}</tr>`).join('') || `<tr><td class="muted" colspan="${cols.length || 1}">No hay ventas en este periodo</td></tr>`}</tbody></table></div>`;
  $('.seg', $('#repBody')).onclick = (e) => { const b = e.target.closest('button'); if (b) { if (b.dataset.p !== 'rango') applyPreset(b.dataset.p); else rep.preset = 'rango'; renderReportes(); } };
  $('#fromD').onchange = (e) => { rep.from = e.target.value; rep.preset = 'rango'; if (rep.to < rep.from) rep.to = rep.from; renderReportes(); };
  $('#toD').onchange = (e) => { rep.to = e.target.value; rep.preset = 'rango'; if (rep.to < rep.from) rep.from = rep.to; renderReportes(); };
  $('#prevP').onclick = () => { shiftPeriod(-1); renderReportes(); };
  $('#nextP').onclick = () => { shiftPeriod(1); renderReportes(); };
  $('#groupSel').onchange = (e) => { rep.group = e.target.value; renderReportes(); };
  $('#printRep').onclick = () => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); };
  $('#csvBtn').onclick = guard(async () => {
    const res = await fetch(`/api/report?from=${rep.from}&to=${rep.to}&group=${rep.group}&format=csv`, { headers: { 'x-token': token } });
    if (!res.ok) throw new Error('No se pudo exportar');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `ventas-${rep.from}_${rep.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  });
}

// ---------- DASHBOARD ----------
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
async function renderDashboard() {
  const d = await api('/dashboard');
  const pct = (v) => v === null ? '<span class="muted">sin datos</span>' : `<span class="${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</span>`;
  const maxH = Math.max(1, ...d.heatmap.hourly.map((h) => h.tickets));
  const cells = {}; let maxC = 1;
  for (const c of d.heatmap.cells) { cells[c.dow + '-' + c.hour] = c.tickets; maxC = Math.max(maxC, c.tickets); }
  const lvl = (n) => (!n ? 0 : n / maxC > .66 ? 3 : n / maxC > .33 ? 2 : 1);
  const topList = (arr, key) => { const mx = Math.max(1, ...arr.map((x) => x[key])); return arr.map((x) => `<div class="hbar"><span title="${esc(x.name)}">${esc(x.name)}</span><span class="t"><i style="width:${(x[key] / mx) * 100}%"></i></span><span>${key === 'margin' ? money(x.margin) : qtyFmt(x.qty)}</span></div>`).join('') || '<p class="muted">Sin datos</p>'; };
  const urgent = d.alerts.find((a) => a.level === 'critico');
  const finding = urgent ? `${urgent.name}: ${urgent.reason}.` : d.expiring[0] ? `${d.expiring[0].name} caduca ${d.expiring[0].days_left <= 0 ? 'ya' : 'en ' + d.expiring[0].days_left + ' día(s)'}.` : '';
  $('#dashBody').innerHTML = `
    ${finding ? `<p class="finding"><b>Hallazgo de hoy:</b> ${esc(finding)} <a href="#" id="goAlerts">Ver alertas</a></p>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="l">Total cobrado hoy (neto de devoluciones)</div><div class="v lead">${money(d.today.total)}</div><div class="l">vs ayer ${pct(d.vs_yesterday)} · vs hace 7 días ${pct(d.vs_last_week)}</div></div>
      <div class="kpi"><div class="l">Ticket promedio</div><div class="v">${money(d.today.avg)}</div><div class="l">${d.today.tickets} tickets · ayer ${money(d.yesterday.avg)}</div></div>
      <div class="kpi"><div class="l">Margen bruto hoy (sin IVA)</div><div class="v">${money(d.today.margin)}</div><div class="l">${d.margin_pct}% de las ventas</div></div>
      <div class="kpi"><div class="l">Proyección ${d.prediction.days} días</div><div class="v">${money(d.prediction.estimate)}</div><div class="l">prom. diario ${money(d.prediction.avg_daily)}</div></div></div>
    <div class="cols">
      <div class="card"><h3 style="margin-top:0">Top 10 productos (30 días)</h3><div class="seg" id="topSeg"><button class="on" data-k="qty">Por volumen</button><button data-k="margin">Por utilidad</button></div><div id="topList">${topList(d.top_sellers, 'qty')}</div></div>
      <div class="card"><h3 style="margin-top:0">Productos fantasma</h3><p class="muted">Sin ventas en 30 días · capital inmovilizado: <b>${money(d.ghost_capital)}</b></p>${d.ghosts.map((x) => `<div>${esc(x.name)} — ${qtyFmt(x.stock)} (${money(x.capital)})</div>`).join('') || '<p class="muted">Sin datos</p>'}</div></div>
    <div class="cols">
      <div class="card"><h3 style="margin-top:0">Tickets por hora (30 días)</h3><div class="bars">${d.heatmap.hourly.map((h) => `<div style="height:${(h.tickets / maxH) * 100}%" title="${h.hour}:00 — ${h.tickets} tickets"></div>`).join('')}</div>
        <div class="axis">${d.heatmap.hourly.map((h) => `<span>${h.hour % 3 === 0 ? h.hour : ''}</span>`).join('')}</div><p class="muted">Horas pico: ${d.heatmap.peak.map((p) => p.hour + ':00').join(', ') || '—'}</p></div>
      <div class="card"><h3 style="margin-top:0">Mapa de calor de horas pico</h3><div class="heat"><span></span>${Array.from({ length: 24 }, (_, h) => `<span>${h % 6 === 0 ? h : ''}</span>`).join('')}
        ${[1, 2, 3, 4, 5, 6, 0].map((dw) => `<span>${DOW[dw]}</span>${Array.from({ length: 24 }, (_, h) => { const n = cells[dw + '-' + h] || 0; return `<i style="background:var(--heat${lvl(n)})" title="${DOW[dw]} ${h}:00 — ${n} tickets"></i>`; }).join('')}`).join('')}</div></div></div>`;
  $('#goAlerts')?.addEventListener('click', (ev) => { ev.preventDefault(); showTab('alertas'); });
  $('#topSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('#topSeg button').forEach((x) => x.classList.toggle('on', x === b)); $('#topList').innerHTML = topList(b.dataset.k === 'qty' ? d.top_sellers : d.top_margin, b.dataset.k); };
}

// ---------- ASISTENTE ----------
const SUGGEST = ['¿Cuál fue el producto más vendido el fin de semana pasado?', '¿Qué artículos debo reordenar hoy?', 'Genera una predicción de ventas para la próxima quincena', '¿Cuáles son mis horas pico?', '¿Cuánto vendí ayer?', '¿Qué productos son fantasma?'];
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function renderAsistente() {
  if (!$('#chatLog').children.length) addMsg('ai', '¡Hola! Soy tu asistente de negocio. Pregúntame por ventas, productos estrella, reorden o proyecciones.');
  $('#chips').innerHTML = SUGGEST.map((s) => `<button>${esc(s)}</button>`).join(''); $('#chatInput').focus();
}
function addMsg(who, text) { const m = document.createElement('div'); m.className = 'msg ' + who; m.innerHTML = md(text); $('#chatLog').append(m); $('#chatLog').scrollTop = 1e9; return m; }
const sendQ = guard(async (q) => {
  if (!q.trim()) return;
  addMsg('me', q); $('#chatInput').value = '';
  const wait = addMsg('ai', '…');
  try { wait.innerHTML = md((await api('/assistant', { body: { question: q } })).answer); } catch (e) { wait.textContent = 'Error: ' + e.message; }
  $('#chatLog').scrollTop = 1e9;
});
$('#chips').onclick = (e) => { if (e.target.tagName === 'BUTTON') sendQ(e.target.textContent); };
$('#chatForm').onsubmit = (e) => { e.preventDefault(); sendQ($('#chatInput').value); };

// ---------- EQUIPO ----------
async function renderEquipo() {
  const list = await api('/employees');
  state.team = list;
  setSub(`${list.filter((e) => e.active).length} empleados activos`);
  const defName = (id) => state.shift_defs.find((d) => d.id === id)?.name || '—';
  $('#teamBody').innerHTML = `<div class="bar"><span class="grow"></span><button id="newEmp" class="primary">+ Nuevo empleado</button></div>
    <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Turno asignado</th><th>Estado</th><th></th></tr></thead><tbody>${list.map((e) => `<tr style="${e.active ? '' : 'opacity:.5'}"><td><span class="av sm" style="${tint(e.name)}">${esc(initials(e.name))}</span> ${esc(e.name)}</td><td>${ROLE[e.role]}</td><td>${esc(defName(e.shift_def_id))}</td><td>${e.active ? 'Activo' : 'Baja'}</td><td><button data-id="${e.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>
    <p class="muted">El rol Encargado solo tiene permisos si lo activas en Ajustes y eliges cuáles. Los PIN son de 4 dígitos y no se pueden repetir entre empleados.</p>`;
  $('#newEmp').onclick = () => employeeForm(null);
  $('#teamBody table').onclick = (e) => { const b = e.target.closest('button'); if (b) employeeForm(state.team.find((x) => x.id == b.dataset.id)); };
}
function employeeForm(emp) {
  openDialog(`<h2>${emp ? 'Editar' : 'Nuevo'} empleado</h2><form id="eForm" class="form">
    <label>Nombre<input name="name" required value="${esc(emp?.name)}" autofocus></label>
    <div class="row"><label class="grow">Rol<select name="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${emp?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="grow">Turno asignado<select name="shift_def_id"><option value="">Cualquiera</option>${state.shift_defs.map((d) => `<option value="${d.id}" ${emp?.shift_def_id === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label></div>
    <label>${emp ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN (4 dígitos)'}<input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" ${emp ? '' : 'required'} autocomplete="new-password"></label>
    ${emp ? `<label class="check"><input type="checkbox" name="active" ${emp.active ? 'checked' : ''}> Activo</label>` : ''}
    <div class="row"><button type="button" id="eCancel" class="ghost">Cancelar</button><button class="primary big grow">Guardar</button></div></form>`);
  $('#eCancel', dlg).onclick = closeDialog;
  $('#eForm', dlg).onsubmit = guard(async (e) => {
    e.preventDefault();
    const f = e.target, body = { name: f.name.value, role: f.role.value, shift_def_id: f.shift_def_id.value || null };
    if (f.pin.value) body.pin = f.pin.value;
    if (emp) body.active = f.active.checked;
    await api(emp ? '/employees/' + emp.id : '/employees', { method: emp ? 'PUT' : 'POST', body });
    closeDialog(); toast('Empleado guardado'); renderEquipo();
  });
}

// ---------- AJUSTES ----------
function renderConfig() {
  const s = state.settings;
  $('#cfgBody').innerHTML = `<form id="cfgForm" class="card form narrow">
    <h3 style="margin:0">Negocio</h3>
    <label>Nombre del negocio<input name="business_name" value="${esc(s.business_name)}"></label>
    <label>Giro<select name="giro">${Object.entries(state.giros).map(([k, g]) => `<option value="${k}" ${k === s.giro ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
    <label>Horas de operación al día<input name="open_hours" type="number" min="1" max="24" value="${esc(s.open_hours)}"></label>
    <h3>Turnos</h3>
    <label class="check"><input type="checkbox" name="shifts_enabled" ${s.shifts_enabled === '1' ? 'checked' : ''}> Controlar cortes por turno</label>
    <div id="shiftBox" class="${s.shifts_enabled === '1' ? '' : 'hidden'}">${shiftRowsHTML(state.shift_defs)}</div>
    <h3>Encargado</h3>
    <label class="check"><input type="checkbox" name="encargado_enabled" ${s.encargado_enabled === '1' ? 'checked' : ''}> Activar el rol de encargado</label>
    <div id="permBox" class="${s.encargado_enabled === '1' ? '' : 'hidden'}">${state.encargado_perms.map((p) => `<label class="check"><input type="checkbox" name="perm" value="${p}" ${s.encargado_perms.split(',').includes(p) ? 'checked' : ''}> ${esc(PERM_LABEL[p])}</label>`).join('')}</div>
    <h3>Copias de seguridad</h3>
    <label>Carpeta de copias (vacío = carpeta data/backups)<input name="backup_dir" value="${esc(s.backup_dir)}" placeholder="D:\\Respaldos VENTAX"></label>
    <div class="row"><button class="primary grow">Guardar</button><button type="button" id="backupNow">Copia ahora</button></div><div id="cfgMsg" class="muted"></div></form>`;
  const f = $('#cfgForm');
  wireShiftRows($('#shiftBox'));
  f.shifts_enabled.onchange = () => $('#shiftBox').classList.toggle('hidden', !f.shifts_enabled.checked);
  f.encargado_enabled.onchange = () => $('#permBox').classList.toggle('hidden', !f.encargado_enabled.checked);
  f.onsubmit = guard(async (e) => {
    e.preventDefault();
    const body = { business_name: f.business_name.value, giro: f.giro.value, open_hours: Number(f.open_hours.value), shifts_enabled: f.shifts_enabled.checked,
      encargado_enabled: f.encargado_enabled.checked, encargado_perms: $$('[name=perm]:checked', f).map((x) => x.value), backup_dir: f.backup_dir.value };
    if (f.shifts_enabled.checked) body.shifts = readShiftRows($('#shiftBox'));
    await api('/settings', { body });
    await refreshState(); renderConfig(); $('#cfgMsg').textContent = 'Guardado';
  });
  $('#backupNow').onclick = guard(async () => { const r = await api('/backup', { body: {} }); toast('Copia guardada en ' + r.file); });
}

// ---------- Recorrido guiado (se muestra la primera vez de cada usuario y con el botón Guía) ----------
const tourKey = () => `ventax_tour_${state.user.id}`;
const peek = (name) => {          // muestra una sección sin renderizarla (para explicarla aunque aún no haya turno)
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== 'tab-' + name));
};
function tourSteps() {
  const nav = (t) => `#tabs [data-tab="${t}"]`;
  const S = [
    { title: `Bienvenido, ${state.user.name}`, text: 'Te muestro en un minuto cómo trabajar con VENTAX. Puedes avanzar con el botón, con las flechas del teclado, o saltarlo con Esc. Lo repites cuando quieras con el botón Guía.' },
    { target: nav('turno'), before: () => peek('turno'), title: '1. Abre tu turno', text: 'Antes de vender abre tu turno aquí. Quien recibe la caja confirma el efectivo con su PIN. Al terminar haces el corte ciego: cuentas el dinero sin ver cuánto debería haber, y el sistema compara.' },
    { target: '#scan', before: () => peek('venta'), title: '2. Escanea o busca', text: 'Apunta el lector al código de barras y el producto se agrega solo. También puedes escribir el nombre y oprimir Enter. Si el código no existe, te ofrece crearlo.' },
    { target: '#cats', title: 'O toca el producto', text: 'Filtra por categoría y toca la tarjeta. Los productos por peso o volumen (kg, L) te piden la cantidad. El punto de color es el semáforo de existencias: verde bien, amarillo bajo, rojo se agota.' },
    { target: '.ticket-panel', title: '3. Cobra', text: 'Aquí ves el ticket, el IVA incluido y el total. Elige efectivo, tarjeta o transferencia (F9 abre el cobro). En efectivo se calcula el cambio, y al final puedes imprimir el ticket.' },
    { target: '.ticket-panel .row', title: 'Descuentos y devoluciones', text: 'Solo los autoriza el dueño: se te pedirá su PIN (o el de un encargado con permiso) y siempre un motivo. Para devolver, busca el ticket por su número.' },
    { target: nav('alertas'), before: () => peek('alertas'), title: 'Alertas de inventario', text: 'Rojo: se agota pronto según lo que vendes. Amarillo: stock bajo. También avisa lo que está por caducar. Desde ahí registras la entrada de mercancía o la merma.' },
    { target: nav('inventario'), before: () => peek('inventario'), title: 'Catálogo', text: can('productos')
      ? 'Da de alta productos (el cursor inicia en el código: escanéalo), cambia precios (queda historial), importa un archivo CSV o da de baja lo que ya no vendes. Las entradas de almacén se registran aquí.'
      : 'Consulta precios y existencias de cualquier producto. Los cambios de catálogo los hace el dueño o el encargado.' },
  ];
  if (can('reportes')) {
    S.push({ target: nav('reportes'), before: () => peek('reportes'), title: 'Reportes', text: 'Ventas brutas, descuentos, devoluciones y netas, con el IVA desglosado. Cambia el periodo con las flechas, agrupa por día, turno, cajero, método o producto, y exporta a CSV o imprime.' });
    S.push({ target: nav('dashboard'), before: () => peek('dashboard'), title: 'Dashboard y asistente', text: 'El dashboard muestra cómo vas contra ayer, los productos estrella, los que no se mueven y las horas pico. El Asistente IA responde preguntas como "¿qué reordeno hoy?".' });
  }
  if (can('empleados')) S.push({ target: nav('equipo'), before: () => peek('equipo'), title: 'Equipo', text: 'Da de alta a tus empleados con un PIN de 4 dígitos y asígnales su turno. Si alguien abre un turno que no es el suyo, se pide tu autorización.' });
  if (can('ajustes')) S.push({ target: nav('config'), before: () => peek('config'), title: 'Ajustes', text: 'Define de 1 a 3 turnos con su horario, activa el rol de encargado y elige qué puede hacer, y escoge la carpeta de copias de seguridad (se hace una al cerrar cada turno).' });
  S.push({ target: '#userBtn', title: 'Tu sesión', text: 'Toca tu nombre para bloquear la pantalla; también se bloquea sola a los 5 minutos sin uso. Con "Salir" entra otro compañero con su propio PIN.' });
  S.push({ target: '#helpBtn', title: 'Y si dudas, aquí está la guía', text: 'Este botón repite el recorrido cuando lo necesites. ¡Listo para vender!' });
  return S;
}
function startTour() {
  const was = state.tab;
  const uid = state.user.id;
  runTour(tourSteps(), () => {
    try { localStorage.setItem(`ventax_tour_${uid}`, '1'); } catch {}
    if (state.user && state.user.id === uid && gate.classList.contains('hidden')) showTab(was);
  });
}
function maybeAutoTour() {
  let seen = false; try { seen = localStorage.getItem(tourKey()) === '1'; } catch {}
  if (!seen) setTimeout(startTour, 700);
}
$('#helpBtn').onclick = startTour;

// ---------- Arranque ----------
(async () => {
  try {
    if (token) { try { await enterApp(); return; } catch (e) { setToken(''); } }
    await showGate();
  } catch (e) { toast('No se pudo conectar con el servidor: ' + e.message, true); }
})();
