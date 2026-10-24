/* "Decorative Dots" add-on in the 3D preview: a pack of 10 round 1×1 snap-on
 * pieces (like LEGO DOTS tiles) pressed onto studs across the name, in a bright
 * mixed palette. Placement is seeded by the name, so a given name always gets
 * the same arrangement instead of reshuffling on every change.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLOURS } from './themes';

export const DOT_COUNT = 10;          // pieces in the pack
const DOT_DIAMETER = 7.8;             // fits a 1×1 cell on the 8mm grid
const DOT_HEIGHT = 3.2;               // 1×1 round tile; its hollow underside covers the stud
const DOT_CHAMFER = 0.35;
const DOT_SEGMENTS = 28;

// Bright, mixed and gender-neutral; a dot never matches the letter it sits on
const DOT_PALETTE = [COLOURS.red.hex, COLOURS.yellow.hex, COLOURS.blue.hex, COLOURS.green.hex, COLOURS.pink.hex, COLOURS.sky_blue.hex];

export const dotTopZ = (bodyDepth: number) => bodyDepth + DOT_HEIGHT;

/** One round tile sitting on the letter's top face (z = bodyDepth). */
export function buildDotGeometry(bodyDepth: number, creaseAngle: number): THREE.BufferGeometry {
  const r = DOT_DIAMETER / 2, top = bodyDepth + DOT_HEIGHT;
  const profile = [[r, bodyDepth + 0.01], [r, top - DOT_CHAMFER], [r - DOT_CHAMFER, top], [0, top]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(profile, DOT_SEGMENTS);
  lathe.rotateX(Math.PI / 2); // lathe axis Y -> print Z
  const geo = toCreasedNormals(lathe, creaseAngle);
  lathe.dispose();
  return geo;
}

export interface DotLetter { studs: number[]; colour: string } // studs: flat [i0, j0, i1, j1, ...] cells
export interface PlacedDot { letter: number; i: number; j: number; colour: string }

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

/** Spread DOT_COUNT dots over the letters: every letter gets some, none touch each other. */
export function placeDots(name: string, letters: DotLetter[]): PlacedDot[] {
  const rand = seededRandom(name);
  const usable = letters.map((l, idx) => ({ ...l, idx })).filter((l) => l.studs.length >= 2);
  if (!usable.length) return [];

  // Quotas: one per letter first (a random 10 if the name is longer), the rest by size
  const quota = new Map<number, number>();
  const order = shuffle(usable, rand);
  order.slice(0, DOT_COUNT).forEach((l) => quota.set(l.idx, 1));
  let left = DOT_COUNT - quota.size;
  const bySize = [...usable].sort((a, b) => b.studs.length - a.studs.length);
  for (let k = 0; left > 0 && k < 50; k++) {
    const l = bySize[k % bySize.length];
    quota.set(l.idx, (quota.get(l.idx) ?? 0) + 1);
    left--;
  }

  const dots: PlacedDot[] = [];
  const palette = shuffle(DOT_PALETTE, rand);
  let p = 0;
  for (const l of usable) {
    const want = quota.get(l.idx) ?? 0;
    const cells = shuffle(Array.from({ length: l.studs.length / 2 }, (_, c) => [l.studs[2 * c], l.studs[2 * c + 1]]), rand);
    const picked: number[][] = [];
    for (const [i, j] of cells) {
      if (picked.length >= want) break;
      if (picked.some(([a, b]) => Math.max(Math.abs(a - i), Math.abs(b - j)) < 2)) continue; // keep a gap
      picked.push([i, j]);
    }
    for (const [i, j] of picked) {
      // Next palette colour that differs from the letter and from the previous dot
      let colour = palette[p++ % palette.length];
      for (let tries = 0; tries < palette.length && (colour.toLowerCase() === l.colour.toLowerCase()
        || colour === dots[dots.length - 1]?.colour); tries++) colour = palette[p++ % palette.length];
      dots.push({ letter: l.idx, i, j, colour });
    }
  }
  return dots;
}
