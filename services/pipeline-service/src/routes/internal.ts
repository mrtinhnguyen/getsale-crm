import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';
import { createDefaultPipelineForOrg } from '../default-pipeline';

interface Deps {
  pool: Pool;
  log: Logger;
}

/**
 * Internal router for service-to-service calls (e.g. manual trigger or backward compatibility).
 * Default pipeline for new orgs is created asynchronously via ORGANIZATION_CREATED event.
 * Protected by internalAuth middleware at app level.
 */
export function internalPipelineRouter({ pool, log }: Deps): Router {
  const router = Router();

  // S9: use only X-Organization-Id (do not trust body for tenant scope)
  router.post('/pipeline/default-for-org', asyncHandler(async (req, res) => {
    const organizationId = req.headers['x-organization-id'];
    if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
      throw new AppError(400, 'X-Organization-Id header is required', ErrorCodes.BAD_REQUEST);
    }
    const orgId = String(organizationId).trim();

    const pipeline = await createDefaultPipelineForOrg(pool, orgId);
    if (!pipeline) {
      throw new AppError(400, 'Invalid organizationId', ErrorCodes.BAD_REQUEST);
    }
    res.status(200).json(pipeline);
  }));

  return router;
}
