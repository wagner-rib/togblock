export interface Theme {
  label: string;
  swatch: string[];
  single?: boolean;
  palette?: string[];
  color?: (i: number) => string;
}

// 13-colour filament palette (exact enum keys match DB/API shape)
export const COLOURS: Record<string, { label: string; hex: string }> = {
  blue:        { label: 'Blue',        hex: '#1D4ED8' },
  red:         { label: 'Red',         hex: '#CC3B2A' },
  yellow:      { label: 'Yellow',      hex: '#F2C200' },
  green:       { label: 'Green',       hex: '#169B62' },
  black:       { label: 'Black',       hex: '#1F2937' },
  white:       { label: 'White',       hex: '#F5F5F5' },
  pink:        { label: 'Pink',        hex: '#F472B6' },
  sage:        { label: 'Sage',        hex: '#7FB69A' },
  sky_blue:    { label: 'Sky Blue',    hex: '#60A5FA' },
  dusty_pink:  { label: 'Dusty Pink',  hex: '#F9A8D4' },
  terracotta:  { label: 'Terracotta',  hex: '#C26D3E' },
  silk_gold:   { label: 'Silk Gold',   hex: '#D4AF37' },
  silk_silver: { label: 'Silk Silver', hex: '#C0C0C0' },
};

export const THEMES: Record<string, Theme> = {
  rainbow: {
    label: 'Rainbow',
    swatch: ['#CC3B2A', '#F2C200', '#169B62', '#1D4ED8', '#F472B6', '#C26D3E'],
    color: (i) => {
      const palette = ['#CC3B2A','#F2C200','#169B62','#1D4ED8','#F472B6','#C26D3E','#60A5FA','#D4AF37'];
      return palette[i % palette.length];
    },
  },
  irish: {
    label: 'Irish',
    swatch: ['#169B62', '#C26D3E', '#7FB69A', '#F2C200'],
    palette: ['#169B62', '#C26D3E', '#7FB69A', '#F2C200'],
  },
  pastel: {
    label: 'Pastel',
    swatch: ['#F9A8D4', '#60A5FA', '#F472B6', '#7FB69A', '#F2C200'],
    palette: ['#F9A8D4', '#60A5FA', '#F472B6', '#7FB69A', '#F2C200'],
  },
  classic: {
    label: 'Classic',
    swatch: ['#CC3B2A', '#1D4ED8', '#F2C200', '#169B62'],
    palette: ['#CC3B2A', '#1D4ED8', '#F2C200', '#169B62'],
  },
  one: {
    label: 'One colour',
    swatch: ['#1D4ED8'], // blue: the default letter colour
    single: true,
  },
};

export function themeColor(key: string, idx: number, oneColor: string): string {
  const t = THEMES[key];
  if (!t) return oneColor;
  if (t.single) return oneColor;
  if (t.color) return t.color(idx);
  if (t.palette) return t.palette[idx % t.palette.length];
  return oneColor;
}

// Full 13-colour picker (hex array for recolour popover)
export const PICKER = Object.values(COLOURS).map((c) => c.hex);

// ── Pricing functions ────────────────────────────────────────────

// Two sizes, matching letter_font.py: 'standard' = 144mm (4 stud rows per arm),
// 'statement' = its 'large', 184mm (5 rows per arm), sold as Premium.
export type LetterSize = 'standard' | 'statement';

const SIZE_BASE: Record<LetterSize, number> = { standard: 7.99, statement: 9.99 };
export const SIZE_LABELS: Record<LetterSize, string> = {
  standard: 'Standard', statement: 'Premium',
};

export const SIZE_MM: Record<LetterSize, number> = {
  standard: 14, statement: 18,
};

// Pixel cell size for the builder preview (proportional to physical size)
export const SIZE_CELL_PX: Record<LetterSize, number> = {
  standard: 18, statement: 22,
};

export function priceLetters(n: number, size: LetterSize): number {
  if (n === 0) return 0;
  const base = SIZE_BASE[size];
  const disc = n >= 7 ? 0.20 : n >= 4 ? 0.15 : n >= 3 ? 0.10 : n >= 2 ? 0.05 : 0;
  return Math.round(base * n * (1 - disc) * 100) / 100;
}

// Optional extras on a brick-letter set (euros). Shared by the builder and the
// checkout API, which re-prices every item server-side.
export const ADDON_PRICES = { dots: 3, giftBox: 4.95 } as const;
export type Addons = { dots: boolean; giftBox: boolean };

export function addonCost(addons: Partial<Addons> | undefined): number {
  return (addons?.dots ? ADDON_PRICES.dots : 0) + (addons?.giftBox ? ADDON_PRICES.giftBox : 0);
}

export function discountPct(n: number): number {
  return n >= 7 ? 20 : n >= 4 ? 15 : n >= 3 ? 10 : n >= 2 ? 5 : 0;
}

export type SignShape = 'rectangle' | 'arch' | 'rounded';

export function priceDoorSign(
  letterCount: number,
  hasShapeAddon: boolean,
  isTwoTone: boolean,
): number {
  let p = 25 + 4 * letterCount;
  if (hasShapeAddon) p += 5;
  if (isTwoTone) p += 3;
  return p;
}

