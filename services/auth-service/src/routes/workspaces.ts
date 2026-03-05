import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';
import { extractBearerToken, signAccessToken } from '../helpers';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function workspacesRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/workspaces', asyncHandler(async (req, res) => {
    const decoded = extractBearerToken(req);
    const rows = await pool.query(
      `SELECT om.organization_id AS id, o.name
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1 ORDER BY o.name`,
      [decoded.userId]
    );
    res.json(rows.rows);
  }));

  router.post('/switch-workspace', asyncHandler(async (req, res) => {
    const decoded = extractBearerToken(req);
    const { organizationId } = req.body;
    if (!organizationId) throw new AppError(400, 'organizationId required', ErrorCodes.BAD_REQUEST);

    const member = await pool.query(
      'SELECT om.role FROM organization_members om WHERE om.user_id = $1 AND om.organization_id = $2',
      [decoded.userId, organizationId]
    );
    if (member.rows.length === 0) throw new AppError(403, 'Not a member of this organization', ErrorCodes.FORBIDDEN);

    const userRow = await pool.query('SELECT id, email FROM users WHERE id = $1', [decoded.userId]);
    if (userRow.rows.length === 0) throw new AppError(401, 'User not found', ErrorCodes.UNAUTHORIZED);

    const user = userRow.rows[0];
    const role = member.rows[0].role;
    const accessToken = signAccessToken({ userId: user.id, organizationId, role });

    res.json({ accessToken, user: { id: user.id, email: user.email, organizationId, role } });
  }));

  return router;
}
