import { FONT } from './brickfont';
import { COLOURS, priceDoorSign, type SignShape } from './themes';
import { addToCart } from './cart';
import type { CartItem } from './types';

function q<T extends Element = Element>(sel: string, ctx: Element | Document = document): T {
  return (ctx as Element).querySelector<T>(sel) as T;
}

// 13-colour plate options (subset that works well as plate base colours)
const PLATE_COLOURS = [
  { label: COLOURS.red.label,         value: COLOURS.red.hex },
  { label: COLOURS.blue.label,        value: COLOURS.blue.hex },
  { label: COLOURS.green.label,       value: COLOURS.green.hex },
  { label: COLOURS.yellow.label,      value: COLOURS.yellow.hex },
  { label: COLOURS.black.label,       value: COLOURS.black.hex },
  { label: COLOURS.white.label,       value: COLOURS.white.hex },
  { label: COLOURS.terracotta.label,  value: COLOURS.terracotta.hex },
  { label: COLOURS.sage.label,        value: COLOURS.sage.hex },
];

// 13-colour text options (contrasting colours for raised letters)
const TEXT_COLOURS = [
  { label: COLOURS.yellow.label,      value: COLOURS.yellow.hex },
  { label: COLOURS.white.label,       value: COLOURS.white.hex },
  { label: COLOURS.red.label,         value: COLOURS.red.hex },
  { label: COLOURS.blue.label,        value: COLOURS.blue.hex },
  { label: COLOURS.green.label,       value: COLOURS.green.hex },
  { label: COLOURS.black.label,       value: COLOURS.black.hex },
  { label: COLOURS.silk_gold.label,   value: COLOURS.silk_gold.hex },
  { label: COLOURS.silk_silver.label, value: COLOURS.silk_silver.hex },
  { label: COLOURS.pink.label,        value: COLOURS.pink.hex },
  { label: COLOURS.sky_blue.label,    value: COLOURS.sky_blue.hex },
];

const SHAPE_OPTS: { value: SignShape; label: string; price: string; radius: string }[] = [
  { value: 'rectangle', label: 'Rectangle', price: 'Included',  radius: '8px' },
  { value: 'arch',      label: 'Arch',      price: '+€5',       radius: '50% 50% 8px 8px / 40% 40% 8px 8px' },
  { value: 'rounded',   label: 'Rounded',   price: '+€5',       radius: '40px' },
];

const DECO_COLOURS = [
  COLOURS.red.hex, COLOURS.blue.hex, COLOURS.yellow.hex,
  COLOURS.green.hex, COLOURS.pink.hex, COLOURS.sky_blue.hex,
];

interface SignState {
  text: string;
  plateColour: string;
  textColour: string;
  shape: SignShape;
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
      shape: 'rectangle',
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
            </div>
            <p class="field-hint">Letters, numbers, spaces and apostrophes (up to ${this.MAX} chars).</p>
          </div>

          <div class="control-group">
            <span class="label" id="sb-shape-label">Sign shape</span>
            <div class="size-selector" role="group" aria-labelledby="sb-shape-label" data-sb-shapes>
              ${SHAPE_OPTS.map((s) => `
                <button type="button" class="size-opt" data-shape="${s.value}" aria-pressed="${s.value === 'rectangle' ? 'true' : 'false'}">
                  <span class="so-label">${s.label}</span>
                  <span class="so-price">${s.price}</span>
                </button>`).join('')}
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
                <button type="button" class="swatch ${c.value === '#F5F5F5' ? 'swatch--outlined' : ''}" data-text-c="${c.value}"
                  style="background:${c.value}"
                  aria-label="${c.label}"
                  aria-pressed="${i === 0 ? 'true' : 'false'}"></button>
              `).join('')}
            </div>
          </div>

          <div class="builder-checkout">
            <div class="price-block">
              <span class="pb-now" data-sb-price>€25</span>
              <span class="pb-break" data-sb-breakdown>€25 base + €4 per letter</span>
            </div>
            <button class="btn btn--cta btn--lg" data-sb-add aria-disabled="false">
              <span>Add to basket</span>
            </button>
          </div>
        </div>
      </div>`;

    // Input
    const input = q<HTMLInputElement>('[data-sb-input]', this.host);
    input.addEventListener('input', () => {
      // Allow A-Z, 0-9, space, apostrophe
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9\s']/g, '').slice(0, this.MAX);
      this.state.text = raw;
      input.value = raw;
      this.render();
    });

    // Shape selector
    this.host.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.shape = btn.dataset.shape as SignShape;
        this.host.querySelectorAll('[data-shape]').forEach((b) =>
          b.setAttribute('aria-pressed', String((b as HTMLButtonElement).dataset.shape === this.state.shape))
        );
        this.render();
      });
    });

    // Plate colour
    this.host.querySelectorAll<HTMLButtonElement>('[data-plate-c]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.plateColour = btn.dataset.plateC!;
        this.host.querySelectorAll('[data-plate-c]').forEach((b) =>
          b.setAttribute('aria-pressed', String((b as HTMLButtonElement).dataset.plateC === this.state.plateColour))
        );
        this.render();
      });
    });

    // Text colour
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

    // Shape → border-radius
    const shapeOpt = SHAPE_OPTS.find((s) => s.value === this.state.shape)!;
    plate.style.cssText = `
      background-color: ${this.state.plateColour};
      background-image: radial-gradient(circle at 50% 50%, rgba(255,255,255,.38) 28%, transparent 32%);
      background-size: 14px 14px;
      border-radius: ${shapeOpt.radius};
    `;

    // Render name in brick font
    const cell = 14;
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

    // Decorative bricks
    decos.innerHTML = '';
    const decoPositions = [
      { top: '8px',    left:  '14px', w: 2, h: 1 },
      { top: '8px',    right: '34px', w: 1, h: 2 },
      { bottom: '8px', left:  '28px', w: 2, h: 1 },
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

    this.fitText(textRow, plate);
    this.updatePrice();

    // Counter
    const counter = q('[data-sb-counter]', this.host);
    if (counter) counter.textContent = `${this.state.text.length}/${this.MAX}`;
  }

  private updatePrice(): void {
    const letterCount = Math.max(1, [...this.state.text].filter(c => c !== ' ').length);
    const hasShapeAddon = this.state.shape !== 'rectangle';
    const isTwoTone = this.state.plateColour !== this.state.textColour;
    const price = priceDoorSign(letterCount, hasShapeAddon, isTwoTone);

    const priceEl = q('[data-sb-price]', this.host);
    const breakdownEl = q('[data-sb-breakdown]', this.host);
    if (priceEl) priceEl.textContent = `€${price}`;

    if (breakdownEl) {
      const parts = [`€25 base + €4 × ${letterCount}`];
      if (hasShapeAddon) parts.push('+ €5 shape');
      if (isTwoTone) parts.push('+ €3 two-tone');
      breakdownEl.textContent = parts.join(' ');
    }
  }

  private fitText(textRow: HTMLElement, plate: HTMLElement): void {
    (textRow.style as CSSStyleDeclaration & { zoom: string }).zoom = '1';
    const natW = textRow.offsetWidth;
    const avail = plate.clientWidth - 32;
    if (natW <= avail) return;
    const scale = avail / natW;
    (textRow.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale);
  }

  private addToCart(): void {
    const text = this.state.text.trim();
    if (!text) return;
    const letterCount = Math.max(1, [...text.replace(/\s/g, '')].length);
    const hasShapeAddon = this.state.shape !== 'rectangle';
    const isTwoTone = this.state.plateColour !== this.state.textColour;
    const price = priceDoorSign(letterCount, hasShapeAddon, isTwoTone);

    const btn = q<HTMLButtonElement>('[data-sb-add]', this.host);
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>Adding…</span>`;

    const shapeLabel = SHAPE_OPTS.find((s) => s.value === this.state.shape)?.label ?? 'Rectangle';

    const payload: CartItem = {
      id: 'sign_' + Date.now().toString(36),
      type: 'door-sign',
      name: text,
      shape: this.state.shape,
      theme: 'sign',
      oneColour: this.state.plateColour,
      brickSizePx: 14,
      sizeLabel: `Door Sign · ${shapeLabel}`,
      letters: [...text].filter(c => c !== ' ').map((c) => ({ char: c, colour: this.state.textColour })),
      brickCount: letterCount * 35,
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
