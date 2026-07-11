import { FONT, isSupported, countFilledCells } from './brickfont';
import {
  THEMES, themeColor, PICKER,
  priceLetters, discountPct,
  SIZE_LABELS, SIZE_MM, SIZE_CELL_PX, type LetterSize,
} from './themes';
import { addToCart } from './cart';
import type { CartItem } from './types';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function q<T extends Element = Element>(sel: string, ctx: Element | Document = document): T {
  return (ctx as Element).querySelector<T>(sel) as T;
}
function qa<T extends Element = Element>(sel: string, ctx: Element | Document = document): T[] {
  return [...(ctx as Element).querySelectorAll<T>(sel)];
}

function swatchBtn(color: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.style.background = color;
  b.dataset.c = color;
  b.setAttribute('aria-label', 'Colour ' + color);
  b.addEventListener('click', onClick);
  return b;
}

interface BuilderState {
  text: string;
  size: LetterSize;
  theme: string;
  cell: number;
  oneColor: string;
  overrides: Record<number, string>;
  addons: { dots: boolean; giftBox: boolean };
}

export class NameBuilder {
  private host: HTMLElement;
  private state: BuilderState;
  private MAX = 12;
  private activeLetter: number | null = null;
  private ro: ResizeObserver;
  private el!: {
    stage: HTMLElement;
    scaler: HTMLElement;
    name: HTMLElement;
    empty: HTMLElement;
    input: HTMLInputElement;
    counter: HTMLElement;
    hint: HTMLElement;
    sizes: HTMLElement;
    themes: HTMLElement;
    onecolour: HTMLElement;
    price: HTMLElement;
    breakdown: HTMLElement;
    add: HTMLButtonElement;
    addLabel: HTMLElement;
    pop: HTMLElement;
    popTitle: HTMLElement;
    popSwatches: HTMLElement;
    popClose: HTMLButtonElement;
    extrasCards: HTMLButtonElement[];
    giftRec: HTMLElement;
  };

  constructor(host: HTMLElement) {
    this.host = host;
    this.state = {
      text: host.dataset.initial || '',
      size: 'standard',
      theme: 'irish',
      cell: SIZE_CELL_PX['standard'],
      oneColor: PICKER[3], // green
      overrides: {},
      addons: { dots: false, giftBox: false },
    };
    this.ro = new ResizeObserver(() => this.fit());
    this.build();
    this.setText(this.state.text, false);
  }

  private build(): void {
    const s = this.state;
    this.host.innerHTML = `
      <div class="builder" data-builder>
        <div class="builder-stage" data-stage>
          <div class="brick-scaler" data-scaler>
            <div class="brick-name" data-name role="img" aria-label="Your name in bricks"></div>
          </div>
          <div class="builder-empty" data-empty hidden>
            <div class="ge-bricks" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="ge-text">Type a name to start building</div>
          </div>
        </div>

        <div class="builder-controls">
          <div class="control-group">
            <div class="control-head">
              <label class="label" for="nb-text">Your name or word</label>
              <span class="input-counter" data-counter>0/${this.MAX}</span>
            </div>
            <div class="input-wrap">
              <input id="nb-text" class="input" data-input type="text" inputmode="text"
                maxlength="${this.MAX}" autocomplete="off" placeholder="e.g. ADA"
                aria-describedby="nb-hint" />
            </div>
            <p class="field-hint" id="nb-hint" data-hint>Letters and numbers only (A–Z, 0–9). Tap any letter to recolour it.</p>
          </div>

          <div class="control-group">
            <span class="label" id="nb-size-label">Letter size</span>
            <div class="size-selector" role="group" aria-labelledby="nb-size-label" data-sizes>
              <button type="button" class="size-opt" data-size="small" aria-pressed="false">
                <span class="so-label">Small</span>
                <span class="so-dim">12cm</span>
                <span class="so-price">€5.99/letter</span>
              </button>
              <button type="button" class="size-opt" data-size="standard" aria-pressed="true">
                <span class="so-label">Medium</span>
                <span class="so-dim">15cm</span>
                <span class="so-price">€7.99/letter</span>
              </button>
              <button type="button" class="size-opt" data-size="statement" aria-pressed="false">
                <span class="so-label">Premium</span>
                <span class="so-dim">18cm</span>
                <span class="so-price">€9.99/letter</span>
              </button>
            </div>
          </div>

          <div class="control-group">
            <span class="label" id="nb-theme-label">Colour theme</span>
            <div class="chips" role="group" aria-labelledby="nb-theme-label" data-themes></div>
            <div class="swatches" data-onecolour hidden role="group" aria-label="Pick one colour"></div>
          </div>

          <div class="control-group">
            <span class="label">Make it special <span class="extras-sub">optional</span></span>
            <div class="extras-list">
              <button type="button" class="extra-card" data-extra-btn="dots" aria-pressed="false">
                <span class="ec-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="12" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/>
                  </svg>
                </span>
                <span class="ec-body">
                  <span class="ec-name">Decorative Dots</span>
                  <span class="ec-desc">Pack of 10 colourful snap-on studs</span>
                </span>
                <span class="ec-price">+€3</span>
                <span class="ec-toggle"><span class="ect-add">Add</span><span class="ect-added">✓ Added</span></span>
              </button>
              <button type="button" class="extra-card" data-extra-btn="giftBox" aria-pressed="false">
                <span class="ec-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 12v10H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/>
                    <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
                  </svg>
                </span>
                <span class="ec-body">
                  <span class="ec-name">Premium Gift Box <span class="ec-rec" data-gift-rec hidden>Recommended</span></span>
                  <span class="ec-desc">Name printed on the lid · gift-ready packaging</span>
                </span>
                <span class="ec-price">+€4.95</span>
                <span class="ec-toggle"><span class="ect-add">Add</span><span class="ect-added">✓ Added</span></span>
              </button>
            </div>
          </div>

          <div class="builder-checkout">
            <div class="price-block">
              <span class="pb-now" data-price>€0</span>
              <span class="pb-break" data-breakdown>Add a letter to see the price</span>
            </div>
            <button class="btn btn--cta btn--lg" data-add disabled aria-disabled="true">
              <span data-add-label>Add to basket</span>
            </button>
          </div>
        </div>

        <div class="recolour-pop" data-pop role="dialog" aria-label="Recolour this letter" hidden>
          <div class="rp-title">
            <span data-pop-title>Recolour "A"</span>
            <button type="button" data-pop-close aria-label="Close">✕</button>
          </div>
          <div class="swatches" data-pop-swatches></div>
        </div>
      </div>`;

    this.el = {
      stage:       q('[data-stage]',        this.host),
      scaler:      q('[data-scaler]',       this.host),
      name:        q('[data-name]',         this.host),
      empty:       q('[data-empty]',        this.host),
      input:       q('[data-input]',        this.host),
      counter:     q('[data-counter]',      this.host),
      hint:        q('[data-hint]',         this.host),
      sizes:       q('[data-sizes]',        this.host),
      themes:      q('[data-themes]',       this.host),
      onecolour:   q('[data-onecolour]',    this.host),
      price:       q('[data-price]',        this.host),
      breakdown:   q('[data-breakdown]',    this.host),
      add:         q('[data-add]',          this.host),
      addLabel:    q('[data-add-label]',    this.host),
      pop:         q('[data-pop]',          this.host),
      popTitle:    q('[data-pop-title]',    this.host),
      popSwatches: q('[data-pop-swatches]', this.host),
      popClose:    q('[data-pop-close]',    this.host),
      extrasCards: qa<HTMLButtonElement>('[data-extra-btn]', this.host),
      giftRec:     q('[data-gift-rec]',     this.host),
    };

    // Size selector
    qa<HTMLButtonElement>('[data-size]', this.el.sizes).forEach((btn) => {
      btn.addEventListener('click', () => this.setSize(btn.dataset.size as LetterSize));
    });

    // Theme chips
    Object.entries(THEMES).forEach(([key, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.theme = key;
      b.setAttribute('aria-pressed', String(key === s.theme));
      const sw = t.swatch.slice(0, 5).map((c) => `<i style="background:${c}"></i>`).join('');
      b.innerHTML = `<span class="swatch-row" aria-hidden="true">${sw}</span>${t.label}`;
      b.addEventListener('click', () => this.setTheme(key));
      this.el.themes.appendChild(b);
    });

    // One-colour picker — all 13 colours
    PICKER.forEach((c) => {
      const b = swatchBtn(c, () => {
        this.state.oneColor = c;
        this.markOne(c);
        this.render();
      });
      b.dataset.one = c;
      this.el.onecolour.appendChild(b);
    });

    // Events
    // Extra add-on toggles
    this.el.extrasCards.forEach((card) => {
      card.addEventListener('click', () => {
        const key = card.dataset.extraBtn as 'dots' | 'giftBox';
        this.state.addons[key] = !this.state.addons[key];
        card.setAttribute('aria-pressed', String(this.state.addons[key]));
        this.updatePrice();
      });
    });

    this.el.input.addEventListener('input', (e) => this.setText((e.target as HTMLInputElement).value));
    this.el.add.addEventListener('click', () => this.addToCart());
    this.el.popClose.addEventListener('click', () => this.closePop());
    document.addEventListener('click', (e) => {
      if (this.el.pop.hidden) return;
      const target = e.target as Element;
      if (!this.el.pop.contains(target) && !target.closest('.brick-letter')) this.closePop();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closePop(); });
    this.ro.observe(this.el.stage);
  }

  /* ---- state setters ---- */
  setText(v: string, animate = true): void {
    // A-Z and 0-9 only (spec: no spaces or special chars for brick letters)
    const up = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, this.MAX);
    this.state.text = up;
    if (this.el.input.value !== up) this.el.input.value = up;
    this.state.overrides = {};
    this.el.counter.textContent = `${up.length}/${this.MAX}`;
    this.closePop();
    this.render(animate);
  }

  setSize(size: LetterSize): void {
    this.state.size = size;
    this.state.cell = SIZE_CELL_PX[size];
    qa<HTMLButtonElement>('[data-size]', this.el.sizes).forEach((btn) =>
      btn.setAttribute('aria-pressed', String(btn.dataset.size === size))
    );
    this.render(false);
  }

  setTheme(key: string): void {
    this.state.theme = key;
    this.state.overrides = {};
    qa<HTMLButtonElement>('.chip', this.el.themes).forEach((c) =>
      c.setAttribute('aria-pressed', String(c.dataset.theme === key))
    );
    this.el.onecolour.hidden = !THEMES[key]?.single;
    if (THEMES[key]?.single) this.markOne(this.state.oneColor);
    this.render();
  }

  private markOne(c: string): void {
    qa<HTMLButtonElement>('[data-one]', this.el.onecolour).forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.one === c))
    );
  }

  /* ---- render ---- */
  private chars(): string[] {
    return [...this.state.text];
  }

  private letterColor(idx: number): string {
    if (this.state.overrides[idx] != null) return this.state.overrides[idx];
    return themeColor(this.state.theme, idx, this.state.oneColor);
  }

  render(animate = true): void {
    const chars = this.chars();
    const builder = q('[data-builder]', this.host);
    builder.style.setProperty('--cell', this.state.cell + 'px');

    const hasContent = chars.length > 0;
    this.el.empty.hidden = hasContent;
    this.el.name.style.display = hasContent ? '' : 'none';

    this.el.hint.classList.remove('is-error');
    this.el.input.classList.remove('is-error');
    this.el.hint.innerHTML = `Letters and numbers only (A–Z, 0–9). Tap any letter to recolour it.`;

    this.el.name.innerHTML = '';
    let letterIdx = 0;
    let popDelay = 0;
    const doAnim = animate && !reduceMotion();

    chars.forEach((ch) => {
      const idx = letterIdx++;
      const color = this.letterColor(idx);
      const supported = isSupported(ch);
      const grid = FONT[ch] || [];

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brick-letter' + (supported ? '' : ' is-unknown');
      btn.style.setProperty('--bc', color);
      btn.dataset.idx = String(idx);
      btn.dataset.char = ch;
      btn.setAttribute('aria-label', `Letter ${ch}. Tap to recolour.`);
      if (!supported) {
        btn.style.opacity = '.4';
        btn.style.boxShadow = 'inset 0 0 0 2px var(--line-strong)';
      }

      grid.forEach((row) => {
        [...row].forEach((cellChar) => {
          const cell = document.createElement('span');
          const on = cellChar === '1' && supported;
          cell.className = 'brick-cell' + (on ? ' is-on' : '');
          if (on && doAnim) {
            cell.classList.add('pop');
            cell.style.setProperty('--d', popDelay + 'ms');
            popDelay += 7;
          }
          btn.appendChild(cell);
        });
      });

      btn.addEventListener('click', () => this.openPop(idx, ch, btn));
      this.el.name.appendChild(btn);
    });

    this.el.name.setAttribute(
      'aria-label',
      hasContent ? `The word ${this.state.text.trim()} built in coloured bricks` : 'Empty brick canvas'
    );

    this.updatePrice();
    this.fit();
  }

  private fit(): void {
    const name = this.el.name, stage = this.el.stage;
    (name.style as CSSStyleDeclaration & { zoom: string }).zoom = '1';
    if (!this.el.empty.hidden) return;
    const natW = name.offsetWidth;
    const cs   = getComputedStyle(stage);
    const avail = stage.clientWidth
      - parseFloat(cs.paddingLeft)
      - parseFloat(cs.paddingRight);
    if (natW <= avail) return;
    const scale = avail / natW;
    (name.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale);
  }

  /* ---- pricing ---- */
  private countLetters(): number {
    return this.chars().filter((c) => isSupported(c)).length;
  }

  private price(): number {
    return priceLetters(this.countLetters(), this.state.size);
  }

  private addonCost(): number {
    return (this.state.addons.dots ? 3 : 0) + (this.state.addons.giftBox ? 4.95 : 0);
  }

  private updatePrice(): void {
    const n = this.countLetters();
    const p = this.price();
    const extra = this.addonCost();
    const total = p + extra;
    const disc = discountPct(n);

    this.el.price.textContent = `€${total.toFixed(2).replace(/\.00$/, '')}`;

    if (n === 0) {
      this.el.breakdown.textContent = 'Add a letter to see the price';
    } else {
      const parts: string[] = [];
      if (disc > 0) {
        parts.push(`${n} letters · ${disc}% off`);
      } else {
        parts.push(`${n} letter${n > 1 ? 's' : ''} · ${SIZE_LABELS[this.state.size]}`);
      }
      if (this.state.addons.dots) parts.push('Dots +€3');
      if (this.state.addons.giftBox) parts.push('Gift Box +€4.95');
      this.el.breakdown.textContent = parts.join(' · ');
    }

    // Show "Recommended" badge on gift box when order is 4+ letters (likely a gift)
    this.el.giftRec.hidden = n < 4;

    const ok = n > 0;
    this.el.add.disabled = !ok;
    this.el.add.setAttribute('aria-disabled', String(!ok));
  }

  /* ---- per-letter recolour popover ---- */
  private openPop(idx: number, ch: string, btn: HTMLButtonElement): void {
    const pop = this.el.pop;
    this.activeLetter = idx;
    qa('.brick-letter', this.el.name).forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    this.el.popTitle.textContent = `Recolour "${ch}"`;

    this.el.popSwatches.innerHTML = '';
    PICKER.forEach((c) => {
      const b = swatchBtn(c, () => {
        this.state.overrides[idx] = c;
        this.render(false);
        this.reopenActive();
      });
      if (this.letterColor(idx).toLowerCase() === c.toLowerCase())
        b.setAttribute('aria-pressed', 'true');
      this.el.popSwatches.appendChild(b);
    });

    pop.hidden = false;
    pop.classList.add('is-open');

    const builder = q('[data-builder]', this.host);
    const bRect = builder.getBoundingClientRect();
    const lRect = btn.getBoundingClientRect();
    const popW = 260;
    let left = lRect.left - bRect.left + lRect.width / 2 - popW / 2;
    left = Math.max(12, Math.min(left, builder.clientWidth - popW - 12));
    const top = lRect.bottom - bRect.top + 10;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    const arrow = lRect.left - bRect.left + lRect.width / 2 - left;
    pop.style.setProperty('--arrow', Math.max(16, Math.min(arrow, popW - 16)) + 'px');
  }

  private reopenActive(): void {
    if (this.activeLetter == null) return;
    const btn = q<HTMLButtonElement>(`.brick-letter[data-idx="${this.activeLetter}"]`, this.el.name);
    if (btn) {
      btn.classList.add('is-active');
      const cur = this.letterColor(this.activeLetter).toLowerCase();
      qa<HTMLButtonElement>('[aria-pressed]', this.el.popSwatches).forEach((b) =>
        b.setAttribute('aria-pressed', String((b.dataset.c?.toLowerCase() ?? '') === cur))
      );
    }
  }

  closePop(): void {
    this.el.pop.classList.remove('is-open');
    this.el.pop.hidden = true;
    this.activeLetter = null;
    qa('.brick-letter', this.el.name).forEach((b) => b.classList.remove('is-active'));
  }

  /* ---- add to cart ---- */
  private buildPayload(): CartItem {
    const colours: { char: string; colour: string }[] = [];
    let idx = 0;
    this.chars().forEach((c) => {
      if (isSupported(c)) colours.push({ char: c, colour: this.letterColor(idx++) });
    });
    return {
      id: 'build_' + Date.now().toString(36),
      type: 'custom-name',
      name: this.state.text.trim(),
      size: this.state.size,
      sizeLabel: `${SIZE_LABELS[this.state.size]} (${SIZE_MM[this.state.size]}cm)`,
      theme: this.state.theme,
      oneColour: THEMES[this.state.theme]?.single ? this.state.oneColor : null,
      brickSizePx: this.state.cell,
      letters: colours,
      brickCount: this.brickCount(),
      price: this.price() + this.addonCost(),
      currency: 'EUR',
      qty: 1,
      createdAt: new Date().toISOString(),
      addons: { ...this.state.addons },
    };
  }

  private brickCount(): number {
    let n = 0;
    this.chars().forEach((c) => {
      if (isSupported(c)) n += countFilledCells(c);
    });
    return n;
  }

  private addToCart(): void {
    if (this.el.add.disabled) return;
    const btn = this.el.add;
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>Adding…</span>`;
    const payload = this.buildPayload();
    setTimeout(() => {
      addToCart(payload);
      btn.classList.remove('is-loading');
      btn.innerHTML = `<span data-add-label>Add to basket</span>`;
      this.el.addLabel = q('[data-add-label]', this.host);
      (window as Window & { TogToast?: (p: CartItem) => void }).TogToast?.(payload);
    }, 750);
  }
}

/* auto-init on all [data-name-builder] hosts */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll<HTMLElement>('[data-name-builder]').forEach((h) => new NameBuilder(h));
});
