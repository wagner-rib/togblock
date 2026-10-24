import { createHmac, timingSafeEqual } from 'crypto';
import { query } from './db';
import { sendReviewRequest } from './email';

// Orders dispatched before this moment are never auto-emailed — existing customers
// only get a request when an admin clicks "Send review request" on the order.
const AUTO_REQUEST_SINCE = '2026-10-24T00:00:00Z';
const REQUEST_DELAY_DAYS = 7;

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PublicReview {
  id: number;
  rating: number;
  body: string;
  display_name: string;
  location: string | null;
  product_type: string | null;
  has_photo: boolean;
  created_at: Date;
}

// ── Signed review links ─────────────────────────────────────────

export function reviewToken(orderId: number): string {
  return createHmac('sha256', process.env.SESSION_SECRET!)
    .update(`review:${orderId}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyReviewToken(orderId: number, token: string): boolean {
  const expected = Buffer.from(reviewToken(orderId));
  const given    = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function reviewUrl(orderId: number): string {
  return `https://togblocks.com/review/${orderId}?t=${reviewToken(orderId)}`;
}

// ── Reading ─────────────────────────────────────────────────────

export async function getApprovedReviews(opts: {
  productType?: string; photosOnly?: boolean; limit?: number;
} = {}): Promise<PublicReview[]> {
  const where  = [`status = 'approved'`];
  const params: unknown[] = [];
  if (opts.productType) { params.push(opts.productType); where.push(`product_type = $${params.length}`); }
  if (opts.photosOnly)  where.push('photo IS NOT NULL');
  params.push(opts.limit ?? 12);

  const res = await query<PublicReview>(`
    SELECT id, rating, body, display_name, location, product_type,
           (photo IS NOT NULL) AS has_photo, created_at
    FROM reviews
    WHERE ${where.join(' AND ')}
    ORDER BY (photo IS NOT NULL) DESC, created_at DESC
    LIMIT $${params.length}
  `, params);
  return res.rows;
}

export async function getRatingSummary(productType?: string): Promise<{ count: number; average: number }> {
  const res = await query<{ count: string; average: string | null }>(`
    SELECT COUNT(*) AS count, AVG(rating) AS average
    FROM reviews
    WHERE status = 'approved' ${productType ? 'AND product_type = $1' : ''}
  `, productType ? [productType] : []);
  return {
    count:   Number(res.rows[0].count),
    average: Math.round(Number(res.rows[0].average ?? 0) * 10) / 10,
  };
}

// ── Review requests ─────────────────────────────────────────────

/** Sends the review request email for one order and stamps it. Returns false if not eligible. */
export async function sendReviewRequestFor(orderId: number): Promise<boolean> {
  const res = await query<{ customer_name: string; customer_email: string | null }>(`
    SELECT COALESCE(a.name, u.name, 'there') AS customer_name,
           COALESCE(u.email, o.guest_email)   AS customer_email
    FROM orders o
    LEFT JOIN users u     ON u.id = o.user_id
    LEFT JOIN addresses a ON a.id = o.address_id
    WHERE o.id = $1
      AND o.status IN ('dispatched','delivered')
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
  `, [orderId]);

  const row = res.rows[0];
  if (!row?.customer_email) return false;

  const firstName = row.customer_name.split(' ')[0];
  await sendReviewRequest({
    orderId,
    customerName:  firstName,
    customerEmail: row.customer_email,
    url:           reviewUrl(orderId),
  });

  await query('UPDATE orders SET review_requested_at = NOW() WHERE id = $1', [orderId]);
  await query(
    'INSERT INTO order_messages (order_id, direction, subject, body, sent_by) VALUES ($1,$2,$3,$4,$5)',
    [orderId, 'outbound', 'How did your TógBlocks build turn out?', `Review request sent: ${reviewUrl(orderId)}`, null]
  );
  return true;
}

/** Emails every order dispatched ≥7 days ago (and after AUTO_REQUEST_SINCE) that hasn't been asked yet. */
export async function sendDueReviewRequests(): Promise<number> {
  const due = await query<{ id: number }>(`
    SELECT o.id
    FROM orders o
    JOIN LATERAL (
      SELECT MAX(created_at) AS dispatched_at
      FROM order_status_log
      WHERE order_id = o.id AND to_status = 'dispatched'
    ) d ON TRUE
    WHERE o.status IN ('dispatched','delivered')
      AND o.review_requested_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
      AND d.dispatched_at >= $1
      AND d.dispatched_at <= NOW() - make_interval(days => $2)
    ORDER BY o.id
  `, [AUTO_REQUEST_SINCE, REQUEST_DELAY_DAYS]);

  let sent = 0;
  for (const { id } of due.rows) {
    try {
      if (await sendReviewRequestFor(Number(id))) sent++;
    } catch (err) {
      console.error(`Review request email failed for order ${id}:`, err);
    }
  }
  return sent;
}

// ── Photo validation ────────────────────────────────────────────

/** Sniffs magic bytes so the stored MIME type can't be spoofed by the browser. */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
