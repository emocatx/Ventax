// Analítica gerencial, alertas predictivas y asistente conversacional.
import { get, all, getSettings } from './db.js';

const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round(n * 100) / 100;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ---------- Indicadores ----------
export function dayStats(mod = '+0 day') {
  const s = get(`SELECT COALESCE(SUM(total),0) total, COUNT(*) tickets FROM sales WHERE date(created_at)=date('now','localtime',?)`, mod);
  const m = get(`SELECT COALESCE(SUM((COALESCE(si.net,si.price*si.qty)-si.cost*si.qty)),0) margin
                 FROM sale_items si JOIN sales s ON s.id=si.sale_id
                 WHERE date(s.created_at)=date('now','localtime',?)`, mod);
  const rt = get(`SELECT COALESCE(SUM(total),0) t FROM returns WHERE date(created_at)=date('now','localtime',?)`, mod).t;   // devoluciones restan
  const total = s.total - rt;
  return { total: r2(total), tickets: s.tickets, avg: s.tickets ? r2(total / s.tickets) : 0, margin: r2(m.margin) };
}

export function topProducts(from, to, by = 'qty', limit = 5) {
  const order = by === 'margin' ? 'margin' : 'qty';
  return all(`SELECT si.name, SUM(si.qty) qty, SUM(COALESCE(si.paid,si.price*si.qty)) revenue, SUM((COALESCE(si.net,si.price*si.qty)-si.cost*si.qty)) margin
              FROM sale_items si JOIN sales s ON s.id=si.sale_id
              WHERE date(s.created_at) BETWEEN ? AND ?
              GROUP BY si.product_id ORDER BY ${order} DESC LIMIT ?`, from, to, limit)
    .map((r) => ({ ...r, revenue: r2(r.revenue), margin: r2(r.margin) }));
}

export function ghostProducts(days = 30) {
  return all(`SELECT p.id, p.name, p.stock, p.cost, p.stock*p.cost AS capital
              FROM products p
              WHERE p.active=1 AND p.stock>0 AND NOT EXISTS (
                SELECT 1 FROM sale_items si JOIN sales s ON s.id=si.sale_id
                WHERE si.product_id=p.id AND date(s.created_at) >= date('now','localtime',?))
              ORDER BY capital DESC`, `-${days} day`).map((r) => ({ ...r, capital: r2(r.capital) }));
}

// Mapa de calor día-de-semana x hora (últimos 30 días)
export function heatmap() {
  const rows = all(`SELECT CAST(strftime('%w',created_at) AS INT) dow, CAST(strftime('%H',created_at) AS INT) hour,
                           COUNT(*) tickets, SUM(total) total
                    FROM sales WHERE date(created_at) >= date('now','localtime','-30 day')
                    GROUP BY dow, hour`);
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, tickets: 0, total: 0 }));
  for (const r of rows) { hourly[r.hour].tickets += r.tickets; hourly[r.hour].total += r.total; }
  hourly.forEach((h) => (h.total = r2(h.total)));
  const peak = [...hourly].sort((a, b) => b.tickets - a.tickets).filter((h) => h.tickets > 0).slice(0, 3);
  return { cells: rows, hourly, peak };
}

// ---------- Alertas de escasez predictivas ----------
export function stockAlerts() {
  const openHours = Number(getSettings().open_hours) || 12;
  const rows = all(`SELECT p.id, p.name, p.barcode, p.stock, p.min_stock, p.max_stock,
      COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id=si.sale_id
                WHERE si.product_id=p.id AND date(s.created_at) >= date('now','localtime','-7 day')),0) sold7
    FROM products p WHERE p.active=1`);
  const out = [];
  for (const p of rows) {
    const perHour = p.sold7 / (7 * openHours);       // velocidad de venta en horas de operación
    const perDay = perHour * openHours;
    const hoursLeft = perHour > 0 ? p.stock / perHour : null;
    let level = null;
    let reason = '';
    if (p.stock <= 0) { level = 'critico'; reason = 'Agotado'; }
    else if (p.min_stock > 0 && p.stock <= p.min_stock) { level = 'critico'; reason = `Stock (${p.stock}) en o bajo el mínimo (${p.min_stock})`; }
    else if (hoursLeft !== null && hoursLeft <= openHours) { level = 'critico'; reason = `Quedan ${p.stock} y se venden ~${r2(perDay)} por día: se agota en ~${fmtHours(hoursLeft, openHours)}`; }
    else if (p.min_stock > 0 && p.stock <= p.min_stock * 1.5) { level = 'aviso'; reason = `Próximo al mínimo (${p.min_stock})`; }
    else if (hoursLeft !== null && hoursLeft <= openHours * 3) { level = 'aviso'; reason = `Quedan ${p.stock} y se venden ~${r2(perDay)} por día: se agota en ~${fmtHours(hoursLeft, openHours)}`; }
    if (!level) continue;
    let suggested = p.max_stock > 0 ? p.max_stock - p.stock : Math.ceil(perDay * 3 - p.stock);
    suggested = Math.max(0, Math.ceil(suggested));
    out.push({ id: p.id, name: p.name, barcode: p.barcode, stock: p.stock, min_stock: p.min_stock,
      per_day: r2(perDay), hours_left: hoursLeft === null ? null : r2(hoursLeft), level, reason, suggested });
  }
  const rank = { critico: 0, aviso: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.hours_left ?? 1e9) - (b.hours_left ?? 1e9));
}

function fmtHours(h, openHours) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min de operación`;
  if (h <= openHours) return `${Math.round(h * 10) / 10} h de operación`;
  return `${Math.round((h / openHours) * 10) / 10} días`;
}

// Productos con caducidad en los próximos `days` días (o ya vencidos) y sugerencia de descuento.
export function expiryAlerts(days = 7) {
  return all(`SELECT id, name, barcode, stock, cost, expires_at,
                CAST(julianday(expires_at) - julianday(date('now','localtime')) AS INT) days_left
              FROM products
              WHERE active=1 AND stock>0 AND expires_at IS NOT NULL AND expires_at <= date('now','localtime',?)
              ORDER BY expires_at`, `+${days} day`)
    .map((r) => ({ ...r, suggest_discount: r.days_left <= 0 ? 50 : r.days_left <= 2 ? 30 : 15 }));
}

export function prediction(days = 15) {
  const d = get(`SELECT COUNT(DISTINCT date(created_at)) n, COALESCE(SUM(total),0) t
                 FROM sales WHERE date(created_at) >= date('now','localtime','-28 day')`);
  const avg = d.n ? d.t / d.n : 0;
  return { days, avg_daily: r2(avg), estimate: r2(avg * days), basis_days: d.n };
}

export function dashboard() {
  const range = get(`SELECT date('now','localtime','-29 day') f, date('now','localtime') t, date('now','localtime') today`);
  const today = dayStats('+0 day');
  const yesterday = dayStats('-1 day');
  const lastWeek = dayStats('-7 day');
  const pct = (a, b) => (b ? r2(((a - b) / b) * 100) : null);
  return {
    today, yesterday, last_week: lastWeek,
    vs_yesterday: pct(today.total, yesterday.total),
    vs_last_week: pct(today.total, lastWeek.total),
    margin_pct: today.total ? r2((today.margin / today.total) * 100) : 0,
    top_today: topProducts(range.today, range.today, 'qty', 1)[0] || null,
    top_sellers: topProducts(range.f, range.t, 'qty', 10),
    top_margin: topProducts(range.f, range.t, 'margin', 10),
    expiring: expiryAlerts(7),
    ghosts: ghostProducts(30).slice(0, 10),
    ghost_capital: r2(ghostProducts(30).reduce((s, g) => s + g.capital, 0)),
    heatmap: heatmap(),
    alerts: stockAlerts(),
    prediction: prediction(15),
  };
}

// ---------- Asistente conversacional ----------
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function periodFrom(q) {
  const today = new Date();
  const T = ymd(today);
  if (/fin de semana pasado|finde pasado/.test(q)) {
    let sun = new Date(today);
    do { sun = addDays(sun, -1); } while (sun.getDay() !== 0);
    return { from: ymd(addDays(sun, -1)), to: ymd(sun), label: 'el fin de semana pasado' };
  }
  if (/ayer/.test(q)) return { from: ymd(addDays(today, -1)), to: ymd(addDays(today, -1)), label: 'ayer' };
  if (/semana pasada/.test(q)) {
    const dow = (today.getDay() + 6) % 7;                 // lunes=0
    const monThis = addDays(today, -dow);
    return { from: ymd(addDays(monThis, -7)), to: ymd(addDays(monThis, -1)), label: 'la semana pasada' };
  }
  if (/esta semana|semana/.test(q)) {
    const dow = (today.getDay() + 6) % 7;
    return { from: ymd(addDays(today, -dow)), to: T, label: 'esta semana' };
  }
  if (/mes pasado/.test(q)) {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: ymd(first), to: ymd(last), label: 'el mes pasado' };
  }
  if (/\bmes\b/.test(q)) return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: T, label: 'este mes' };
  if (/hoy/.test(q)) return { from: T, to: T, label: 'hoy' };
  return { from: ymd(addDays(today, -29)), to: T, label: 'los últimos 30 días' };
}

export async function ask(question) {
  const q = norm(question || '');
  const p = periodFrom(q);

  if (/predic|pronostic|proyec|estim|quincena/.test(q)) {
    const pr = prediction(/quincena/.test(q) ? 15 : /mes/.test(q) ? 30 : /semana/.test(q) ? 7 : 15);
    if (!pr.basis_days) return 'Aún no hay ventas suficientes para proyectar. Registra ventas unos días y vuelvo a intentarlo.';
    return `Proyección a ${pr.days} días: **${money(pr.estimate)}**.\nSe basa en tu promedio diario de ${money(pr.avg_daily)} sobre ${pr.basis_days} días con ventas (últimos 28). Es un estimado lineal; no considera estacionalidad ni quincenas de pago.`;
  }
  if (/reorden|surtir|reabast|pedir|comprar|resurt|falt/.test(q)) {
    const a = stockAlerts().filter((x) => x.suggested > 0).slice(0, 12);
    if (!a.length) return 'Por ahora ningún producto necesita reorden. 👌';
    return 'Conviene reordenar hoy:\n' + a.map((x) => `• ${x.name}: quedan ${x.stock}, pedir ~${x.suggested} (${x.reason})`).join('\n');
  }
  if (/fantasma|baja rotacion|no se vende|inmoviliz|estancad/.test(q)) {
    const g = ghostProducts(30);
    if (!g.length) return 'No hay productos fantasma: todo lo que tienes en stock se movió en los últimos 30 días.';
    const cap = g.reduce((s, x) => s + x.capital, 0);
    return `Hay ${g.length} productos sin ventas en 30 días, con **${money(cap)}** inmovilizados:\n` +
      g.slice(0, 8).map((x) => `• ${x.name}: ${x.stock} pzas (${money(x.capital)})`).join('\n');
  }
  if (/hora|pico|mas se vende|trafico|personal/.test(q)) {
    const h = heatmap().peak;
    if (!h.length) return 'Todavía no hay ventas para calcular horarios pico.';
    return 'Tus horas pico (últimos 30 días):\n' + h.map((x) => `• ${String(x.hour).padStart(2, '0')}:00 – ${String(x.hour + 1).padStart(2, '0')}:00 → ${x.tickets} tickets, ${money(x.total)}`).join('\n') + '\nReúne más personal en mostrador en esas franjas.';
  }
  if (/margen|utilidad|ganancia mas|rentable/.test(q) && /product|articul|mas|cual/.test(q)) {
    const t = topProducts(p.from, p.to, 'margin', 5);
    if (!t.length) return `No hay ventas en ${p.label}.`;
    return `Productos con más utilidad en ${p.label}:\n` + t.map((x, i) => `${i + 1}. ${x.name} — ${money(x.margin)} (${x.qty} vendidos)`).join('\n');
  }
  if (/mas vendido|top|estrella|mejor|vendio mas|se vendio mas/.test(q)) {
    const t = topProducts(p.from, p.to, 'qty', 5);
    if (!t.length) return `No encontré ventas en ${p.label}.`;
    return `Lo más vendido en ${p.label}:\n` + t.map((x, i) => `${i + 1}. ${x.name} — ${x.qty} pzas (${money(x.revenue)})`).join('\n');
  }
  if (/venta|vendi|ingreso|cuanto|ticket|ganancia|utilidad/.test(q)) {
    const s = get(`SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM sales WHERE date(created_at) BETWEEN ? AND ?`, p.from, p.to);
    const m = get(`SELECT COALESCE(SUM((COALESCE(si.net,si.price*si.qty)-si.cost*si.qty)),0) m FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE date(s.created_at) BETWEEN ? AND ?`, p.from, p.to);
    return `Ventas de ${p.label}: **${money(s.total)}** en ${s.n} tickets (promedio ${money(s.n ? s.total / s.n : 0)}). Utilidad bruta: ${money(m.m)}.`;
  }

  // Pregunta libre: si hay API key de Anthropic, usar un modelo con un resumen de datos.
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await askClaude(question); } catch (e) { return 'No pude consultar el modelo de IA: ' + e.message; }
  }
  return 'Puedo responder cosas como:\n• ¿Cuál fue el producto más vendido el fin de semana pasado?\n• ¿Qué artículos debo reordenar hoy?\n• Genera una predicción de ventas para la próxima quincena\n• ¿Cuáles son mis horas pico?\n• ¿Qué productos son fantasma?\n• ¿Cuánto vendí ayer?\n(Para preguntas abiertas, define la variable ANTHROPIC_API_KEY y reinicia.)';
}

async function askClaude(question) {
  const d = dashboard();
  const snapshot = { negocio: getSettings().business_name, hoy: d.today, ayer: d.yesterday, top_vendidos_30d: d.top_sellers,
    top_margen_30d: d.top_margin, fantasmas: d.ghosts, horas_pico: d.heatmap.peak, alertas_stock: d.alerts.slice(0, 15), proyeccion_quincena: d.prediction };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 700,
      system: 'Eres el asistente de negocio de un punto de venta. Responde en español, breve y accionable, usando SOLO los datos JSON dados. Si falta información, dilo. Montos en MXN.',
      messages: [{ role: 'user', content: `Datos:\n${JSON.stringify(snapshot)}\n\nPregunta: ${question}` }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const j = await res.json();
  return j.content?.map((c) => c.text).join('') || 'Sin respuesta.';
}
