import pg from 'pg';

const { Pool } = pg;

// Server secrets are read from process.env at runtime. import.meta.env would be inlined at
// build time, and the Docker build has no .env, so it compiled to `undefined` in production.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const db = getPool();
  return db.query<T>(sql, params);
}
