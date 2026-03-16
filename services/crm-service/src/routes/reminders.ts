import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, validate, withOrgContext } from '@getsale/service-core';
import { z } from 'zod';
import { ensureEntityAccess, getRemindersForEntity, insertReminder } from '../helpers';

const ReminderCreateSchema = z.object({
  remind_at: z.coerce.date(),
  title: z.string().max(500).trim().optional().nullable(),
});

const ReminderUpdateSchema = z.object({
  done: z.boolean().optional(),
  remind_at: z.coerce.date().optional(),
  title: z.string().max(500).trim().optional().nullable(),
});

interface Deps {
  pool: Pool;
  log: Logger;
}

export function remindersRouter({ pool }: Deps): Router {
  const router = Router();

  // --- Due reminders (for notifications panel) ---
  router.get('/reminders/due', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 50));
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, remind_at, title, done, user_id, created_at
       FROM reminders WHERE organization_id = $1 AND done = false AND remind_at <= NOW()
       ORDER BY remind_at DESC LIMIT $2`,
      [organizationId, limit]
    );
    res.json(result.rows.map(formatReminder));
  }));

  // --- Upcoming reminders ---
  router.get('/reminders/upcoming', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const horizonHours = Math.min(168, Math.max(24, parseInt(String(req.query.hours), 10) || 72));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const from = new Date();
    const to = new Date(from.getTime() + horizonHours * 3600_000);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, remind_at, title, done, user_id, created_at
       FROM reminders WHERE organization_id = $1 AND done = false AND remind_at >= $2 AND remind_at <= $3
       ORDER BY remind_at ASC LIMIT $4`,
      [organizationId, from, to, limit]
    );
    res.json(result.rows);
  }));

  // --- Contact reminders ---
  router.get('/contacts/:contactId/reminders', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { contactId } = req.params;
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const rows = await getRemindersForEntity(pool, organizationId, 'contact', contactId);
    res.json(rows);
  }));

  router.post('/contacts/:contactId/reminders', validate(ReminderCreateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { contactId } = req.params;
    const { remind_at: at, title } = req.body;
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const row = await withOrgContext(pool, organizationId, (client) =>
      insertReminder(client, organizationId, 'contact', contactId, at, title ?? null, userId || null)
    );
    res.status(201).json(row);
  }));

  // --- Deal reminders ---
  router.get('/deals/:dealId/reminders', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { dealId } = req.params;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const rows = await getRemindersForEntity(pool, organizationId, 'deal', dealId);
    res.json(rows);
  }));

  router.post('/deals/:dealId/reminders', validate(ReminderCreateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { dealId } = req.params;
    const { remind_at: at, title } = req.body;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const row = await withOrgContext(pool, organizationId, (client) =>
      insertReminder(client, organizationId, 'deal', dealId, at, title ?? null, userId || null)
    );
    res.status(201).json(row);
  }));

  // --- Update / delete ---
  router.patch('/reminders/:id', validate(ReminderUpdateSchema), asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { done, remind_at, title } = req.body ?? {};

    const row = await withOrgContext(pool, organizationId, async (client) => {
      const existing = await client.query('SELECT * FROM reminders WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      if (existing.rows.length === 0) throw new AppError(404, 'Reminder not found', ErrorCodes.NOT_FOUND);

      const updates: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (typeof done === 'boolean') { params.push(done); updates.push(`done = $${idx++}`); }
      if (remind_at != null) {
        const at = new Date(remind_at);
        if (!Number.isNaN(at.getTime())) { params.push(at); updates.push(`remind_at = $${idx++}`); }
      }
      if (title != null && typeof title === 'string') { params.push(title.slice(0, 500)); updates.push(`title = $${idx++}`); }
      if (params.length === 0) return existing.rows[0];

      params.push(id, organizationId);
      const result = await client.query(
        `UPDATE reminders SET ${updates.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
        params
      );
      return result.rows[0];
    });
    res.json(row);
  }));

  router.delete('/reminders/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const deleted = await withOrgContext(pool, organizationId, async (client) => {
      const result = await client.query(
        'DELETE FROM reminders WHERE id = $1 AND organization_id = $2 RETURNING id',
        [req.params.id, organizationId]
      );
      return result.rowCount ?? 0;
    });
    if (deleted === 0) throw new AppError(404, 'Reminder not found', ErrorCodes.NOT_FOUND);
    res.status(204).send();
  }));

  return router;
}

function formatReminder(r: Record<string, unknown>) {
  return {
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    remind_at: r.remind_at instanceof Date ? r.remind_at.toISOString() : r.remind_at,
    title: r.title,
    done: r.done,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}
