import { FONT } from './brickfont';
import { addToCart } from './cart';
import type { CartItem } from './types';

function q<T extends Element = Element>(sel: string, ctx: Element | Document = document): T {
  return (ctx as Element).querySelector<T>(sel) as T;
}

const PLATE_COLOURS: { label: string; value: string }[] = [
  { label: 'Red',       value: '#CC3B2A' },
  { label: 'Blue',      value: '#1D4ED8' },
  { label: 'Yellow',    value: '#FACC15' },
  { label: 'Green',     value: '#16A34A' },
  { label: 'Dark Grey', value: '#374151' },
  { label: 'White',     value: '#F5F5F5' },
];

const TEXT_COLOURS: { label: string; value: string }[] = [
  { label: 'Yellow',    value: '#FACC15' },
  { label: 'White',     value: '#FFFFFF' },
  { label: 'Red',       value: '#CC3B2A' },
  { label: 'Blue',      value: '#1D4ED8' },
  { label: 'Green',     value: '#16A34A' },
  { label: 'Dark Grey', value: '#374151' },
];

const DECO_COLOURS = ['#CC3B2A','#1D4ED8','#FACC15','#16A34A','#7C3AED','#F97316'];

const PLATE_W = 32; // studs wide
const PLATE_H = 12; // studs tall

interface SignState {
  text: string;
  plateColour: string;
  textColour: string;
}

export class DoorSignBuilder {
  private host: HTMLElement;
  private state: SignState;
  private MAX = 12;

  constructor(host: HTMLElement) {
    this.host = host;
    this.state = {
      text: host.dataset.initial || 'CHARLIE',
      plateColour: PLATE_COLOURS[0].value,
      textColour: TEXT_COLOURS[0].value,
    };
    this.build();
    this.render();
  }

  private build(): void {
    this.host.innerHTML = `
      <div class="sign-builder" data-sign-builder>

        <div class="sign-stage" data-sign-stage>
          <div class="sign-perspective-wrap" data-sign-perspective>
            <div class="sign-plate" data-sign-plate>
              <div class="sign-text-row" data-sign-text></div>
              <div class="sign-decos" data-sign-decos aria-hidden="true"></div>
            </div>
          </div>
        </div>

        <div class="builder-controls">
          <div class="control-group">
            <div class="control-head">
              <label class="label" for="sb-text">Name for your sign</label>
              <span class="input-counter" data-sb-counter>0/${this.MAX}</span>
            </div>
            <div class="input-wrap">
              <input id="sb-text" class="input" data-sb-input type="text" inputmode="text"
                maxlength="${this.MAX}" autocomplete="off" placeholder="e.g. Charlie"
                value="${this.state.text}" />
              <span class="input-counter" data-sb-counter-abs style="position:absolute;right:14px;top:50%;transform:translateY(-50%)">${this.state.text.length}/${this.MAX}</span>
            </div>
          </div>

          <div class="control-group">
            <span class="label" id="sb-plate-label">Plate colour</span>
            <div class="swatches" role="group" aria-labelledby="sb-plate-label" data-sb-plate-swatches>
              ${PLATE_COLOURS.map((c, i) => `
                <button type="button" class="swatch" data-plate-c="${c.value}"
                  style="background:${c.value}"
                  aria-label="${c.label}"
                  aria-pressed="${i === 0 ? 'true' : 'false'}"></button>
              `).join('')}
            </div>
          </div>

          <div class="control-group">
            <span class="label" id="sb-text-label">Text colour</span>
            <div class="swatches" role="group" aria-labelledby="sb-text-label" data-sb-text-swatches>
              ${TEXT_COLOURS.map((c, i) => `
                <button type="button" class="swatch" data-text-c="${c.value}"
                  style="background:${c.value}"
                  aria-label="${c.label}"
                  aria-pressed="${i === 0 ? 'true' : 'false'}"></button>
              `).join('')}
            </div>
          </div>

          <div class="builder-checkout">
            <div class="price-block">
              <span class="pb-now" data-sb-price>€12</span>
              <span class="pb-break" data-sb-breakdown>€12 base + €2 per letter</span>
            </div>
            <button class="btn btn--cta btn--lg" data-sb-add aria-disabled="false">
              <span>Add to basket</span>
            </button>
          </div>
        </div>
      </div>`;

    // Events
    const input = q<HTMLInputElement>('[data-sb-input]', this.host);
    input.addEventListener('input', () => {
      this.state.text = input.value.toUpperCase().slice(0, this.MAX);
      input.value = this.state.text;
      this.render();
    });

    this.host.querySelectorAll<HTMLButtonElement>('[data-plate-c]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.plateColour = btn.dataset.plateC!;
        this.host.querySelectorAll('[data-plate-c]').forEach((b) =>
          b.setAttribute('aria-pressed', String((b as HTMLButtonElement).dataset.plateC === this.state.plateColour))
        );
        this.render();
      });
    });

    this.host.querySelectorAll<HTMLButtonElement>('[data-text-c]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.textColour = btn.dataset.textC!;
        this.host.querySelectorAll('[data-text-c]').forEach((b) =>
          b.setAttribute('aria-pressed', String((b as HTMLButtonElement).dataset.textC === this.state.textColour))
        );
        this.render();
      });
    });

    q('[data-sb-add]', this.host).addEventListener('click', () => this.addToCart());
  }

  render(): void {
    const plate = q('[data-sign-plate]', this.host);
    const textRow = q('[data-sign-text]', this.host);
    const decos = q('[data-sign-decos]', this.host);

    // Update plate colour and stud pattern
    plate.style.cssText = `
      background-color: ${this.state.plateColour};
      background-image: radial-gradient(circle at 50% 50%, rgba(255,255,255,.40) 28%, transparent 32%);
      background-size: 14px 14px;
    `;

    // Render name in brick font
    const cell = 14; // px per brick cell for sign
    const text = this.state.text.replace(/[^A-Z0-9\s]/g, '');

    textRow.innerHTML = '';
    textRow.style.cssText = `
      display: flex;
      gap: ${cell}px;
      align-items: flex-start;
      justify-content: center;
    `;

    [...text].forEach((ch) => {
      if (ch === ' ') {
        const sp = document.createElement('span');
        sp.style.width = cell * 2 + 'px';
        textRow.appendChild(sp);
        return;
      }
      const rows = FONT[ch.toUpperCase()];
      if (!rows) return;
      const g = document.createElement('div');
      g.style.cssText = `
        display: grid;
        grid-template-columns: repeat(5, ${cell}px);
        grid-template-rows: repeat(7, ${cell}px);
        gap: ${Math.max(1, cell * 0.08)}px;
        --bc: ${this.state.textColour};
      `;
      rows.forEach((row) => {
        [...row].forEach((c) => {
          const d = document.createElement('span');
          const on = c === '1';
          d.className = 'brick-cell' + (on ? ' is-on sign-text-cell' : '');
          if (on) {
            d.style.cssText = `
              background: ${this.state.textColour};
              box-shadow:
                inset 0 3px 0 rgba(255,255,255,.55),
                inset 0 -4px 0 rgba(0,0,0,.28),
                2px 3px 0 color-mix(in srgb, ${this.state.textColour} 50%, #000),
                0 1px 2px rgba(0,0,0,.25);
            `;
          }
          g.appendChild(d);
        });
      });
      textRow.appendChild(g);
    });

    // Decorative bricks on edges
    decos.innerHTML = '';
    const decoPositions = [
      { top: '8px',  left:  '14px', w: 2, h: 1 },
      { top: '8px',  right: '34px', w: 1, h: 2 },
      { top: '8px',  left:  '50%',  w: 2, h: 1 },
      { bottom: '8px', left: '28px', w: 2, h: 1 },
      { bottom: '8px', right: '18px', w: 1, h: 2 },
    ];
    decoPositions.forEach((pos, i) => {
      const brick = document.createElement('span');
      const colour = DECO_COLOURS[i % DECO_COLOURS.length];
      const w = (pos.w * 14 + (pos.w - 1) * 2);
      const h = (pos.h * 14 + (pos.h - 1) * 2);
      Object.assign(brick.style, {
        position: 'absolute',
        width: w + 'px',
        height: h + 'px',
        borderRadius: '4px',
        background: colour,
        boxShadow: `inset 0 2px 0 rgba(255,255,255,.45), inset 0 -3px 0 rgba(0,0,0,.22)`,
        ...pos,
      });
      decos.appendChild(brick);
    });

    // Fit text row within the plate using zoom
    this.fitText(textRow, plate);

    // Update price
    const n = Math.max(1, [...text].filter(c => c !== ' ').length);
    const price = 12 + 2 * n;
    const priceEl = q('[data-sb-price]', this.host);
    const breakdownEl = q('[data-sb-breakdown]', this.host);
    if (priceEl) priceEl.textContent = `€${price}`;
    if (breakdownEl) breakdownEl.textContent = `€12 base + €2 × ${n} letter${n !== 1 ? 's' : ''}`;

    // Counter
    const counter = q('[data-sb-counter]', this.host);
    const counterAbs = q('[data-sb-counter-abs]', this.host);
    if (counter) counter.textContent = `${this.state.text.length}/${this.MAX}`;
    if (counterAbs) counterAbs.textContent = `${this.state.text.length}/${this.MAX}`;
  }

  private fitText(textRow: HTMLElement, plate: HTMLElement): void {
    // Reset zoom to measure natural width
    (textRow.style as CSSStyleDeclaration & { zoom: string }).zoom = '1';
    const natW = textRow.offsetWidth;
    const avail = plate.clientWidth - 32; // 16px padding each side
    if (natW <= avail) return;
    const scale = avail / natW;
    (textRow.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale);
  }

  private addToCart(): void {
    const text = this.state.text.trim();
    if (!text) return;
    const n = Math.max(1, [...text.replace(/\s/g,'')].length);
    const price = 12 + 2 * n;

    const btn = q<HTMLButtonElement>('[data-sb-add]', this.host);
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>Adding…</span>`;

    const payload: CartItem = {
      id: 'sign_' + Date.now().toString(36),
      type: 'door-sign',
      name: text,
      theme: 'sign',
      oneColour: this.state.plateColour,
      brickSizePx: 14,
      sizeLabel: 'Door Sign',
      letters: [...text].filter(c => c !== ' ').map((c) => ({ char: c, colour: this.state.textColour })),
      brickCount: n * 35,
      price,
      currency: 'EUR',
      qty: 1,
      createdAt: new Date().toISOString(),
      plateColour: this.state.plateColour,
      textColour: this.state.textColour,
    };

    setTimeout(() => {
      addToCart(payload);
      btn.classList.remove('is-loading');
      btn.innerHTML = `<span>Add to basket</span>`;
      (window as Window & { TogToast?: (p: CartItem) => void }).TogToast?.(payload);
    }, 750);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll<HTMLElement>('[data-sign-builder]').forEach((h) => new DoorSignBuilder(h));
});
