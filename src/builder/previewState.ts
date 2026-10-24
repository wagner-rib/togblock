/* Shareable preview state in the URL hash (3D-FIX-04):
 *   #name=EMMA&theme=rainbow&colours=red,yellow,blue,green&one=green
 * Colours are COLOURS keys, not hex, so links stay short and readable.
 * `colours` lists every letter and is only written when some letter has been
 * recoloured; `one` is only written for the one-colour theme.
 */
import { COLOURS, THEMES, themeColor } from './themes';

const MAX_LETTERS = 12; // same limit and charset as NameBuilder

/** Same sanitising as NameBuilder.setText, so letter indexes (and colours) line up. */
export function previewChars(name: string): string[] {
  return [...name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_LETTERS)];
}

export interface PreviewState {
  name: string;
  theme: string;
  oneColour: string;                     // hex
  letterColours: Record<number, string>; // hex overrides by index
}

const HEX_TO_ID = new Map(Object.entries(COLOURS).map(([id, c]) => [c.hex.toLowerCase(), id]));
const idToHex = (id: string) => COLOURS[id]?.hex;
const hexToId = (hex: string) => HEX_TO_ID.get(hex.toLowerCase());

export function encodeState(s: PreviewState): string {
  const p = new URLSearchParams();
  p.set('name', previewChars(s.name).join(''));
  p.set('theme', s.theme);
  if (s.theme === 'one') p.set('one', hexToId(s.oneColour) ?? 'green');
  if (Object.keys(s.letterColours).length) {
    const ids = previewChars(s.name).map((_, i) =>
      hexToId(s.letterColours[i] ?? themeColor(s.theme, i, s.oneColour)) ?? '');
    p.set('colours', ids.join(','));
  }
  return '#' + p.toString().replace(/%2C/g, ',');
}

/** Parse a hash, falling back to `defaults` for anything missing or unknown. */
export function decodeState(hash: string, defaults: PreviewState): PreviewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const name = previewChars(p.get('name') ?? defaults.name).join('');
  const theme = THEMES[p.get('theme') ?? ''] ? p.get('theme')! : defaults.theme;
  const oneColour = idToHex(p.get('one') ?? '') ?? defaults.oneColour;

  const letterColours: Record<number, string> = {};
  (p.get('colours') ?? '').split(',').slice(0, name.length).forEach((id, i) => {
    const hex = idToHex(id);
    // Keep only real overrides, so a later theme change behaves as on /builder
    if (hex && hex.toLowerCase() !== themeColor(theme, i, oneColour).toLowerCase()) letterColours[i] = hex;
  });
  return { name, theme, oneColour, letterColours };
}
