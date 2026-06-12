import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../../lib/adminAuth';
import { query } from '../../../../../lib/db';

const VALID = ['printing','dispatched','delivered','cancelled','refunded'];

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const orderId = Number(params.id);
  if (!orderId) return new Response('Bad request', { status: 400 });

  const form      = await request.formData();
  const newStatus = String(form.get('status') ?? '');
  const note      = String(form.get('note') ?? '') || null;
  const redirectTo = String(form.get('redirect') ?? '') || `/admin/orders/${orderId}`;

  if (!VALID.includes(newStatus)) {
    return new Response('Invalid status', { status: 400 });
  }

  const current = await query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
  if (!current.rows.length) return new Response('Not found', { status: 404 });

  const fromStatus = current.rows[0].status;

  await query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [newStatus, orderId]);
  await query(
    'INSERT INTO order_status_log (order_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)',
    [orderId, fromStatus, newStatus, admin.id, note]
  );

  return new Response(null, {
    status: 302,
    headers: { Location: `${redirectTo}?flash=status_updated` },
  });
};
