import { loadCart, saveCart, removeFromCart, cartCount } from '../builder/cart';
import { FONT } from '../builder/brickfont';
import type { CartItem } from '../builder/types';

/* ---- header scroll blur ---- */
function initHeaderScroll(): void {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/* ---- mobile menu ---- */
function initMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
  if (!toggle || !menu) return;
  const set = (open: boolean) => {
    menu.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => set(!menu.classList.contains('is-open')));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => set(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}

/* ---- cart count badge ---- */
export function updateCount(): void {
  const n = cartCount();
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(n);
    el.classList.toggle('is-shown', n > 0);
  });
}

/* ---- mini brick preview ---- */
export function miniPreview(item: CartItem, cellSize = 4): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `display:flex;gap:${cellSize * 2}px;align-items:flex-start`;
  let idx = 0;
  [...(item.name || '')].forEach((ch) => {
    const up = ch.toUpperCase();
    if (up === ' ') {
      const s = document.createElement('span');
      s.style.width = cellSize * 3 + 'px';
      wrap.appendChild(s);
      return;
    }
    const grid = FONT[up];
    if (!grid) return;
    const colour = item.letters[idx]?.colour ?? '#169B62';
    idx++;
    const g = document.createElement('div');
    g.style.cssText = `display:grid;grid-template-columns:repeat(5,${cellSize}px);grid-template-rows:repeat(7,${cellSize}px);gap:${Math.max(1, cellSize * 0.12)}px`;
    grid.forEach((row) => {
      [...row].forEach((c) => {
        const d = document.createElement('span');
        d.style.cssText =
          `width:${cellSize}px;height:${cellSize}px;border-radius:${Math.max(1, cellSize * 0.2)}px;` +
          (c === '1'
            ? `background:${colour};box-shadow:inset 0 1px 0 rgba(255,255,255,.45),inset 0 -1px 0 rgba(0,0,0,.2)`
            : '');
        g.appendChild(d);
      });
    });
    wrap.appendChild(g);
  });
  return wrap;
}

/* ---- toast ---- */
function ensureRegion(): HTMLElement {
  let r = document.querySelector<HTMLElement>('.toast-region');
  if (!r) {
    r = document.createElement('div');
    r.className = 'toast-region';
    r.setAttribute('aria-live', 'polite');
    document.body.appendChild(r);
  }
  return r;
}

export function showToast(payload: CartItem): void {
  updateCount();
  const region = ensureRegion();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `
    <div class="t-ico" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M5 13l4 4L19 7" stroke="#3a1d05" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="t-body">
      <div class="t-title">Added to your basket</div>
      <div class="t-sub">${payload.name ? `"${payload.name}" · ${payload.sizeLabel} · €${payload.price}` : `€${payload.price}`} — <a class="t-link" href="/cart">View basket</a></div>
    </div>
    <button class="t-close" aria-label="Dismiss">✕</button>`;
  region.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  const close = () => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 320); };
  t.querySelector<HTMLButtonElement>('.t-close')!.addEventListener('click', close);
  setTimeout(close, 5200);
}

/* ---- accordions ---- */
function initAccordions(): void {
  document.querySelectorAll<HTMLButtonElement>('.acc-trigger').forEach((btn) => {
    const panelId = btn.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      if (panel) panel.style.maxHeight = open ? '0' : panel.scrollHeight + 'px';
    });
  });
}

/* ---- newsletter ---- */
function initNewsletter(): void {
  document.querySelectorAll<HTMLFormElement>('[data-newsletter]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input');
      const msg = form.parentElement?.querySelector<HTMLElement>('[data-newsletter-msg]');
      if (msg && input) {
        msg.textContent = `Grand — we'll send the good stuff to ${input.value}.`;
        msg.hidden = false;
        input.value = '';
      }
    });
  });
}

/* ---- SVG brick name preview (scales to any width) ---- */
function brickNameSVG(item: CartItem): string {
  const name    = (item.name || '').toUpperCase();
  const letters = item.letters || [];
  const cell    = 5;
  const gap     = 4;
  const cols    = 5;
  const lw      = cols * cell;

  let totalW = 0;
  for (const ch of name) {
    totalW += (ch === ' ' ? Math.round(lw * 0.6) : lw) + gap;
  }
  totalW = Math.max(totalW - gap, 1);
  const totalH = 7 * cell;

  let rects = '';
  let x = 0;
  let ci = 0;
  for (const ch of name) {
    if (ch === ' ') { x += Math.round(lw * 0.6) + gap; continue; }
    const grid   = FONT[ch];
    const colour = letters[ci]?.colour || '#1D4ED8';
    ci++;
    if (!grid) { x += lw + gap; continue; }
    grid.forEach((row, ri) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '1') {
          rects += `<rect x="${x + c * cell}" y="${ri * cell}" width="${cell - 1}" height="${cell - 1}" rx="1" fill="${colour}"/>`;
        }
      }
    });
    x += lw + gap;
  }
  return `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;max-height:44px" aria-hidden="true">${rects}</svg>`;
}

/* ---- cart page renderer ---- */
function renderCart(): void {
  const root = document.querySelector<HTMLElement>('[data-cart-root]');
  if (!root) return;

  const cart = loadCart();

  if (cart.length === 0) {
    root.innerHTML = `
      <div class="empty-cart">
        <div class="ge-bricks" aria-hidden="true" style="justify-content:center;margin-bottom:16px">
          <i style="width:30px;height:30px;border-radius:5px;display:inline-block;background:var(--sage);box-shadow:inset 0 2px 0 rgba(255,255,255,.5),inset 0 -4px 0 rgba(0,0,0,.18)"></i>
          <i style="width:30px;height:30px;border-radius:5px;display:inline-block;background:var(--orange);box-shadow:inset 0 2px 0 rgba(255,255,255,.5),inset 0 -4px 0 rgba(0,0,0,.18);margin-left:8px"></i>
          <i style="width:30px;height:30px;border-radius:5px;display:inline-block;background:var(--green);box-shadow:inset 0 2px 0 rgba(255,255,255,.5),inset 0 -4px 0 rgba(0,0,0,.18);margin-left:8px"></i>
        </div>
        <h2 style="margin-bottom:10px">Your basket is empty</h2>
        <p class="muted" style="margin-bottom:22px">Build something with your name on it.</p>
        <a class="btn btn--cta btn--lg" href="/">Open the builder →</a>
      </div>`;
    return;
  }

  const total    = cart.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const shipping = total >= 40 ? 0 : 4.95;

  root.innerHTML = `
    <div class="cart-layout">
      <div data-cart-items class="cart-items-list"></div>
      <aside class="card summary" aria-label="Order summary">
        <h2 style="font-size:var(--fs-lg);margin-bottom:16px">Summary</h2>
        <div class="summary-row"><span>Subtotal</span><span>€${total.toFixed(2)}</span></div>
        <div class="summary-row"><span>Shipping (Ireland)</span><span>${shipping === 0 ? '<span style="color:var(--green);font-weight:700">Free</span>' : `€${shipping.toFixed(2)}`}</span></div>
        <div class="summary-row total"><span>Total</span><span>€${(total + shipping).toFixed(2)}</span></div>
        <a class="btn btn--cta btn--block btn--lg" href="/checkout" style="margin-top:20px;text-align:center;display:block">
          Checkout <span aria-hidden="true">→</span>
        </a>
        <p class="field-hint center" style="margin-top:12px">Secure checkout · Made in Ireland</p>
      </aside>
    </div>`;

  const itemsEl = root.querySelector<HTMLElement>('[data-cart-items]')!;
  cart.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'cart-item';
    const themeName = item.theme
      ? item.theme.charAt(0).toUpperCase() + item.theme.slice(1)
      : '';
    article.innerHTML = `
      <div class="ci-preview">${brickNameSVG(item)}</div>
      <div class="ci-body">
        <div class="ci-row1">
          <h3 class="ci-name">"${item.name}"</h3>
          <span class="ci-price">€${item.price * (item.qty || 1)}</span>
        </div>
        <div class="ci-meta">
          ${themeName ? `<span>${themeName} theme</span>` : ''}
          ${item.brickCount ? `<span>${item.brickCount} bricks</span>` : ''}
          <span>qty ${item.qty || 1}</span>
        </div>
        <div class="ci-actions">
          <button class="ci-remove" data-remove="${item.id}">Remove</button>
        </div>
      </div>`;
    article.querySelector<HTMLButtonElement>('[data-remove]')!.addEventListener('click', () => {
      removeFromCart(item.id);
      renderCart();
      updateCount();
    });
    itemsEl.appendChild(article);
  });
}

/* ---- colour sets on shop page ---- */
function renderColourSets(): void {
  const container = document.querySelector<HTMLElement>('[data-colour-sets]');
  if (!container) return;
  const sets = [
    { name: 'Rainbow', colours: ['#E0473A','#F58A3C','#F2C200','#169B62','#2B6CB0','#7E5BD0'], desc: 'Every letter a different hue — playful and bold.' },
    { name: 'Irish',   colours: ['#169B62','#F58A3C','#0E6B43','#7FB69A'], desc: 'Our signature green and orange — made in Ireland.' },
    { name: 'Classic', colours: ['#D8412F','#2B6CB0','#F2C200','#169B62'], desc: 'Primary colours that never go out of style.' },
    { name: 'Pastel',  colours: ['#F6A6B2','#A8D8C9','#FBD9A0','#B7C7EE','#D9BEE8'], desc: 'Soft and sweet — perfect for nursery names.' },
  ];
  sets.forEach((set) => {
    const card = document.createElement('div');
    card.className = 'card';
    const dots = set.colours.map((c) => `<span style="width:28px;height:28px;border-radius:50%;background:${c};display:inline-block;box-shadow:inset 0 2px 0 rgba(255,255,255,.45),inset 0 -3px 0 rgba(0,0,0,.18)"></span>`).join('');
    card.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${dots}</div>
      <h3 style="margin-bottom:6px">${set.name}</h3>
      <p class="muted">${set.desc}</p>`;
    container.appendChild(card);
  });
}

/* ---- about page brick preview ---- */
function renderAboutBricks(): void {
  const el = document.querySelector<HTMLElement>('[data-about-bricks]');
  if (!el) return;
  const fakeItem: CartItem = {
    id: 'about',
    type: 'custom-name',
    name: 'TÓG',
    theme: 'irish',
    oneColour: null,
    brickSizePx: 22,
    sizeLabel: 'Medium',
    letters: [
      { char: 'T', colour: '#169B62' },
      { char: 'Ó', colour: '#F58A3C' },
      { char: 'G', colour: '#0E6B43' },
    ],
    brickCount: 0,
    price: 0,
    currency: 'EUR',
    qty: 1,
    createdAt: '',
  };
  el.appendChild(miniPreview(fakeItem, 7));
}

/* ---- gallery scenes on home page ---- */
function renderScenes(): void {
  const scenes: Record<string, { name: string; colours: string[]; cell: number }> = {
    nursery: { name: 'MILA', colours: ['#F6A6B2','#A8D8C9','#FBD9A0','#B7C7EE'], cell: 7 },
    cake:    { name: '6',    colours: ['#E0473A','#F2C200','#2B6CB0'], cell: 9 },
    desk:    { name: 'BOSS', colours: ['#169B62','#0E6B43','#F58A3C','#7FB69A'], cell: 7 },
  };
  document.querySelectorAll<HTMLElement>('[data-brick-scene]').forEach((el) => {
    const key = el.dataset.brickScene ?? '';
    const cfg = scenes[key];
    if (!cfg) return;
    renderWildPhoto(el, cfg);
  });
}

function renderWildPhoto(
  el: HTMLElement,
  cfg: { name: string; colours: string[]; cell: number }
): void {
  const cell = cfg.cell;
  const wrap = document.createElement('div');
  wrap.className = 'wild-letters';
  let idx = 0;
  [...cfg.name].forEach((ch) => {
    if (ch === ' ') return;
    const rows = FONT[ch];
    if (!rows) return;
    const colour = cfg.colours[idx++ % cfg.colours.length];
    const g = document.createElement('div');
    g.style.cssText = [
      `display:grid`,
      `grid-template-columns:repeat(5,${cell}px)`,
      `grid-template-rows:repeat(7,${cell}px)`,
      `gap:${Math.max(1, cell * 0.09)}px`,
      `--bc:${colour}`,
    ].join(';');
    rows.forEach((row) => {
      [...row].forEach((c) => {
        const d = document.createElement('span');
        const on = c === '1';
        d.className = 'brick-cell' + (on ? ' is-on' : '');
        g.appendChild(d);
      });
    });
    wrap.appendChild(g);
  });
  el.innerHTML = '';
  el.appendChild(wrap);
}

/* ---- expose globals for builder.ts toast ---- */
declare global {
  interface Window {
    TogToast: (p: CartItem) => void;
    TogMiniPreview: typeof miniPreview;
    TogCart: { load: typeof loadCart; save: typeof saveCart; KEY: string };
  }
}

window.TogToast = showToast;
window.TogMiniPreview = miniPreview;
window.TogCart = { load: loadCart, save: saveCart, KEY: 'togblocks_cart' };

async function syncCartWithServer(): Promise<void> {
  try {
    const localCart = loadCart();
    if (!localCart.length) return;
    // Push local cart to server (server stores normalized shape for order lookup)
    await fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(localCart.map(i => ({
        product_type: i.type === 'door-sign' ? 'door-sign' : 'letters',
        custom_name:  i.name ?? '',
        colours:      (i.letters ?? []).map((l: any) => l.colour),
        quantity:     i.qty ?? 1,
        unit_price:   Math.round((i.price ?? 0) * 100),
      }))),
    });
  } catch {
    // non-critical — continue silently
  }
}

/* Restore cart from server when localStorage is empty (e.g. new device after login) */
async function loadCartFromServer(): Promise<void> {
  try {
    if (loadCart().length > 0) return; // local cart takes priority
    const res = await fetch('/api/cart');
    if (!res.ok) return;
    const serverItems: {
      product_type: string;
      custom_name: string;
      colours: string[];
      quantity: number;
      unit_price: number;
    }[] = await res.json();
    if (!serverItems.length) return;

    const restored: CartItem[] = serverItems.map((s) => ({
      id: crypto.randomUUID(),
      type: s.product_type === 'door-sign' ? 'door-sign' : 'custom-name',
      name: s.custom_name,
      letters: (s.colours ?? []).map((colour) => ({ char: '', colour })),
      qty: s.quantity,
      price: s.unit_price / 100,
      theme: '',
      oneColour: null,
      brickSizePx: 0,
      sizeLabel: '',
      brickCount: 0,
      currency: 'EUR',
      createdAt: new Date().toISOString(),
    }));
    saveCart(restored);
  } catch {
    // non-critical
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeaderScroll();
  initMenu();
  initAccordions();
  initNewsletter();
  renderColourSets();
  renderScenes();
  renderAboutBricks();
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
  // Pull server cart first (new device), then render and sync
  loadCartFromServer().then(() => {
    updateCount();
    renderCart();
    syncCartWithServer();
  });
});

document.addEventListener('cart:update', () => {
  updateCount();
  syncCartWithServer();
});
