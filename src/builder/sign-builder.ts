import { FONT } from './brickfont';
import { COLOURS, priceDoorSign } from './themes';
import { addToCart } from './cart';
import type { CartItem } from './types';
import type { SignPreview } from './SignPreview';
import type { ViewMode } from './BuilderPreview';
import type { Manifest } from './BuilderPreview';
import { signFits } from './signLayout';
import manifestJson from '../assets/models/manifest.json';

const MANIFEST = manifestJson as Manifest;

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

// door_sign.py prints one shape: a rectangle with 8mm corner radius
const PLATE_RADIUS = '8px';
// Letters, numbers and spaces only (what door_sign.py can print cleanly)
const SIGN_TEXT = /[^A-Z0-9 ]/g;

const DECO_COLOURS = [
  COLOURS.red.hex, COLOURS.blue.hex, COLOURS.yellow.hex,
  COLOURS.green.hex, COLOURS.pink.hex, COLOURS.sky_blue.hex,
];

interface SignState {
  text: string;
  plateColour: string;
  textColour: string;
}

export class DoorSignBuilder {
  private host: HTMLElement;
  private state: SignState;
  private MAX = 12;
  private preview: SignPreview | null = null;  // 3D preview; null until loaded, or without WebGL2
  private booting: Promise<void> | null = null;
  private viewMode: ViewMode = 'top';

  constructor(host: HTMLElement) {
    this.host = host;
    this.state = {
      text: (host.dataset.initial || 'CHARLIE').toUpperCase().replace(SIGN_TEXT, '').slice(0, 12),
      plateColour: PLATE_COLOURS[0].value,
      textColour: TEXT_COLOURS[0].value,
    };
    this.build();
    this.render();
    this.setup3D();
  }

  private build(): void {
    this.host.innerHTML = `
      <div class="sign-builder" data-sign-builder>

        <div class="sign-stage" data-sign-stage>
          <div class="stage-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="13"/><g><circle cx="17" cy="17" r="5.4"/><circle cx="31" cy="17" r="5.4"/><circle cx="17" cy="31" r="5.4"/><circle cx="31" cy="31" r="5.4"/></g></svg><span>TógBlocks</span></div>
          <canvas class="builder-3d" data-sb-canvas aria-label="3D preview of your door sign. Drag to rotate."></canvas>
          <div class="builder-skel" data-sb-skeleton aria-hidden="true"></div>
          <div class="builder-views" data-sb-views role="group" aria-label="View" hidden>
            <button type="button" data-view="top" aria-pressed="true">Top</button>
            <button type="button" data-view="hero" aria-pressed="false">Angle</button>
            <button type="button" data-view="side" aria-pressed="false">Side</button>
          </div>
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
            <p class="field-hint" data-sb-hint>Letters, numbers and spaces (up to ${this.MAX} characters).</p>
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
      const raw = input.value.toUpperCase().replace(SIGN_TEXT, '').slice(0, this.MAX);
      this.state.text = raw;
      input.value = raw;
      this.render();
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

    this.host.querySelectorAll<HTMLButtonElement>('[data-sb-views] [data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        this.viewMode = b.dataset.view as ViewMode;
        this.host.querySelectorAll('[data-sb-views] [data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.preview?.setSign({ viewMode: this.viewMode });
      }));
  }

  render(): void {
    const plate = q('[data-sign-plate]', this.host);
    const textRow = q('[data-sign-text]', this.host);
    const decos = q('[data-sign-decos]', this.host);

    plate.style.cssText = `
      background-color: ${this.state.plateColour};
      background-image: radial-gradient(circle at 50% 50%, rgba(255,255,255,.38) 28%, transparent 32%);
      background-size: 14px 14px;
      border-radius: ${PLATE_RADIUS};
    `;

    // Render name in brick font
    const cell = 14;
    const text = this.state.text;

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
    this.updateFit();
    this.preview?.setSign({ text: this.state.text, plateColour: this.state.plateColour, textColour: this.state.textColour });
    this.updateSkeleton();

    // Counter
    const counter = q('[data-sb-counter]', this.host);
    if (counter) counter.textContent = `${this.state.text.length}/${this.MAX}`;
  }

  private updatePrice(): void {
    const letterCount = Math.max(1, [...this.state.text].filter(c => c !== ' ').length);
    const isTwoTone = this.state.plateColour !== this.state.textColour;
    const price = priceDoorSign(letterCount, false, isTwoTone);

    const priceEl = q('[data-sb-price]', this.host);
    const breakdownEl = q('[data-sb-breakdown]', this.host);
    if (priceEl) priceEl.textContent = `€${price}`;

    if (breakdownEl) {
      const parts = [`€25 base + €4 × ${letterCount}`];
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
    if (!text || !signFits(text, MANIFEST)) return;
    const letterCount = Math.max(1, [...text.replace(/\s/g, '')].length);
    const isTwoTone = this.state.plateColour !== this.state.textColour;
    const price = priceDoorSign(letterCount, false, isTwoTone);

    const btn = q<HTMLButtonElement>('[data-sb-add]', this.host);
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>Adding…</span>`;


    const payload: CartItem = {
      id: 'sign_' + Date.now().toString(36),
      type: 'door-sign',
      name: text,
      shape: 'rectangle',
      theme: 'sign',
      oneColour: this.state.plateColour,
      brickSizePx: 14,
      sizeLabel: 'Door Sign · Rectangle',
      letters: [...text].filter(c => c !== ' ').map((c) => ({ char: c, colour: this.state.textColour })),
      brickCount: letterCount * 35,
      price,
      currency: 'EUR',
      qty: 1,
      createdAt: new Date().toISOString(),
      plateColour: this.state.plateColour,
      textColour: this.state.textColour,
    };

    const minDelay = new Promise((r) => setTimeout(r, 750)); // keep the "Adding…" beat even when capture is instant
    Promise.all([this.uploadThumbnail(), minDelay]).then(([thumbnailId]) => {
      if (thumbnailId) payload.thumbnailId = thumbnailId;
      addToCart(payload);
      btn.classList.remove('is-loading');
      btn.innerHTML = `<span>Add to basket</span>`;
      (window as Window & { TogToast?: (p: CartItem) => void }).TogToast?.(payload);
    });
  }

  /** Long names hit door_sign.py's 22mm minimum and run off the plate: say so, block the order. */
  private updateFit(): void {
    const hint = q('[data-sb-hint]', this.host);
    const add = q<HTMLButtonElement>('[data-sb-add]', this.host);
    const text = this.state.text.trim();
    const fits = !text || signFits(text, MANIFEST);
    hint.classList.toggle('is-error', !fits);
    hint.textContent = fits
      ? `Letters, numbers and spaces (up to ${this.MAX} characters).`
      : 'That name is too long to fit on the sign. Try a shorter name or fewer wide letters like M and W.';
    add.disabled = !text || !fits;
    add.setAttribute('aria-disabled', String(add.disabled));
  }

  /* ---- 3D preview (same pipeline as the name builder) ---- */

  private setup3D(): void {
    if (!document.createElement('canvas').getContext('webgl2')) return; // keep the flat sign preview
    const stage = q('[data-sign-stage]', this.host);
    stage.classList.add('has-3d', 'is-3d-loading');
    this.updateSkeleton();
    const start = () => {
      if (!this.host.offsetParent) return stage.classList.remove('has-3d', 'is-3d-loading'); // letters tab showing
      this.booting ??= this.boot3D();
    };
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 1500 }) : setTimeout(start, 200));
    if (document.readyState === 'complete') idle();
    else addEventListener('load', idle, { once: true });
  }

  private async boot3D(): Promise<void> {
    const stage = q('[data-sign-stage]', this.host);
    try {
      const { SignPreview } = await import('./SignPreview');
      this.preview = new SignPreview(q<HTMLCanvasElement>('[data-sb-canvas]', this.host), {
        text: this.state.text, plateColour: this.state.plateColour, textColour: this.state.textColour,
        viewMode: this.viewMode,
      }, {
        onReady: () => {
          stage.classList.replace('is-3d-loading', 'is-3d');
          q<HTMLElement>('[data-sb-views]', this.host).hidden = false;
        },
      });
    } catch (err) {
      console.warn('3D preview unavailable, keeping the flat sign preview.', err);
      this.preview = null;
      stage.classList.remove('has-3d', 'is-3d-loading', 'is-3d');
    }
  }

  /** Grey Russo One name shown until the 3D sign is drawn. */
  private updateSkeleton(): void {
    const stage = q('[data-sign-stage]', this.host);
    if (!stage.classList.contains('is-3d-loading')) return;
    const skel = q<HTMLElement>('[data-sb-skeleton]', this.host);
    skel.textContent = this.state.text;
    const len = Math.max(4, this.state.text.length); // the sign keeps short names smaller than the stage
    skel.style.fontSize = `${Math.min((stage.clientWidth * 0.62) / (len * 0.7), stage.clientHeight * 0.2)}px`;
  }

  /** PNG of the sign for the order (3D-FIX-08); undefined if 3D isn't available. */
  private async uploadThumbnail(): Promise<string | undefined> {
    try {
      if (!q('[data-sign-stage]', this.host).classList.contains('has-3d')) return undefined;
      this.booting ??= this.boot3D();
      await this.booting;
      if (!this.preview) return undefined;
      const png = await this.preview.capture();
      const res = await fetch('/api/thumbnails', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
      return res.ok ? (await res.json()).id : undefined;
    } catch (err) {
      console.warn('Design preview not saved; adding to basket without it.', err);
      return undefined;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll<HTMLElement>('[data-sign-builder]').forEach((h) => new DoorSignBuilder(h));
});
