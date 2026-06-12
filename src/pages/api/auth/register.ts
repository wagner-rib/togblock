import type { APIRoute } from 'astro';
import { registerEmailUser, createSession, sessionCookieHeader } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string; name?: string; password?: string; redirect?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  const { email, name, password, redirect = '/account' } = body;

  if (!email || !name || !password) return json({ error: 'All fields are required.' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

  const result = await registerEmailUser({ email, name, password });
  if ('error' in result) return json({ error: result.error }, 409);

  const token = await createSession(result.id);
  return new Response(JSON.stringify({ ok: true, redirect }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie':   sessionCookieHeader(token),
    },
  });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
