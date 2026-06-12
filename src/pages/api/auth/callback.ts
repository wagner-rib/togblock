import type { APIRoute } from 'astro';
import { exchangeCode, fetchGoogleUser } from '../../../lib/oauth';
import { upsertGoogleUser, createSession, sessionCookieHeader } from '../../../lib/auth';

function getPublicOrigin(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host');
  const proto     = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwarded) return `${proto}://${forwarded}`;
  return import.meta.env.SITE ?? new URL(request.url).origin;
}

export const GET: APIRoute = async ({ request }) => {
  const url    = new URL(request.url);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');
  const cookie = request.headers.get('cookie') ?? '';
  const rawSaved = cookie.match(/oauth_state=([^;]+)/)?.[1];
  const saved  = rawSaved ? decodeURIComponent(rawSaved) : null;

  if (!code || !state || state !== saved) {
    return new Response('Invalid OAuth state', { status: 400 });
  }

  // State format: "<nonce>|<encodedReturnTo>"
  const [, encodedReturnTo] = state.split('|');
  const returnTo = encodedReturnTo ? decodeURIComponent(encodedReturnTo) : '/account';

  try {
    const redirectUri  = `${getPublicOrigin(request)}/api/auth/callback`;
    const tokens       = await exchangeCode(code, redirectUri);
    const googleUser   = await fetchGoogleUser(tokens.access_token);
    const userId       = await upsertGoogleUser({
      googleId: googleUser.sub,
      email:    googleUser.email,
      name:     googleUser.name,
      picture:  googleUser.picture,
    });
    const token = await createSession(userId);

    return new Response(null, {
      status: 302,
      headers: {
        Location: returnTo,
        'Set-Cookie': sessionCookieHeader(token),
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: '/login?auth_error=1' },
    });
  }
};
