import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, requireUser } from '@getsale/service-core';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function analyticsRouter({ pool, log }: Deps): Router {
  const router = Router();

  router.use(requireUser());

  // Conversion rates
  router.get('/conversion-rates', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { fromStage, toStage, startDate, endDate } = req.query;

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
        WHERE sh.organization_id = $1
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

  // Pipeline value
  router.get('/pipeline-value', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;

    const result = await pool.query(
      `SELECT 
        s.name as stage_name,
        COUNT(d.id) as deal_count,
        SUM(d.value) as total_value,
        AVG(d.value) as avg_value
       FROM deals d
       JOIN stages s ON d.stage_id = s.id
       WHERE d.organization_id = $1
       GROUP BY s.id, s.name, s.order_index
       ORDER BY s.order_index`,
      [organizationId]
    );

    res.json(result.rows);
  }));

  // Team performance
  router.get('/team-performance', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { startDate, endDate } = req.query;

    let query = `
      SELECT 
        u.id as user_id,
        COUNT(DISTINCT d.id) as deals_closed,
        SUM(d.value) as revenue,
        AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400) as avg_days_to_close
      FROM deals d
      JOIN users u ON d.owner_id = u.id
      WHERE d.organization_id = $1 AND d.stage_id IN (
        SELECT id FROM stages WHERE name = 'closed' OR name = 'won'
      )
    `;
    const params: unknown[] = [organizationId];

    if (startDate && typeof startDate === 'string') {
      params.push(startDate);
      query += ` AND d.updated_at >= $${params.length}`;
    }

    if (endDate && typeof endDate === 'string') {
      params.push(endDate);
      query += ` AND d.updated_at <= $${params.length}`;
    }

    query += ' GROUP BY u.id';

    const result = await pool.query(query, params);
    res.json(result.rows);
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
      const csv = [
        'id,organization_id,metric_type,metric_name,value,dimensions,recorded_at',
        ...result.rows.map((row: Record<string, unknown>) =>
          `${row.id},${row.organization_id},${row.metric_type},${row.metric_name},${row.value},"${JSON.stringify(row.dimensions)}",${row.recorded_at}`
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
