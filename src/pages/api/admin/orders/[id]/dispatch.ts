import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../../lib/adminAuth';
import { query } from '../../../../../lib/db';
import { sendDispatchNotification } from '../../../../../lib/email';

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const orderId = Number(params.id);
  if (!orderId) return new Response('Bad request', { status: 400 });

  const form           = await request.formData();
  const carrier        = String(form.get('carrier') ?? 'an_post');
  const trackingNumber = String(form.get('tracking_number') ?? '').trim() || null;
  const redirectTo     = String(form.get('redirect') ?? '') || `/admin/orders/${orderId}`;

  // Get order + customer info
  const orderRes = await query<{
    status: string; customer_name: string; customer_email: string | null;
  }>(`
    SELECT o.status,
      COALESCE(u.name, o.guest_email, 'Guest') AS customer_name,
      COALESCE(u.email, o.guest_email) AS customer_email
    FROM orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id = $1
  `, [orderId]);

  if (!orderRes.rows.length) return new Response('Not found', { status: 404 });
  const order = orderRes.rows[0];

  if (order.status !== 'printing') {
    return new Response(null, {
      status: 302,
      headers: { Location: `/admin/orders/${orderId}?flash=error` },
    });
  }

  // Update order
  await query(
    'UPDATE orders SET status=$1, tracking_number=$2, tracking_carrier=$3, updated_at=NOW() WHERE id=$4',
    ['dispatched', trackingNumber, carrier, orderId]
  );

  // Log status change
  await query(
    'INSERT INTO order_status_log (order_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)',
    [orderId, 'printing', 'dispatched', admin.id, trackingNumber ? `Tracking: ${trackingNumber} via ${carrier}` : null]
  );

  // Send email + store message
  if (order.customer_email) {
    try {
      await sendDispatchNotification({
        orderId,
        customerName:  order.customer_name,
        customerEmail: order.customer_email,
        trackingNumber: trackingNumber ?? undefined,
        carrier,
      });

      const subject = `Your TógBlocks order #TB${String(orderId).padStart(5,'0')} is on its way!`;
      const body    = trackingNumber
        ? `Hi ${order.customer_name},\n\nYour order has been dispatched via ${carrier}.\nTracking number: ${trackingNumber}\n\nExpected delivery: 1–3 working days.`
        : `Hi ${order.customer_name},\n\nYour order has been dispatched via ${carrier}.\n\nExpected delivery: 1–3 working days.`;

      await query(
        'INSERT INTO order_messages (order_id, direction, subject, body, sent_by) VALUES ($1,$2,$3,$4,$5)',
        [orderId, 'outbound', subject, body, admin.id]
      );
    } catch (err) {
      console.error('Dispatch email error:', err);
    }
  }

  return new Response(null, {
    status: 302,
    headers: { Location: `${redirectTo}?flash=dispatched` },
  });
};
