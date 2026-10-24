/* Door-sign layout from door_sign.py (compute_letter_height, build_name_polygon and
 * the perimeter-stud rule), with no 3D dependencies so it can be checked against
 * the Python script directly. */
import type { Manifest } from './BuilderPreview';

// ── door_sign.py design parameters (keep in sync) ──
// door_sign.py sizes the layout on a 240mm box, then build_rounded_rect() buffers
// it by the 8mm corner radius on every side: the printed plate is 256mm wide and
// 16mm taller than "baseplate_height" (door_sign_THOMAS.stl measures 256 × 94.88).
const LAYOUT_WIDTH = 240;                // MAX_BUILD - 16, used for letter sizing
export const PLATE_CORNER = 8;
export const PLATE_WIDTH = LAYOUT_WIDTH + 2 * PLATE_CORNER; // printed width
export const PLATE_THICKNESS = 6;
const MARGIN_X = 24;              // BASEPLATE_MARGIN
const MARGIN_Y = 24;              // BASEPLATE_VERTICAL_MARGIN
const MAX_LETTER = 70;
const MIN_LETTER = 22;
export const LETTER_RELIEF = 6;
const SPACING_RATIO = 0.10;       // INTER_LETTER_SPACING_RATIO
const SPACE_RATIO = 0.4;          // a space advances 0.4 × letter height
const NAME_ZONE = 8;              // stud-free margin around the name

/** Letters, numbers and spaces only; same limit as the builder. */
export const signChars = (text: string) => text.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 12);

export interface Layout {
  letterHeight: number;
  plateHeight: number;
  nameWidth: number;
  letters: { char: string; x: number }[]; // x = where the glyph's local origin goes
}

/** door_sign.py compute_letter_height + build_name_polygon, using the manifest's glyph widths. */
export function layoutSign(text: string, manifest: Manifest): Layout {
  const ref = 184; // manifest glyphs are cap height 184mm; glyph width scales linearly with height
  const chars = [...text];
  const advanceAt = (h: number) => {
    const spacing = h * SPACING_RATIO;
    let x = 0;
    for (const ch of chars) {
      if (ch === ' ') { x += h * SPACE_RATIO; continue; }
      const m = manifest.letters[ch];
      if (m) x += (m.width * h) / ref + spacing;
    }
    return x - spacing;
  };
  const available = LAYOUT_WIDTH - 2 * MARGIN_X;
  let h = MAX_LETTER;
  for (let i = 0; i < 4; i++) {
    const w = advanceAt(h);
    if (w <= available) break;
    h = h * (available / w) * 0.995;
    if (h < MIN_LETTER) { h = MIN_LETTER; break; }
  }

  const spacing = h * SPACING_RATIO;
  const letters: Layout['letters'] = [];
  let x = 0;
  for (const ch of chars) {
    if (ch === ' ') { x += h * SPACE_RATIO; continue; }
    const m = manifest.letters[ch];
    if (!m) continue;
    letters.push({ char: ch, x: x - (m.originX * h) / ref }); // left edge at x
    x += (m.width * h) / ref + spacing;
  }
  const nameWidth = letters.length ? x - spacing : 0;
  letters.forEach((l) => (l.x -= nameWidth / 2));
  return { letterHeight: h, plateHeight: h + 2 * MARGIN_Y + 2 * PLATE_CORNER, nameWidth, letters }; // printed height
}

/** Grid cells (8mm pitch) where a whole stud fits on the plate and clear of the name zone. */
export function studCells(layout: Layout, pitch: number, radius: number): number[] {
  const W = PLATE_WIDTH / 2, H = layout.plateHeight / 2, R = PLATE_CORNER;
  const zx = layout.nameWidth / 2 + NAME_ZONE, zy = layout.letterHeight / 2 + NAME_ZONE;
  // Grid extent as in the script: from the pre-buffer box (240 × baseplate_height)
  const maxX = Math.ceil(LAYOUT_WIDTH / (2 * pitch)), maxY = Math.ceil((layout.plateHeight - 2 * PLATE_CORNER) / (2 * pitch));
  const cells: number[] = [];
  for (let i = -maxX; i <= maxX; i++) {
    for (let j = -maxY; j <= maxY; j++) {
      const x = i * pitch, y = j * pitch;
      if (Math.abs(x) > W - radius || Math.abs(y) > H - radius) continue;            // off the plate
      const cx = Math.abs(x) - (W - R), cy = Math.abs(y) - (H - R);
      if (cx > 0 && cy > 0 && Math.hypot(cx, cy) > R - radius) continue;             // in a rounded corner
      const dx = Math.max(0, Math.abs(x) - zx), dy = Math.max(0, Math.abs(y) - zy);
      if (Math.hypot(dx, dy) < radius) continue;                                     // touches the name zone
      cells.push(i, j);
    }
  }
  return cells;
}


/**
 * Whether the name fits on the plate. Below MIN_LETTER the script stops
 * shrinking and long names run off the plate (door_sign.py would still output
 * them), so the builder and checkout refuse names wider than the 240mm layout box.
 */
export function signFits(text: string, manifest: Manifest): boolean {
  const t = signChars(text);
  return t.trim().length > 0 && layoutSign(t, manifest).nameWidth <= LAYOUT_WIDTH;
}
