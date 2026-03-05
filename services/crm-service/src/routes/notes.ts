import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';
import { ensureEntityAccess } from '../helpers';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function notesRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/contacts/:contactId/notes', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { contactId } = req.params;
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, content, user_id, created_at, updated_at
       FROM notes WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2
       ORDER BY created_at DESC`,
      [organizationId, contactId]
    );
    res.json(result.rows);
  }));

  router.post('/contacts/:contactId/notes', asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { contactId } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) throw new AppError(400, 'content is required', ErrorCodes.VALIDATION);
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const result = await pool.query(
      `INSERT INTO notes (organization_id, entity_type, entity_id, content, user_id)
       VALUES ($1, 'contact', $2, $3, $4) RETURNING *`,
      [organizationId, contactId, content, userId || null]
    );
    res.status(201).json(result.rows[0]);
  }));

  router.get('/deals/:dealId/notes', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { dealId } = req.params;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, content, user_id, created_at, updated_at
       FROM notes WHERE organization_id = $1 AND entity_type = 'deal' AND entity_id = $2
       ORDER BY created_at DESC`,
      [organizationId, dealId]
    );
    res.json(result.rows);
  }));

  router.post('/deals/:dealId/notes', asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { dealId } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) throw new AppError(400, 'content is required', ErrorCodes.VALIDATION);
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const result = await pool.query(
      `INSERT INTO notes (organization_id, entity_type, entity_id, content, user_id)
       VALUES ($1, 'deal', $2, $3, $4) RETURNING *`,
      [organizationId, dealId, content, userId || null]
    );
    res.status(201).json(result.rows[0]);
  }));

  router.delete('/notes/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const result = await pool.query(
      'DELETE FROM notes WHERE id = $1 AND organization_id = $2 RETURNING id',
      [req.params.id, organizationId]
    );
    if (result.rows.length === 0) throw new AppError(404, 'Note not found', ErrorCodes.NOT_FOUND);
    res.status(204).send();
  }));

  return router;
}
