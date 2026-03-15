import { Pool, PoolClient } from 'pg';

/**
 * Execute a callback within a transaction that has the RLS tenant context set.
 *
 * Uses SET LOCAL so the setting is scoped to the current transaction only —
 * safe with PgBouncer in transaction-pooling mode.
 *
 * Usage:
 *   const rows = await withOrgContext(pool, req.user.organizationId, async (client) => {
 *     const r = await client.query('SELECT * FROM companies');
 *     return r.rows;
 *   });
 */
export async function withOrgContext<T>(
  pool: Pool,
  organizationId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [organizationId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
