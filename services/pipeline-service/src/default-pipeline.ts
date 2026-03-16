import { Pool } from 'pg';

export const DEFAULT_STAGES = [
  { name: 'Lead', order_index: 0, color: '#3B82F6' },
  { name: 'Qualified', order_index: 1, color: '#10B981' },
  { name: 'Proposal', order_index: 2, color: '#F59E0B' },
  { name: 'Negotiation', order_index: 3, color: '#EF4444' },
  { name: 'Closed Won', order_index: 4, color: '#8B5CF6' },
  { name: 'Closed Lost', order_index: 5, color: '#6B7280' },
  { name: 'Converted', order_index: 6, color: '#059669' },
];

/**
 * Creates default pipeline and stages for an organization (idempotent: no-op if one already exists).
 * Used by internal HTTP endpoint and by ORGANIZATION_CREATED event handler.
 */
export async function createDefaultPipelineForOrg(pool: Pool, organizationId: string): Promise<{ id: string } | null> {
  const orgId = organizationId.trim();
  if (!orgId) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM pipelines WHERE organization_id = $1 AND is_default = true LIMIT 1',
      [orgId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK').catch(() => {});
      return existing.rows[0] as { id: string };
    }

    const pipelineResult = await client.query(
      `INSERT INTO pipelines (organization_id, name, description, is_default)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, 'Default Pipeline', 'Default sales pipeline', true]
    );
    const pipeline = pipelineResult.rows[0] as { id: string };

    for (const stage of DEFAULT_STAGES) {
      await client.query(
        `INSERT INTO stages (pipeline_id, organization_id, name, order_index, color)
         VALUES ($1, $2, $3, $4, $5)`,
        [pipeline.id, orgId, stage.name, stage.order_index, stage.color]
      );
    }

    await client.query('COMMIT');
    return pipeline;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
