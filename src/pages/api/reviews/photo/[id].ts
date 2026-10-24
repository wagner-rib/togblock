import type { APIRoute } from 'astro';
import { getAdminUser } from '../../../../lib/adminAuth';
import { query } from '../../../../lib/db';

// Approved photos are public; admins can also see pending/rejected ones for moderation.
export const GET: APIRoute = async ({ request, params }) => {
  const id = Number(params.id);
  if (!id) return new Response('Not found', { status: 404 });

  const res = await query<{ photo: Buffer; photo_mime: string; status: string }>(
    'SELECT photo, photo_mime, status FROM reviews WHERE id = $1 AND photo IS NOT NULL',
    [id]
  );
  const row = res.rows[0];
  if (!row) return new Response('Not found', { status: 404 });

  const isPublic = row.status === 'approved';
  if (!isPublic && !(await getAdminUser(request))) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(row.photo), {
    headers: {
      'Content-Type': row.photo_mime,
      'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
