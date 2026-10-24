// 3D-FIX-08: design thumbnails captured from the 3D preview at Add to basket.
import { query } from './db';

export const THUMBNAIL_SIZE = 512;
const MAX_BYTES = 768 * 1024;
const ORPHAN_DAYS = 30;          // never attached to an order → deleted after this
const UPLOADS_PER_WINDOW = 20;   // per client IP
const WINDOW_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isThumbnailId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Accept only a real PNG of exactly THUMBNAIL_SIZE square (checked from the IHDR header). */
export function checkPng(buf: Buffer): string | null {
  if (buf.length > MAX_BYTES) return 'Image too large';
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    return 'Not a PNG';
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== THUMBNAIL_SIZE || h !== THUMBNAIL_SIZE) return `Expected ${THUMBNAIL_SIZE}×${THUMBNAIL_SIZE}, got ${w}×${h}`;
  return null;
}

const recent = new Map<string, number[]>();
/** Simple in-memory per-IP limiter; enough to stop someone filling the DB from one address. */
export function allowUpload(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= UPLOADS_PER_WINDOW) return false;
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear(); // bounded memory
  return true;
}

let lastSweep = 0;
/** Delete thumbnails nobody ordered with (or kept in a saved basket). Runs at most hourly. */
async function sweepOrphans(): Promise<void> {
  if (Date.now() - lastSweep < 60 * 60 * 1000) return;
  lastSweep = Date.now();
  await query(
    `DELETE FROM design_thumbnails t
      WHERE t.created_at < now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.thumbnail_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM cart_items  ci WHERE ci.thumbnail_id = t.id)`,
    [ORPHAN_DAYS],
  );
}

export async function saveThumbnail(png: Buffer): Promise<string> {
  const res = await query<{ id: string }>('INSERT INTO design_thumbnails (png) VALUES ($1) RETURNING id', [png]);
  sweepOrphans().catch((err) => console.error('Thumbnail sweep failed:', err));
  return res.rows[0].id;
}

export async function getThumbnail(id: string): Promise<Buffer | null> {
  if (!isThumbnailId(id)) return null;
  const res = await query<{ png: Buffer }>('SELECT png FROM design_thumbnails WHERE id = $1', [id]);
  return res.rows[0]?.png ?? null;
}

/** For inserts: the id if it's well-formed, else null (the FK then rejects unknown ids). */
export const thumbnailParam = (v: unknown): string | null => (isThumbnailId(v) ? v : null);

/** Public URL for an order page / admin. */
export const thumbnailUrl = (id: string) => `/api/thumbnails/${id}`;
