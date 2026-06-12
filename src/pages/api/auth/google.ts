import type { APIRoute } from 'astro';
import { randomBytes } from 'crypto';
import { getAuthorizationUrl } from '../../../lib/oauth';

// Use the forwarded host from Caddy, falling back to the configured site origin
function getPublicOrigin(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host');
  const proto     = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwarded) return `${proto}://${forwarded}`;
  return import.meta.env.SITE ?? new URL(request.url).origin;
}

export const GET: APIRoute = ({ request }) => {
  const reqUrl      = new URL(request.url);
  const returnTo    = reqUrl.searchParams.get('returnTo') ?? '/account';
  const state       = `${randomBytes(16).toString('hex')}|${encodeURIComponent(returnTo)}`;
  const redirectUri = `${getPublicOrigin(request)}/api/auth/callback`;
  const url         = getAuthorizationUrl(state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    },
  });
};
