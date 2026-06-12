import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../../lib/adminAuth';
import { query } from '../../../../../lib/db';
import { sendAdminMessage } from '../../../../../lib/email';

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const orderId = Number(params.id);
  if (!orderId) return new Response('Bad request', { status: 400 });

  const form    = await request.formData();
  const rawSub  = String(form.get('subject') ?? '');
  const subject = rawSub === '__custom__'
    ? String(form.get('custom_subject') ?? '').trim()
    : rawSub;
  const body    = String(form.get('body') ?? '').trim();

  if (!subject || !body) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/admin/orders/${orderId}?flash=error` },
    });
  }

  const orderRes = await query<{ customer_name: string; customer_email: string | null }>(`
    SELECT COALESCE(u.name, o.guest_email, 'Guest') AS customer_name,
           COALESCE(u.email, o.guest_email) AS customer_email
    FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1
  `, [orderId]);

  if (!orderRes.rows.length) return new Response('Not found', { status: 404 });
  const { customer_name, customer_email } = orderRes.rows[0];

  if (customer_email) {
    await sendAdminMessage({ orderId, customerName: customer_name, customerEmail: customer_email, subject, body });
  }

  await query(
    'INSERT INTO order_messages (order_id, direction, subject, body, sent_by) VALUES ($1,$2,$3,$4,$5)',
    [orderId, 'outbound', subject, body, admin.id]
  );

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/orders/${orderId}?flash=message_sent` },
  });
};
