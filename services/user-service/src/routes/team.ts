import { Router } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, requireUser } from '@getsale/service-core';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function teamRouter({ pool, log }: Deps): Router {
  const router = Router();

  router.use(requireUser());

  router.get('/team/members', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;

    const result = await pool.query(
      `SELECT tm.*, up.first_name, up.last_name, up.avatar_url
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       LEFT JOIN user_profiles up ON tm.user_id = up.user_id
       WHERE t.organization_id = $1`,
      [organizationId]
    );

    res.json(result.rows);
  }));

  router.post('/team/invite', asyncHandler(async (req, res) => {
    const { id, organizationId } = req.user;
    const { email, role, teamId } = req.body;

    if (!email || typeof email !== 'string') {
      throw new AppError(400, 'email is required', ErrorCodes.BAD_REQUEST);
    }
    if (!teamId || typeof teamId !== 'string') {
      throw new AppError(400, 'teamId is required', ErrorCodes.BAD_REQUEST);
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO team_invitations (team_id, email, role, invited_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [teamId, email.trim(), role || 'member', id, token, expiresAt]
    );

    log.info({
      message: 'Team invitation created',
      team_id: teamId,
      email: email.trim(),
      correlation_id: req.correlationId,
    });

    res.json({ token, expiresAt });
  }));

  return router;
}
