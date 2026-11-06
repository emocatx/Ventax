const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const money = (n: number | null | undefined) => fmt.format(n ?? 0);
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const qtyFmt = (q: number) => Math.round(q * 1000) / 1000;
export const UNIT = { pieza: 'pza', kg: 'kg', g: 'g', l: 'L' } as const;
export const ROLE = { dueno: 'Dueño', encargado: 'Encargado', cajero: 'Cajero' } as const;

const hue = (t: string) => { let h = 0; for (const c of t || '') h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const tint = (t: string) => ({ background: `hsl(${hue(t)} 45% 92%)`, color: `hsl(${hue(t)} 40% 30%)` });
export const initials = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
