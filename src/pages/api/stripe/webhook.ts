import type { APIRoute } from 'astro';
import { getStripe } from '../../../lib/stripe';
import { query } from '../../../lib/db';
import { sendOrderConfirmation } from '../../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  const sig     = request.headers.get('stripe-signature');
  const body    = await request.text();
  const stripe  = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, import.meta.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi      = event.data.object;
    const orderId = Number(pi.metadata.order_id);

    if (!orderId) return ok();

    // Mark order paid
    await query(
      `UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status = 'pending_payment'`,
      [orderId]
    );

    // Fetch full order data for email
    const orderRes = await query<{
      id: number; guest_email: string | null; subtotal: number;
      shipping_cost: number; total: number;
    }>(
      'SELECT id, guest_email, subtotal, shipping_cost, total FROM orders WHERE id = $1',
      [orderId]
    );
    if (!orderRes.rows.length) return ok();
    const order = orderRes.rows[0];

    const itemsRes = await query<{
      product_type: string; custom_name: string; quantity: number; unit_price: number;
    }>(
      'SELECT product_type, custom_name, quantity, unit_price FROM order_items WHERE order_id = $1',
      [orderId]
    );

    const addrRes = await query<{
      name: string; line1: string; line2?: string; city: string;
      county?: string; postcode?: string; country: string;
    }>(
      `SELECT a.name, a.line1, a.line2, a.city, a.county, a.postcode, a.country
       FROM orders o JOIN addresses a ON a.id = o.address_id WHERE o.id = $1`,
      [orderId]
    );

    const userRes = await query<{ email: string; name: string }>(
      `SELECT u.email, u.name FROM orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [orderId]
    );

    const customerEmail = userRes.rows[0]?.email ?? order.guest_email ?? pi.metadata.customer_email;
    const customerName  = userRes.rows[0]?.name ?? addrRes.rows[0]?.name ?? 'Customer';

    if (customerEmail && addrRes.rows.length) {
      try {
        await sendOrderConfirmation({
          orderId: order.id,
          customerEmail,
          customerName,
          items:        itemsRes.rows,
          shippingCost: order.shipping_cost,
          total:        order.total,
          address:      addrRes.rows[0],
        });
      } catch (e) {
        console.error('Email send failed:', e);
      }
    }
  }

  return ok();
};

const ok = () => new Response(JSON.stringify({ received: true }), {
  headers: { 'Content-Type': 'application/json' },
});
