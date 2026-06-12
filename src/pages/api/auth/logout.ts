import type { APIRoute } from 'astro';
import { getTokenFromRequest, deleteSession, clearCookieHeader } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  const token = getTokenFromRequest(request);
  if (token) await deleteSession(token);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': clearCookieHeader(),
    },
  });
};
