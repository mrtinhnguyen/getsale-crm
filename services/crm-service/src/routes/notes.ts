import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, validate, withOrgContext } from '@getsale/service-core';
import { z } from 'zod';
import { ensureEntityAccess, getNotesForEntity, insertNote } from '../helpers';

const NoteCreateSchema = z.object({
  content: z.string().min(1).max(50_000).trim(),
});

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
    const rows = await getNotesForEntity(pool, organizationId, 'contact', contactId);
    res.json(rows);
  }));

  router.post('/contacts/:contactId/notes', validate(NoteCreateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { contactId } = req.params;
    const { content } = req.body;
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const row = await withOrgContext(pool, organizationId, (client) =>
      insertNote(client, organizationId, 'contact', contactId, content, userId || null)
    );
    res.status(201).json(row);
  }));

  router.get('/deals/:dealId/notes', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { dealId } = req.params;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const rows = await getNotesForEntity(pool, organizationId, 'deal', dealId);
    res.json(rows);
  }));

  router.post('/deals/:dealId/notes', validate(NoteCreateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { dealId } = req.params;
    const { content } = req.body;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const row = await withOrgContext(pool, organizationId, (client) =>
      insertNote(client, organizationId, 'deal', dealId, content, userId || null)
    );
    res.status(201).json(row);
  }));

  router.delete('/notes/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const deleted = await withOrgContext(pool, organizationId, async (client) => {
      const result = await client.query(
        'DELETE FROM notes WHERE id = $1 AND organization_id = $2 RETURNING id',
        [req.params.id, organizationId]
      );
      return result.rowCount ?? 0;
    });
    if (deleted === 0) throw new AppError(404, 'Note not found', ErrorCodes.NOT_FOUND);
    res.status(204).send();
  }));

  return router;
}
