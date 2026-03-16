import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { z } from 'zod';
import { asyncHandler, requireUser, validate } from '@getsale/service-core';

interface Deps {
  pool: Pool;
  log: Logger;
}

export type PeriodKey = 'today' | 'week' | 'month' | 'year';

const PeriodQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'year']).default('month'),
});

/** Compute start and end (ISO strings) for a period. End is now; start is beginning of period. */
export function getPeriodBounds(period: PeriodKey): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  switch (period) {
    case 'today':
      start.setUTCHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case 'month':
      start.setUTCDate(start.getUTCDate() - 30);
      break;
    case 'year':
      start.setUTCDate(start.getUTCDate() - 365);
      break;
    default:
      start.setUTCDate(start.getUTCDate() - 30);
  }
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

function sanitizeCsvCell(value: unknown): string {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function analyticsRouter({ pool, log }: Deps): Router {
  const router = Router();

  router.use(requireUser());

  // Summary for cards (Q18: period validated via Zod)
  router.get('/summary', validate(PeriodQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { period } = req.query as z.infer<typeof PeriodQuerySchema>;
    const { startDate, endDate } = getPeriodBounds(period);

    // Match default pipeline stage names: "Closed Won", "Closed Lost" (see auth-service signup, pipeline-service defaults)
    const closedIdsRes = await pool.query(
      `SELECT id FROM stages WHERE organization_id = $1 AND name IN ('Closed Won', 'Closed Lost')`,
      [organizationId]
    );
    const closedIds = (closedIdsRes.rows as { id: string }[]).map((r) => r.id);
    const closedPlaceholders = closedIds.length ? closedIds.map((_, i) => `$${i + 2}`).join(',') : 'NULL';

    const [totalRes, periodRes, createdRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(l.revenue_amount), 0) as total_pipeline_value
         FROM leads l
         WHERE l.organization_id = $1`,
        [organizationId]
      ),
      closedIds.length
        ? pool.query(
            `SELECT
               COALESCE(SUM(l.revenue_amount), 0) as revenue_in_period,
               COUNT(DISTINCT l.id)::int as leads_closed_in_period,
               COUNT(DISTINCT l.responsible_id) FILTER (WHERE l.responsible_id IS NOT NULL)::int as participants_count
             FROM leads l
             WHERE l.organization_id = $1 AND l.stage_id IN (${closedPlaceholders})
               AND l.updated_at >= $${closedIds.length + 2} AND l.updated_at <= $${closedIds.length + 3}`,
            [organizationId, ...closedIds, startDate, endDate]
          )
        : Promise.resolve({ rows: [{ revenue_in_period: 0, leads_closed_in_period: 0, participants_count: 0 }] }),
      pool.query(
        `SELECT COUNT(DISTINCT l.id)::int as leads_created_in_period
         FROM leads l
         WHERE l.organization_id = $1 AND l.created_at >= $2 AND l.created_at <= $3`,
        [organizationId, startDate, endDate]
      ),
    ]);

    const totalPipelineValue = parseFloat(totalRes.rows[0]?.total_pipeline_value ?? 0);
    const revenueInPeriod = parseFloat(periodRes.rows[0]?.revenue_in_period ?? 0);
    const leadsClosedInPeriod = Number(periodRes.rows[0]?.leads_closed_in_period ?? 0);
    const participantsCount = Number(periodRes.rows[0]?.participants_count ?? 0);
    const leadsCreatedInPeriod = Number(createdRes.rows[0]?.leads_created_in_period ?? 0);

    res.json({
      total_pipeline_value: totalPipelineValue,
      revenue_in_period: revenueInPeriod,
      leads_closed_in_period: leadsClosedInPeriod,
      participants_count: participantsCount,
      leads_created_in_period: leadsCreatedInPeriod,
      start_date: startDate,
      end_date: endDate,
    });
  }));

  // Conversion rates
  router.get('/conversion-rates', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    let { fromStage, toStage, startDate, endDate } = req.query;
    const period = req.query.period as PeriodKey | undefined;
    if (period) {
      const bounds = getPeriodBounds(period);
      startDate = bounds.startDate;
      endDate = bounds.endDate;
    }

    let query = `
      WITH stage_transitions AS (
        SELECT 
          sh.*,
          fs.name as from_stage,
          ts.name as to_stage,
          LAG(sh.created_at) OVER (PARTITION BY sh.entity_type, sh.entity_id ORDER BY sh.created_at) as prev_created_at
        FROM stage_history sh
        LEFT JOIN stages fs ON sh.from_stage_id = fs.id
        LEFT JOIN stages ts ON sh.to_stage_id = ts.id
        WHERE sh.organization_id = $1 AND sh.entity_type = 'lead'
    `;
    const params: unknown[] = [organizationId];

    if (fromStage && typeof fromStage === 'string') {
      params.push(fromStage);
      query += ` AND fs.name = $${params.length}`;
    }

    if (toStage && typeof toStage === 'string') {
      params.push(toStage);
      query += ` AND ts.name = $${params.length}`;
    }

    if (startDate && typeof startDate === 'string') {
      params.push(startDate);
      query += ` AND sh.created_at >= $${params.length}`;
    }

    if (endDate && typeof endDate === 'string') {
      params.push(endDate);
      query += ` AND sh.created_at <= $${params.length}`;
    }

    query += `
      )
      SELECT 
        from_stage,
        to_stage,
        COUNT(*) as transitions,
        AVG(EXTRACT(EPOCH FROM (created_at - prev_created_at))) / 3600 as avg_hours
      FROM stage_transitions
      WHERE prev_created_at IS NOT NULL
      GROUP BY from_stage, to_stage
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // Pipeline value (by leads per stage)
  router.get('/pipeline-value', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;

    const result = await pool.query(
      `SELECT 
        s.name as stage_name,
        COUNT(l.id) as lead_count,
        COALESCE(SUM(l.revenue_amount), 0) as total_value,
        COALESCE(AVG(l.revenue_amount), 0) as avg_value
       FROM leads l
       JOIN stages s ON l.stage_id = s.id
       WHERE l.organization_id = $1
       GROUP BY s.id, s.name, s.order_index
       ORDER BY s.order_index`,
      [organizationId]
    );

    res.json(result.rows);
  }));

  // Team performance (leads in closed/won, with display names and avg lead value)
  router.get('/team-performance', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    let { startDate, endDate } = req.query;
    const period = req.query.period as PeriodKey | undefined;
    if (period) {
      const bounds = getPeriodBounds(period);
      startDate = bounds.startDate;
      endDate = bounds.endDate;
    }

    // Match default pipeline stage names: "Closed Won", "Closed Lost"
    const closedIdsRes = await pool.query(
      `SELECT id FROM stages WHERE organization_id = $1 AND name IN ('Closed Won', 'Closed Lost')`,
      [organizationId]
    );
    const closedIds = (closedIdsRes.rows as { id: string }[]).map((r) => r.id);
    const closedPlaceholders = closedIds.length ? closedIds.map((_, i) => `$${i + 2}`).join(',') : 'NULL';

    let query = `
      SELECT 
        u.id as user_id,
        u.email as user_email,
        up.first_name,
        up.last_name,
        COUNT(DISTINCT l.id) as leads_closed,
        COALESCE(SUM(l.revenue_amount), 0) as revenue,
        COALESCE(AVG(l.revenue_amount), 0) as avg_lead_value,
        AVG(EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400) as avg_days_to_close
      FROM leads l
      JOIN users u ON l.responsible_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id AND up.organization_id = l.organization_id
      WHERE l.organization_id = $1 AND l.stage_id IN (${closedPlaceholders})
    `;
    const params: unknown[] = [organizationId, ...closedIds];

    if (startDate && typeof startDate === 'string') {
      params.push(startDate);
      query += ` AND l.updated_at >= $${params.length}`;
    }

    if (endDate && typeof endDate === 'string') {
      params.push(endDate);
      query += ` AND l.updated_at <= $${params.length}`;
    }

    query += ' GROUP BY u.id, u.email, up.first_name, up.last_name';

    const result = await pool.query(query, params);
    const rows = result.rows.map((row: Record<string, unknown>) => {
      const firstName = (row.first_name as string) ?? '';
      const lastName = (row.last_name as string) ?? '';
      const email = (row.user_email as string) ?? '';
      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || email || String(row.user_id);
      return {
        ...row,
        user_display_name: displayName,
      };
    });
    res.json(rows);
  }));

  // Export data
  router.get('/export', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { format, startDate, endDate } = req.query;

    const start = typeof startDate === 'string' ? startDate : '1970-01-01';
    const end = typeof endDate === 'string' ? endDate : new Date().toISOString();

    const result = await pool.query(
      `SELECT * FROM analytics_metrics 
       WHERE organization_id = $1 
       AND recorded_at >= $2 
       AND recorded_at <= $3
       ORDER BY recorded_at DESC`,
      [organizationId, start, end]
    );

    if (format === 'csv') {
      const headers = ['id', 'organization_id', 'metric_type', 'metric_name', 'value', 'dimensions', 'recorded_at'];
      const csv = [
        headers.join(','),
        ...result.rows.map((row: Record<string, unknown>) =>
          headers.map((h) => sanitizeCsvCell(h === 'dimensions' ? JSON.stringify(row[h]) : row[h])).join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=analytics-export.csv');
      res.send(csv);
    } else {
      res.json(result.rows);
    }
  }));

  return router;
}
