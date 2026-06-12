import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../../lib/adminAuth';
import { query } from '../../../../../lib/db';

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const orderId = Number(params.id);
  if (!orderId) return new Response('Bad request', { status: 400 });

  const form  = await request.formData();
  const notes = String(form.get('notes') ?? '').trim() || null;

  await query('UPDATE orders SET admin_notes = $1, updated_at = NOW() WHERE id = $2', [notes, orderId]);

  return new Response(null, {
    status: 302,
    headers: { Location: `/admin/orders/${orderId}?flash=notes_saved` },
  });
};
