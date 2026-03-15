import { Router } from 'express';
import { Pool } from 'pg';
import { asyncHandler } from '@getsale/service-core';
import { getLeadContext, buildLeadContextPayload } from '../queries/conversation-queries';

interface Deps {
  pool: Pool;
}

export function conversationLeadsRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/conversations/:id/lead-context', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id: conversationId } = req.params;
    const row = await getLeadContext(pool, { conversationId, orgId: organizationId });
    const payload = await buildLeadContextPayload(pool, organizationId, row);
    res.json(payload);
  }));

  router.get('/lead-context-by-lead/:leadId', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { leadId } = req.params;
    const row = await getLeadContext(pool, { leadId, orgId: organizationId });
    const payload = await buildLeadContextPayload(pool, organizationId, row);
    res.json(payload);
  }));

  return router;
}
