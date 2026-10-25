import type { APIRoute } from 'astro';
import { getStripe, shippingCost, classifyCountry } from '../../lib/stripe';
import { query } from '../../lib/db';
import { getTokenFromRequest, getSession, orderAccessKey } from '../../lib/auth';
import { thumbnailParam } from '../../lib/thumbnails';
import { priceItem, type ItemConfig, type Priced } from '../../lib/pricing';

interface CartItem extends ItemConfig {
  colours: string[];
  thumbnail_id?: string | null; // 3D-FIX-08: design_thumbnails id from Add to basket
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
  giftMessage?: string;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CheckoutBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { items, address, email } = body;
  const notes = cleanText(body.notes, 1000);
  const giftMessage = cleanText(body.giftMessage, 200);

  if (!items?.length || !address?.country || !email) {
    return json({ error: 'Missing required fields' }, 400);
  }

  // Re-price every item from its configuration; never trust the browser's price
  const priced = items.map((item) => priceItem(item));
  const invalid = priced.find((p): p is Extract<Priced, { ok: false }> => !p.ok);
  if (invalid) return json({ error: `${invalid.error}. Please remove that item and add it again.` }, 400);
  const prices = priced as Extract<Priced, { ok: true }>[];
  if (prices.some((p, i) => p.unitPrice !== items[i].unit_price)) {
    // Shown price and real price disagree (old basket, changed prices, or tampering)
    return json({ error: 'Prices in your basket have changed. Please refresh the page and try again.' }, 409);
  }

  // Calculate totals (all in cents)
  const subtotal = prices.reduce((sum, p, i) => sum + p.unitPrice * items[i].quantity, 0);
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
      `INSERT INTO orders (user_id, guest_email, address_id, subtotal, shipping_cost, total, notes, gift_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [user?.id ?? null, user ? null : email, addressId, subtotal, shipping, total, notes, giftMessage]
    );
    const orderId = orderResult.rows[0].id;

    // Save order items
    for (const [i, item] of items.entries()) {
      // Unknown/garbage thumbnail ids become NULL rather than failing the order
      await query(
        `INSERT INTO order_items (order_id, product_type, custom_name, colours, quantity, unit_price, thumbnail_id, options)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM design_thumbnails WHERE id = $7::uuid), $8)`,
        [orderId, item.product_type, item.custom_name, JSON.stringify(item.colours ?? []),
         item.quantity, prices[i].unitPrice, thumbnailParam(item.thumbnail_id), JSON.stringify(prices[i].options)]
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
      accessKey: orderAccessKey(orderId),
      total,
      shipping,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return json({ error: 'Checkout failed, please try again' }, 500);
  }
};

/** Free text from the form: trimmed, control characters removed (newlines kept), capped. Empty -> null. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
  return text || null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
