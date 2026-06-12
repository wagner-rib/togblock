import { getTokenFromRequest, getSession } from './auth';
import type { SessionUser } from './auth';

export async function getAdminUser(request: Request): Promise<SessionUser | null> {
  const token = getTokenFromRequest(request);
  const user  = token ? await getSession(token) : null;
  return user?.isAdmin ? user : null;
}
