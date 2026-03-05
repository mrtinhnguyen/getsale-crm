import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler } from '@getsale/service-core';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function analyticsRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/conversion', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const pipelineId = typeof req.query.pipelineId === 'string' ? req.query.pipelineId : undefined;

    let leadsWhere = 'WHERE l.organization_id = $1';
    let dealsWhere = 'WHERE d.organization_id = $1 AND d.lead_id IS NOT NULL';
    const params: unknown[] = [organizationId];

    if (pipelineId) {
      params.push(pipelineId);
      leadsWhere += ` AND l.pipeline_id = $${params.length}`;
      dealsWhere += ` AND d.pipeline_id = $${params.length}`;
    }

    const [leadsResult, dealsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM leads l ${leadsWhere}`, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM deals d ${dealsWhere}`, params),
    ]);

    const totalLeads = leadsResult.rows[0].total;
    const convertedLeads = dealsResult.rows[0].total;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 10000) / 10000 : 0;

    res.json({ totalLeads, convertedLeads, conversionRate });
  }));

  return router;
}
