import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from './db';

const SESSION_COOKIE = 'tb_session';
const SESSION_DAYS  = 30;

// ── Session token: <id>.<hmac-signature> ──────────────────────────────────

function sign(id: string): string {
  const secret = import.meta.env.SESSION_SECRET;
  const mac = createHmac('sha256', secret).update(id).digest('hex');
  return `${id}.${mac}`;
}

function verify(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const id  = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', import.meta.env.SESSION_SECRET).update(id).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch {
    return null;
  }
  return id;
}

// ── Public helpers ────────────────────────────────────────────────────────

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  pictureUrl: string | null;
  isAdmin: boolean;
}

export async function createSession(userId: number): Promise<string> {
  const id      = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expires]);
  return sign(id);
}

export async function getSession(token: string): Promise<SessionUser | null> {
  const id = verify(token);
  if (!id) return null;

  const result = await query<SessionUser & { expires_at: Date }>(
    `SELECT u.id, u.email, u.name, u.picture_url AS "pictureUrl", u.is_admin AS "isAdmin", s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [id]
  );
  if (!result.rows.length) return null;

  const { expires_at, ...user } = result.rows[0];
  return user;
}

export async function deleteSession(token: string): Promise<void> {
  const id = verify(token);
  if (id) await query('DELETE FROM sessions WHERE id = $1', [id]);
}

export function sessionCookieHeader(token: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

export function clearCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export function getTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const match  = cookie.match(/(?:^|;\s*)tb_session=([^;]+)/);
  return match ? match[1] : null;
}

// ── Upsert Google user ────────────────────────────────────────────────────

export async function upsertGoogleUser(opts: {
  googleId: string;
  email: string;
  name: string;
  picture: string;
}): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO users (google_id, email, name, picture_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       google_id   = EXCLUDED.google_id,
       name        = EXCLUDED.name,
       picture_url = EXCLUDED.picture_url
     RETURNING id`,
    [opts.googleId, opts.email, opts.name, opts.picture]
  );
  return result.rows[0].id;
}

// ── Email / password auth ─────────────────────────────────────────────────

export async function registerEmailUser(opts: {
  email: string;
  name: string;
  password: string;
}): Promise<{ id: number } | { error: string }> {
  const exists = await query<{ id: number }>(
    'SELECT id FROM users WHERE email = $1',
    [opts.email.toLowerCase()]
  );
  if (exists.rows.length) return { error: 'An account with that email already exists.' };

  const hash   = await bcrypt.hash(opts.password, 12);
  const result = await query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [opts.email.toLowerCase(), opts.name, hash]
  );
  return { id: result.rows[0].id };
}

export async function loginEmailUser(opts: {
  email: string;
  password: string;
}): Promise<{ id: number } | { error: string }> {
  const result = await query<{ id: number; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [opts.email.toLowerCase()]
  );
  if (!result.rows.length || !result.rows[0].password_hash) {
    return { error: 'Invalid email or password.' };
  }
  const ok = await bcrypt.compare(opts.password, result.rows[0].password_hash);
  if (!ok) return { error: 'Invalid email or password.' };
  return { id: result.rows[0].id };
}

export { SESSION_COOKIE };
