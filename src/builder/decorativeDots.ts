/* "Decorative Dots" add-on in the 3D preview: a pack of 10 small LEGO-compatible
 * plates (2×4, 2×3, 2×2 and a few 1×N) snapped onto the letters' studs, as in
 * the product photos (e.g. /products/finn-letters.jpg). Pieces lie along or
 * across the letter, sit fully on its studs, keep a gap from each other, and are
 * glossy moulded plastic rather than matte PLA. Placement is seeded by the name,
 * so a given name always gets the same arrangement.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLOURS } from './themes';

export const PIECE_COUNT = 10;        // pieces in the pack
const PLATE_HEIGHT = 3.2;             // LEGO plate
const PLATE_CLEARANCE = 0.1;          // per side, as moulded bricks are 7.8mm per 8mm cell
const STUD_RADIUS = 2.4;
const STUD_HEIGHT = 1.7;
const STUD_SEGMENTS = 20;

// Sizes as [cells along X, cells along Y]; picked at random with these weights, then rotated
const SIZES: [number, number, number][] = [[4, 2, 4], [3, 2, 2], [2, 2, 3], [4, 1, 1], [2, 1, 1]];

// Bright mix from the product photos, plus pink so it suits every kid
const PALETTE = [
  COLOURS.red.hex, COLOURS.yellow.hex, COLOURS.blue.hex, COLOURS.sky_blue.hex,
  '#8CC63F', COLOURS.green.hex, COLOURS.white.hex, COLOURS.pink.hex,
];

export interface PieceLetter { studs: number[]; colour: string } // studs: flat [i0, j0, i1, j1, ...] cells
export interface PlacedPiece {
  letter: number;
  cx: number; cy: number;          // centre in grid cells (may be .5)
  w: number; h: number;            // footprint in cells along X / Y
  colour: string;
}

/**
 * A plate of w×h cells, centred on x/y, bottom at z=0 (it sits on the letter's
 * top face; its hollow underside would cover the letter studs it presses onto).
 */
export function buildPieceGeometry(w: number, h: number, pitch: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const plate = new THREE.BoxGeometry(w * pitch - 2 * PLATE_CLEARANCE, h * pitch - 2 * PLATE_CLEARANCE, PLATE_HEIGHT);
  plate.translate(0, 0, PLATE_HEIGHT / 2);
  parts.push(plate);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const stud = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, STUD_SEGMENTS);
      stud.rotateX(Math.PI / 2); // cylinder axis Y -> Z
      stud.translate((i - (w - 1) / 2) * pitch, (j - (h - 1) / 2) * pitch, PLATE_HEIGHT + STUD_HEIGHT / 2);
      parts.push(stud);
    }
  }
  const geo = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return geo;
}

/** Glossy moulded-plastic look, so pieces read as LEGO next to the matte printed letters. */
export function createPieceMaterial(hex: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.28, metalness: 0 });
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

function pickSize(rand: () => number): [number, number] {
  const total = SIZES.reduce((n, s) => n + s[2], 0);
  let r = rand() * total;
  for (const [w, h, weight] of SIZES) {
    if ((r -= weight) < 0) return [w, h];
  }
  return [2, 2];
}

/** Spread PIECE_COUNT plates over the letters: every letter gets some, all fully supported, none touching. */
export function placePieces(name: string, letters: PieceLetter[]): PlacedPiece[] {
  const rand = seededRandom(name);
  const usable = letters.map((l, idx) => ({ ...l, idx })).filter((l) => l.studs.length >= 8);
  if (!usable.length) return [];

  // Quotas: one per letter first (a random 10 if the name is longer), the rest by size
  const quota = new Map<number, number>();
  shuffle(usable, rand).slice(0, PIECE_COUNT).forEach((l) => quota.set(l.idx, 1));
  let left = PIECE_COUNT - quota.size;
  const bySize = [...usable].sort((a, b) => b.studs.length - a.studs.length);
  for (let k = 0; left > 0 && k < 50; k++, left--) {
    const l = bySize[k % bySize.length];
    quota.set(l.idx, (quota.get(l.idx) ?? 0) + 1);
  }

  const pieces: PlacedPiece[] = [];
  const palette = shuffle(PALETTE, rand);
  let p = 0;
  for (const l of usable) {
    const cells = new Set<string>();
    for (let c = 0; c < l.studs.length; c += 2) cells.add(`${l.studs[c]},${l.studs[c + 1]}`);
    const anchors = shuffle([...cells].map((k) => k.split(',').map(Number)), rand);
    const blocked = new Set<string>(); // taken cells plus a one-cell margin
    for (let n = 0; n < (quota.get(l.idx) ?? 0); n++) {
      let [w, h] = pickSize(rand);
      if (rand() < 0.5) [w, h] = [h, w]; // lie across or along the letter
      // Try the chosen size, then smaller ones, at every anchor until one fits fully on the letter
      const tries: [number, number][] = [[w, h], [h, w], [2, 2], [2, 1], [1, 2]];
      let placed = false;
      for (const [tw, th] of tries) {
        for (const [ai, aj] of anchors) {
          let ok = true;
          for (let i = 0; i < tw && ok; i++) for (let j = 0; j < th && ok; j++) {
            const key = `${ai + i},${aj + j}`;
            ok = cells.has(key) && !blocked.has(key);
          }
          if (!ok) continue;
          for (let i = -1; i <= tw; i++) for (let j = -1; j <= th; j++) blocked.add(`${ai + i},${aj + j}`);
          let colour = palette[p++ % palette.length];
          for (let t = 0; t < palette.length && (colour.toLowerCase() === l.colour.toLowerCase()
            || colour === pieces[pieces.length - 1]?.colour); t++) colour = palette[p++ % palette.length];
          pieces.push({ letter: l.idx, cx: ai + (tw - 1) / 2, cy: aj + (th - 1) / 2, w: tw, h: th, colour });
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
  }
  return pieces;
}
