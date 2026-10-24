import type { APIRoute } from 'astro';
import { getTokenFromRequest, getSession } from '../../lib/auth';
import { query } from '../../lib/db';
import { thumbnailParam } from '../../lib/thumbnails';

// Normalised shape expected by the DB
interface NormalisedItem {
  product_type: string;
  custom_name: string;
  colours: string[];
  quantity: number;
  unit_price: number; // cents
  thumbnail_id: string | null;
  options: SavedOptions; // size / add-ons / sign shape + colours, so a restored basket still prices
}

interface SavedOptions {
  size?: string; addons?: { dots?: boolean; giftBox?: boolean };
  shape?: string; plate_colour?: string; text_colour?: string;
}

// Raw shape the builder stores in localStorage
interface RawBuilderItem {
  type?: string;       // 'custom-name' | 'door-sign'
  name?: string;
  letters?: { colour: string }[];
  qty?: number;
  price?: number;      // euros (integer)
  thumbnailId?: string;
  size?: string;
  addons?: { dots?: boolean; giftBox?: boolean };
  shape?: string;
  plateColour?: string;
  textColour?: string;
  // already-normalised fields (if caller already mapped)
  product_type?: string;
  custom_name?: string;
  colours?: string[];
  quantity?: number;
  unit_price?: number;
  thumbnail_id?: string | null;
  plate_colour?: string;
  text_colour?: string;
}

function normalise(raw: RawBuilderItem): NormalisedItem {
  // Accept either the builder's native shape or an already-normalised shape
  const product_type = raw.product_type
    ?? (raw.type === 'door-sign' ? 'door-sign' : 'letters');
  const custom_name  = raw.custom_name ?? raw.name ?? '';
  const colours      = raw.colours
    ?? (raw.letters ?? []).map(l => l.colour);
  const quantity     = raw.quantity ?? raw.qty ?? 1;
  const unit_price   = raw.unit_price
    ?? Math.round((raw.price ?? 0) * 100);  // euros → cents
  const thumbnail_id = thumbnailParam(raw.thumbnail_id ?? raw.thumbnailId);
  const options: SavedOptions = {
    size: raw.size, addons: raw.addons, shape: raw.shape,
    plate_colour: raw.plate_colour ?? raw.plateColour, text_colour: raw.text_colour ?? raw.textColour,
  };
  return { product_type, custom_name, colours, quantity, unit_price, thumbnail_id, options };
}

// GET → return saved cart for logged-in user
export const GET: APIRoute = async ({ request }) => {
  const token = getTokenFromRequest(request);
  const user  = token ? await getSession(token) : null;
  if (!user) return json([]);

  const result = await query<NormalisedItem>(
    `SELECT product_type, custom_name, colours, quantity, unit_price, thumbnail_id, options
     FROM cart_items WHERE user_id = $1 ORDER BY added_at`,
    [user.id]
  );
  return json(result.rows);
};

// POST → sync client cart → DB (replaces saved cart)
export const POST: APIRoute = async ({ request }) => {
  const token = getTokenFromRequest(request);
  const user  = token ? await getSession(token) : null;
  if (!user) return json({ ok: false, reason: 'unauthenticated' });

  let raw: RawBuilderItem[];
  try { raw = await request.json(); } catch { return json({ error: 'Bad body' }, 400); }

  const items = raw.map(normalise);

  await query('DELETE FROM cart_items WHERE user_id = $1', [user.id]);
  for (const item of items) {
    await query(
      `INSERT INTO cart_items (user_id, product_type, custom_name, colours, quantity, unit_price, thumbnail_id, options)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM design_thumbnails WHERE id = $7::uuid), $8)`,
      [user.id, item.product_type, item.custom_name,
       JSON.stringify(item.colours), item.quantity, item.unit_price, item.thumbnail_id, JSON.stringify(item.options)]
    );
  }
  return json({ ok: true, saved: items.length });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
