// Recorrido guiado: oscurece la pantalla, resalta un elemento y explica qué hacer ahí.
// steps: [{ target?: 'selector', title, text, before?: () => void }]  (sin target = tarjeta al centro)
let active = null;                                   // solo puede haber un recorrido a la vez
export const endTour = () => { if (active) active(); };
export function runTour(steps, onEnd = () => {}) {
  endTour();
  let i = 0;
  const root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Recorrido de bienvenida');
  root.innerHTML = `<div class="tour-hole"></div>
    <div class="tour-card"><div class="tour-step"></div><h2 class="tour-title"></h2><p class="tour-text"></p>
    <div class="tour-actions"><button type="button" class="ghost" data-t="skip">Saltar</button><span class="grow"></span>
    <button type="button" data-t="prev">Anterior</button><button type="button" class="primary" data-t="next">Siguiente</button></div></div>`;
  document.body.append(root);
  const hole = root.querySelector('.tour-hole'), card = root.querySelector('.tour-card');
  const $c = (s) => card.querySelector(s);

  function place() {
    const s = steps[i];
    const el = s.target ? document.querySelector(s.target) : null;
    let r = el ? el.getBoundingClientRect() : null;
    if (el && r && (r.width < 4 || r.height < 4)) r = null;       // oculto o vacío: se explica al centro
    const vw = innerWidth, vh = innerHeight, cw = Math.min(340, vw - 24), ch = card.offsetHeight;
    card.style.width = cw + 'px';
    if (!r) {
      root.classList.add('center'); hole.style.display = 'none';
      card.style.left = Math.max(12, (vw - cw) / 2) + 'px'; card.style.top = Math.max(12, (vh - ch) / 2) + 'px';
      return;
    }
    root.classList.remove('center'); hole.style.display = 'block';
    const pad = 6;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    let x, y;
    if (r.right + cw + 24 < vw) { x = r.right + 18; y = r.top; }                       // a la derecha
    else if (r.bottom + ch + 24 < vh) { x = r.left; y = r.bottom + 14; }                // debajo
    else if (r.top - ch - 24 > 0) { x = r.left; y = r.top - ch - 14; }                  // arriba
    else { x = r.left - cw - 18; y = r.top; }                                           // a la izquierda
    card.style.left = Math.min(Math.max(12, x), vw - cw - 12) + 'px';
    card.style.top = Math.min(Math.max(12, y), vh - ch - 12) + 'px';
  }

  function show() {
    const s = steps[i];
    s.before?.();
    const el = s.target ? document.querySelector(s.target) : null;
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    $c('.tour-step').textContent = `Paso ${i + 1} de ${steps.length}`;
    $c('.tour-title').textContent = s.title;
    $c('.tour-text').textContent = s.text;
    $c('[data-t=prev]').style.visibility = i === 0 ? 'hidden' : 'visible';
    $c('[data-t=next]').textContent = i === steps.length - 1 ? 'Terminar' : 'Siguiente';
    $c('[data-t=skip]').style.visibility = i === steps.length - 1 ? 'hidden' : 'visible';
    requestAnimationFrame(() => { place(); $c('[data-t=next]').focus({ preventScroll: true }); });
  }

  function end(done) { active = null; removeEventListener('resize', place); document.removeEventListener('keydown', key, true); root.remove(); onEnd(done); }
  active = () => end(false);
  const next = () => (i < steps.length - 1 ? (i++, show()) : end(true));
  const prev = () => { if (i > 0) { i--; show(); } };
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev(); }
  }
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    if (b.dataset.t === 'next') next(); else if (b.dataset.t === 'prev') prev(); else end(false);
  });
  root.addEventListener('click', (e) => e.stopPropagation());
  addEventListener('resize', place);
  document.addEventListener('keydown', key, true);
  show();
}
