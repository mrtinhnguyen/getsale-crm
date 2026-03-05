import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';
import { ensureEntityAccess } from '../helpers';

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
    await ensureEntityAccess(pool, organizationId, 'contact', req.params.contactId);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, remind_at, title, done, user_id, created_at
       FROM reminders WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2
       ORDER BY remind_at ASC`,
      [organizationId, req.params.contactId]
    );
    res.json(result.rows);
  }));

  router.post('/contacts/:contactId/reminders', asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { contactId } = req.params;
    const at = parseRemindAt(req.body?.remind_at);
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 500) : null;
    await ensureEntityAccess(pool, organizationId, 'contact', contactId);
    const result = await pool.query(
      `INSERT INTO reminders (organization_id, entity_type, entity_id, remind_at, title, user_id)
       VALUES ($1, 'contact', $2, $3, $4, $5) RETURNING *`,
      [organizationId, contactId, at, title, userId || null]
    );
    res.status(201).json(result.rows[0]);
  }));

  // --- Deal reminders ---
  router.get('/deals/:dealId/reminders', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    await ensureEntityAccess(pool, organizationId, 'deal', req.params.dealId);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, remind_at, title, done, user_id, created_at
       FROM reminders WHERE organization_id = $1 AND entity_type = 'deal' AND entity_id = $2
       ORDER BY remind_at ASC`,
      [organizationId, req.params.dealId]
    );
    res.json(result.rows);
  }));

  router.post('/deals/:dealId/reminders', asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { dealId } = req.params;
    const at = parseRemindAt(req.body?.remind_at);
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 500) : null;
    await ensureEntityAccess(pool, organizationId, 'deal', dealId);
    const result = await pool.query(
      `INSERT INTO reminders (organization_id, entity_type, entity_id, remind_at, title, user_id)
       VALUES ($1, 'deal', $2, $3, $4, $5) RETURNING *`,
      [organizationId, dealId, at, title, userId || null]
    );
    res.status(201).json(result.rows[0]);
  }));

  // --- Update / delete ---
  router.patch('/reminders/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM reminders WHERE id = $1 AND organization_id = $2', [id, organizationId]);
    if (existing.rows.length === 0) throw new AppError(404, 'Reminder not found', ErrorCodes.NOT_FOUND);

    const { done, remind_at, title } = req.body || {};
    const updates: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (typeof done === 'boolean') { params.push(done); updates.push(`done = $${idx++}`); }
    if (remind_at != null) {
      const at = new Date(remind_at);
      if (!Number.isNaN(at.getTime())) { params.push(at); updates.push(`remind_at = $${idx++}`); }
    }
    if (typeof title === 'string') { params.push(title.slice(0, 500)); updates.push(`title = $${idx++}`); }
    if (params.length === 0) return res.json(existing.rows[0]);

    params.push(id, organizationId);
    const result = await pool.query(
      `UPDATE reminders SET ${updates.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  }));

  router.delete('/reminders/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const result = await pool.query(
      'DELETE FROM reminders WHERE id = $1 AND organization_id = $2 RETURNING id',
      [req.params.id, organizationId]
    );
    if (result.rows.length === 0) throw new AppError(404, 'Reminder not found', ErrorCodes.NOT_FOUND);
    res.status(204).send();
  }));

  return router;
}

function parseRemindAt(value: unknown): Date {
  if (!value) throw new AppError(400, 'remind_at is required', ErrorCodes.VALIDATION);
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) throw new AppError(400, 'remind_at must be a valid date', ErrorCodes.VALIDATION);
  return at;
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
