import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../../lib/adminAuth';
import { sendReviewRequestFor } from '../../../../../lib/reviews';

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const orderId = Number(params.id);
  if (!orderId) return new Response('Bad request', { status: 400 });

  let flash = 'review_request_ineligible';
  try {
    if (await sendReviewRequestFor(orderId)) flash = 'review_request_sent';
  } catch (err) {
    console.error('Review request email error:', err);
    flash = 'error';
  }

  return new Response(null, { status: 302, headers: { Location: `/admin/orders/${orderId}?flash=${flash}` } });
};
