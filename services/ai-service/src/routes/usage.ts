import { Router } from 'express';
import { Logger } from '@getsale/logger';
import { asyncHandler } from '@getsale/service-core';
import { AIRateLimiter } from '../rate-limiter';

interface Deps {
  log: Logger;
  rateLimiter: AIRateLimiter;
}

export function usageRouter({ rateLimiter }: Deps): Router {
  const router = Router();

  router.get('/usage', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const usage = await rateLimiter.getUsage(organizationId);
    res.json(usage);
  }));

  return router;
}
