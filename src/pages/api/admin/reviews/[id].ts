import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../lib/adminAuth';
import { query } from '../../../../lib/db';

const VALID = ['approved', 'rejected', 'pending'];

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await getAdminUser(request);
  if (!admin) return new Response('Forbidden', { status: 403 });

  const id = Number(params.id);
  if (!id) return new Response('Bad request', { status: 400 });

  const form   = await request.formData();
  const status = String(form.get('status') ?? '');
  if (!VALID.includes(status)) return new Response('Invalid status', { status: 400 });

  await query('UPDATE reviews SET status = $1, moderated_at = NOW() WHERE id = $2', [status, id]);

  return new Response(null, { status: 302, headers: { Location: `/admin/reviews?flash=${status}` } });
};
