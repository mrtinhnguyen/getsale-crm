import { Pool } from 'pg';
import { AppError, ErrorCodes } from '@getsale/service-core';

export async function getFirstStageId(
  pool: Pool,
  pipelineId: string,
  organizationId: string
): Promise<string | null> {
  const r = await pool.query(
    `SELECT id FROM stages
     WHERE pipeline_id = $1 AND organization_id = $2
     ORDER BY order_index ASC LIMIT 1`,
    [pipelineId, organizationId]
  );
  return r.rows[0]?.id ?? null;
}

export async function ensureStageInPipeline(
  pool: Pool,
  stageId: string,
  pipelineId: string,
  organizationId: string
): Promise<void> {
  const r = await pool.query(
    `SELECT 1 FROM stages
     WHERE id = $1 AND pipeline_id = $2 AND organization_id = $3`,
    [stageId, pipelineId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new AppError(400, 'Stage does not belong to the specified pipeline', ErrorCodes.VALIDATION);
  }
}

export async function ensureEntityAccess(
  pool: Pool,
  organizationId: string,
  entityType: 'contact' | 'deal',
  entityId: string
): Promise<void> {
  const table = entityType === 'contact' ? 'contacts' : 'deals';
  const r = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [entityId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new AppError(
      404,
      `${entityType === 'contact' ? 'Contact' : 'Deal'} not found`,
      ErrorCodes.NOT_FOUND
    );
  }
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || c === '\r') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}
