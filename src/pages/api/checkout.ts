import type { APIRoute } from 'astro';
import { getStripe, shippingCost, classifyCountry } from '../../lib/stripe';
import { query } from '../../lib/db';
import { getTokenFromRequest, getSession } from '../../lib/auth';

interface CartItem {
  product_type: 'letters' | 'door-sign';
  custom_name: string;
  colours: string[];
  quantity: number;
  unit_price: number;
}

interface CheckoutBody {
  items: CartItem[];
  address: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    county?: string;
    postcode?: string;
    country: string; // ISO 2-letter
  };
  email: string;
  notes?: string;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { items, address, email, notes } = body;

  if (!items?.length || !address?.country || !email) {
    return json({ error: 'Missing required fields' }, 400);
  }

  // Calculate totals (all in cents)
  const subtotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const region   = classifyCountry(address.country);
  const shipping = shippingCost(region, subtotal);
  const total    = subtotal + shipping;

  // Get logged-in user if any
  const token = getTokenFromRequest(request);
  const user  = token ? await getSession(token) : null;

  const stripe = getStripe();

  try {
    // Save address
    const addrResult = await query<{ id: number }>(
      `INSERT INTO addresses (user_id, name, line1, line2, city, county, postcode, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [user?.id ?? null, address.name, address.line1, address.line2 ?? null,
       address.city, address.county ?? null, address.postcode ?? null, address.country]
    );
    const addressId = addrResult.rows[0].id;

    // Create order
    const orderResult = await query<{ id: number }>(
      `INSERT INTO orders (user_id, guest_email, address_id, subtotal, shipping_cost, total, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [user?.id ?? null, user ? null : email, addressId, subtotal, shipping, total, notes ?? null]
    );
    const orderId = orderResult.rows[0].id;

    // Save order items
    for (const item of items) {
      await query(
        `INSERT INTO order_items (order_id, product_type, custom_name, colours, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.product_type, item.custom_name, JSON.stringify(item.colours),
         item.quantity, item.unit_price]
      );
    }

    // Create Stripe PaymentIntent
    const pi = await stripe.paymentIntents.create({
      amount:   total,
      currency: 'eur',
      metadata: {
        order_id:    String(orderId),
        customer_email: email,
      },
      receipt_email: email,
      payment_method_types: ['card'],
    });

    // Store Stripe PI id on order
    await query(
      'UPDATE orders SET stripe_pi_id = $1 WHERE id = $2',
      [pi.id, orderId]
    );

    return json({
      clientSecret: pi.client_secret,
      orderId,
      total,
      shipping,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return json({ error: 'Checkout failed, please try again' }, 500);
  }
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
