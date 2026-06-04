import { FONT, isSupported, countFilledCells } from './brickfont';
import { THEMES, themeColor, PICKER } from './themes';
import { addToCart, loadCart, saveCart } from './cart';
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
  theme: string;
  cell: number;
  oneColor: string;
  overrides: Record<number, string>;
}

export class NameBuilder {
  private host: HTMLElement;
  private state: BuilderState;
  private MAX = 14;
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
    themes: HTMLElement;
    onecolour: HTMLElement;
    size: HTMLInputElement;
    sizeval: HTMLElement;
    price: HTMLElement;
    breakdown: HTMLElement;
    add: HTMLButtonElement;
    addLabel: HTMLElement;
    pop: HTMLElement;
    popTitle: HTMLElement;
    popSwatches: HTMLElement;
    popClose: HTMLButtonElement;
  };

  constructor(host: HTMLElement) {
    this.host = host;
    this.state = {
      text: host.dataset.initial || '',
      theme: 'irish',
      cell: 22,
      oneColor: '#169B62',
      overrides: {},
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
            <p class="field-hint" id="nb-hint" data-hint>Letters, numbers, space and - &amp; ! ? . work. Tap any letter to recolour it.</p>
          </div>

          <div class="control-group">
            <span class="label" id="nb-theme-label">Colour theme</span>
            <div class="chips" role="group" aria-labelledby="nb-theme-label" data-themes></div>
            <div class="swatches" data-onecolour hidden role="group" aria-label="Pick one colour"></div>
          </div>

          <div class="control-group">
            <div class="control-head">
              <label class="label" for="nb-size">Brick size</label>
              <span class="val" data-sizeval>Medium</span>
            </div>
            <div class="slider-row">
              <input id="nb-size" class="slider" data-size type="range" min="14" max="34" step="2" value="${s.cell}"
                aria-valuetext="Medium bricks" />
            </div>
            <div class="size-ticks"><span>Small</span><span>Medium</span><span>Large</span></div>
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
      stage:      q('[data-stage]',       this.host),
      scaler:     q('[data-scaler]',      this.host),
      name:       q('[data-name]',        this.host),
      empty:      q('[data-empty]',       this.host),
      input:      q('[data-input]',       this.host),
      counter:    q('[data-counter]',     this.host),
      hint:       q('[data-hint]',        this.host),
      themes:     q('[data-themes]',      this.host),
      onecolour:  q('[data-onecolour]',   this.host),
      size:       q('[data-size]',        this.host),
      sizeval:    q('[data-sizeval]',     this.host),
      price:      q('[data-price]',       this.host),
      breakdown:  q('[data-breakdown]',   this.host),
      add:        q('[data-add]',         this.host),
      addLabel:   q('[data-add-label]',   this.host),
      pop:        q('[data-pop]',         this.host),
      popTitle:   q('[data-pop-title]',   this.host),
      popSwatches:q('[data-pop-swatches]',this.host),
      popClose:   q('[data-pop-close]',   this.host),
    };

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

    // One-colour picker
    PICKER.slice(0, 9).forEach((c) => {
      const b = swatchBtn(c, () => {
        this.state.oneColor = c;
        this.markOne(c);
        this.render();
      });
      b.dataset.one = c;
      this.el.onecolour.appendChild(b);
    });

    // Events
    this.el.input.addEventListener('input', (e) => this.setText((e.target as HTMLInputElement).value));
    this.el.size.addEventListener('input', (e) => this.setSize(+(e.target as HTMLInputElement).value));
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
    const up = v.toUpperCase().slice(0, this.MAX);
    this.state.text = up;
    if (this.el.input.value !== up) this.el.input.value = up;
    this.state.overrides = {};
    this.el.counter.textContent = `${up.length}/${this.MAX}`;
    this.closePop();
    this.render(animate);
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

  setSize(px: number): void {
    this.state.cell = px;
    const label = px <= 18 ? 'Small' : px >= 30 ? 'Large' : 'Medium';
    this.el.sizeval.textContent = label;
    this.el.size.setAttribute('aria-valuetext', label + ' bricks');
    q('[data-builder]', this.host).style.setProperty('--cell', px + 'px');
    this.fit();
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

    const hasContent = chars.some((c) => c !== ' ');
    this.el.empty.hidden = hasContent;
    this.el.name.style.display = hasContent ? '' : 'none';

    const bad = [...new Set(chars.filter((c) => !isSupported(c)))];
    if (bad.length) {
      this.el.hint.classList.add('is-error');
      this.el.input.classList.add('is-error');
      this.el.hint.textContent = `We can't build ${bad.map((b) => `"${b}"`).join(', ')} yet — try letters, numbers, space or - & ! ? .`;
    } else {
      this.el.hint.classList.remove('is-error');
      this.el.input.classList.remove('is-error');
      this.el.hint.innerHTML = `Letters, numbers, space and - &amp; ! ? . work. Tap any letter to recolour it.`;
    }

    this.el.name.innerHTML = '';
    let letterIdx = 0;
    let popDelay = 0;
    const doAnim = animate && !reduceMotion();

    chars.forEach((ch) => {
      if (ch === ' ') {
        const sp = document.createElement('span');
        sp.style.width = 'calc(var(--cell) * 2.4)';
        sp.setAttribute('aria-hidden', 'true');
        this.el.name.appendChild(sp);
        return;
      }
      const idx = letterIdx++;
      const color = this.letterColor(idx);
      const supported = isSupported(ch);
      const grid = FONT[ch] || ['?????','?????','?????','?????','?????','?????','?????'];

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
    const name = this.el.name, scaler = this.el.scaler, stage = this.el.stage;
    if (!this.el.empty.hidden) {
      scaler.style.width = '';
      scaler.style.height = '';
      name.style.transform = '';
      return;
    }
    scaler.style.width = '';
    scaler.style.height = '';
    name.style.transform = 'none';
    const natW = name.offsetWidth;
    const natH = name.offsetHeight;
    const cs = getComputedStyle(stage);
    const avail = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let scale = Math.min(1, avail / natW);
    scale = Math.max(scale, 0.4);
    name.style.transformOrigin = 'top left';
    name.style.transform = `scale(${scale})`;
    scaler.style.width = natW * scale + 'px';
    scaler.style.height = natH * scale + 'px';
  }

  /* ---- pricing: €7 first letter, €5 each additional ---- */
  private countLetters(): number {
    return this.chars().filter((c) => c !== ' ' && isSupported(c)).length;
  }

  private price(): number {
    const n = this.countLetters();
    return n === 0 ? 0 : 7 + 5 * (n - 1);
  }

  private updatePrice(): void {
    const n = this.countLetters();
    const p = this.price();
    this.el.price.textContent = `€${p}`;
    this.el.breakdown.textContent =
      n === 0 ? 'Add a letter to see the price'
      : n === 1 ? '€7 first letter'
      : `€7 first letter + €5 × ${n - 1}`;
    const ok = n > 0 && this.chars().every((c) => c === ' ' || isSupported(c));
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
    const popW = 232;
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
      if (c !== ' ' && isSupported(c)) colours.push({ char: c, colour: this.letterColor(idx++) });
    });
    return {
      id: 'build_' + Date.now().toString(36),
      type: 'custom-name',
      name: this.state.text.trim(),
      theme: this.state.theme,
      oneColour: THEMES[this.state.theme]?.single ? this.state.oneColor : null,
      brickSizePx: this.state.cell,
      sizeLabel: this.state.cell <= 18 ? 'Small' : this.state.cell >= 30 ? 'Large' : 'Medium',
      letters: colours,
      brickCount: this.brickCount(),
      price: this.price(),
      currency: 'EUR',
      qty: 1,
      createdAt: new Date().toISOString(),
    };
  }

  private brickCount(): number {
    let n = 0;
    this.chars().forEach((c) => {
      if (c === ' ' || !isSupported(c)) return;
      n += countFilledCells(c);
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
