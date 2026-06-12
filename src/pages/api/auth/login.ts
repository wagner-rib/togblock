import type { APIRoute } from 'astro';
import { loginEmailUser, createSession, sessionCookieHeader } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  let body: { email?: string; password?: string; redirect?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  const { email, password, redirect = '/account' } = body;
  if (!email || !password) return json({ error: 'Email and password are required.' }, 400);

  const result = await loginEmailUser({ email, password });
  if ('error' in result) return json({ error: result.error }, 401);

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
