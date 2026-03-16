import { Router } from 'express';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { RabbitMQClient } from '@getsale/utils';
import { EventType, Event } from '@getsale/events';
import { Logger } from '@getsale/logger';
import { asyncHandler, validate, AppError, ErrorCodes, withOrgContext } from '@getsale/service-core';
import { parsePageLimit, buildPagedResponse } from '../helpers';
import { CompanyCreateSchema, CompanyUpdateSchema } from '../validation';

interface Deps {
  pool: Pool;
  rabbitmq: RabbitMQClient;
  log: Logger;
}

export function companiesRouter({ pool, rabbitmq, log }: Deps): Router {
  const router = Router();

  router.get('/', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { page, limit, offset } = parsePageLimit(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const industry = typeof req.query.industry === 'string' ? req.query.industry.trim() : '';

    let where = 'WHERE organization_id = $1 AND deleted_at IS NULL';
    const params: unknown[] = [organizationId];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR industry ILIKE $${params.length})`;
    }
    if (industry) {
      params.push(industry);
      where += ` AND industry = $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM companies ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM companies ${where}
       ORDER BY updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json(buildPagedResponse(result.rows, total, page, limit));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const result = await pool.query(
      'SELECT * FROM companies WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
      [req.params.id, organizationId]
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'Company not found', ErrorCodes.NOT_FOUND);
    }
    res.json(result.rows[0]);
  }));

  router.post('/', validate(CompanyCreateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { name, industry, size, description, goals, policies } = req.body;

    const row = await withOrgContext(pool, organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO companies (organization_id, name, industry, size, description, goals, policies)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [organizationId, name, industry ?? null, size ?? null, description ?? null,
         JSON.stringify(goals ?? []), JSON.stringify(policies ?? {})]
      );
      return result.rows[0];
    });

    await rabbitmq.publishEvent({
      id: randomUUID(), type: EventType.COMPANY_CREATED, timestamp: new Date(),
      organizationId, userId, correlationId: req.correlationId, data: { companyId: row.id },
    } as Event);

    res.status(201).json(row);
  }));

  router.put('/:id', validate(CompanyUpdateSchema), asyncHandler(async (req, res) => {
    const { id: userId, organizationId } = req.user;
    const { id } = req.params;
    const { name, industry, size, description, goals, policies } = req.body;

    const row = await withOrgContext(pool, organizationId, async (client) => {
      const existing = await client.query(
        'SELECT * FROM companies WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [id, organizationId]
      );
      if (existing.rows.length === 0) {
        throw new AppError(404, 'Company not found', ErrorCodes.NOT_FOUND);
      }
      const r = existing.rows[0];
      const result = await client.query(
        `UPDATE companies SET
          name = COALESCE($2, name), industry = $3, size = $4, description = $5,
          goals = COALESCE($6, goals), policies = COALESCE($7, policies), updated_at = NOW()
         WHERE id = $1 AND organization_id = $8 RETURNING *`,
        [id, name ?? r.name,
         industry !== undefined ? industry : r.industry,
         size !== undefined ? size : r.size,
         description !== undefined ? description : r.description,
         goals !== undefined ? JSON.stringify(goals) : r.goals,
         policies !== undefined ? JSON.stringify(policies) : r.policies,
         organizationId]
      );
      return result.rows[0];
    });

    await rabbitmq.publishEvent({
      id: randomUUID(), type: EventType.COMPANY_UPDATED, timestamp: new Date(),
      organizationId, userId, correlationId: req.correlationId, data: { companyId: id },
    } as Event);

    res.json(row);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;

    const existing = await pool.query(
      'SELECT 1 FROM companies WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
      [id, organizationId]
    );
    if (existing.rows.length === 0) {
      throw new AppError(404, 'Company not found', ErrorCodes.NOT_FOUND);
    }

    const dealsCount = await pool.query(
      'SELECT COUNT(*)::int AS c FROM deals WHERE company_id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (dealsCount.rows[0].c > 0) {
      throw new AppError(409, 'Cannot delete company that has deals. Move or delete deals first.', ErrorCodes.CONFLICT);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE contacts SET company_id = NULL, updated_at = NOW() WHERE company_id = $1 AND organization_id = $2',
        [id, organizationId]
      );
      await client.query(
        'UPDATE companies SET deleted_at = NOW() WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL',
        [id, organizationId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    res.status(204).send();
  }));

  return router;
}
