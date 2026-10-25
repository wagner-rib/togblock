// Server-side item validation and pricing for checkout. The browser's price is
// never trusted: every item is re-priced from its configuration with the same
// functions the builders use, and the configuration is stored on the order so
// fulfilment knows the size, add-ons, shape and colours that were paid for.
import {
  priceLetters, priceDoorSign, addonCost, SIZE_LABELS,
  type LetterSize, type SignShape, type Addons,
} from '../builder/themes';
import { signFits } from '../builder/signLayout';
import manifest from '../assets/models/manifest.json'; // JSON only: keeps three.js out of the server bundle
import type { Manifest } from '../builder/BuilderPreview';

export type ItemOptions =
  | { kind: 'letters'; size: LetterSize; addons: Addons }
  | { kind: 'door-sign'; shape: SignShape; plateColour: string; textColour: string };

/** What checkout and the saved-basket sync send for each item. */
export interface ItemConfig {
  product_type: 'letters' | 'door-sign';
  custom_name: string;
  quantity: number;
  unit_price: number; // cents, as shown to the customer
  size?: string;
  addons?: Partial<Addons>;
  shape?: string;
  plate_colour?: string;
  text_colour?: string;
}

const SIZES: LetterSize[] = ['standard', 'statement'];
const SHAPES: SignShape[] = ['rectangle']; // the only plate door_sign.py prints
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_QTY = 20;

export type Priced = { ok: true; unitPrice: number; options: ItemOptions } | { ok: false; error: string };

/** Validate one basket item and compute its price in cents. */
export function priceItem(item: ItemConfig): Priced {
  const qty = item.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: 'Invalid quantity' };

  if (item.product_type === 'letters') {
    // Same charset/limit as the builder (A–Z, 0–9, up to 12)
    if (!/^[A-Z0-9]{1,12}$/.test(item.custom_name)) return { ok: false, error: 'A name in your basket has unsupported characters' };
    const size = item.size as LetterSize;
    if ((item.size as string) === 'small') {
      return { ok: false, error: "The Small size is no longer available, so a name in your basket needs rebuilding in Standard or Premium" };
    }
    if (!SIZES.includes(size)) return { ok: false, error: 'Missing letter size' };
    const addons: Addons = { dots: !!item.addons?.dots, giftBox: !!item.addons?.giftBox };
    const euros = priceLetters(item.custom_name.length, size) + addonCost(addons);
    return { ok: true, unitPrice: Math.round(euros * 100), options: { kind: 'letters', size, addons } };
  }

  if (item.product_type === 'door-sign') {
    if (!/^[A-Z0-9 ]{1,12}$/.test(item.custom_name) || !item.custom_name.trim()) {
      return { ok: false, error: 'A door sign in your basket has unsupported text' };
    }
    if (!signFits(item.custom_name, manifest as Manifest)) {
      return { ok: false, error: 'A door sign in your basket is too long to fit on the plate' };
    }
    const shape = item.shape as SignShape;
    if (!SHAPES.includes(shape)) return { ok: false, error: "That sign shape isn't available any more" };
    const plate = item.plate_colour ?? '';
    const text = item.text_colour ?? '';
    if (!HEX.test(plate) || !HEX.test(text)) return { ok: false, error: 'Missing sign colours' };
    // Matches DoorSignBuilder: letters = non-space characters
    const letters = Math.max(1, item.custom_name.replace(/\s/g, '').length);
    const euros = priceDoorSign(letters, shape !== 'rectangle', plate.toLowerCase() !== text.toLowerCase());
    return { ok: true, unitPrice: Math.round(euros * 100), options: { kind: 'door-sign', shape, plateColour: plate, textColour: text } };
  }

  return { ok: false, error: 'Unknown product' };
}

/** One-line summary for admin pages, the print queue and emails. */
export function describeOptions(o: ItemOptions | null | undefined): string {
  if (!o) return '';
  if (o.kind === 'letters') {
    const extras = [o.addons.dots && 'Decorative dots', o.addons.giftBox && 'Gift box'].filter(Boolean);
    // Orders placed before Small was retired keep their size name
    const size = SIZE_LABELS[o.size] ?? ((o.size as string) === 'small' ? 'Small' : String(o.size));
    return [size, ...extras].join(' · ');
  }
  const shape = o.shape[0].toUpperCase() + o.shape.slice(1);
  return `${shape} · plate ${o.plateColour} · text ${o.textColour}`;
}
