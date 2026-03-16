import { Router } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, validate, withOrgContext } from '@getsale/service-core';

const TemplateCreateSchema = z.object({
  name: z.string().min(1).max(500).trim(),
  channel: z.string().min(1).max(64).trim(),
  content: z.string(),
  conditions: z.record(z.unknown()).optional(),
});

const TemplateUpdateSchema = z.object({
  name: z.string().min(1).max(500).trim().optional(),
  channel: z.string().min(1).max(64).trim().optional(),
  content: z.string().optional(),
  conditions: z.record(z.unknown()).optional(),
});

interface Deps {
  pool: Pool;
  log: Logger;
}

export function templatesRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/:id/templates', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const campaign = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (campaign.rows.length === 0) {
      throw new AppError(404, 'Campaign not found', ErrorCodes.NOT_FOUND);
    }
    const result = await pool.query(
      'SELECT * FROM campaign_templates WHERE campaign_id = $1 ORDER BY created_at',
      [id]
    );
    res.json(result.rows);
  }));

  router.post('/:id/templates', validate(TemplateCreateSchema), asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { name, channel, content, conditions } = req.body;
    const campaign = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (campaign.rows.length === 0) {
      throw new AppError(404, 'Campaign not found', ErrorCodes.NOT_FOUND);
    }
    const templateId = randomUUID();
    const row = await withOrgContext(pool, organizationId, async (client) => {
      await client.query(
        `INSERT INTO campaign_templates (id, organization_id, campaign_id, name, channel, content, conditions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [templateId, organizationId, id, name, channel, content, JSON.stringify(conditions ?? {})]
      );
      const r = await client.query('SELECT * FROM campaign_templates WHERE id = $1', [templateId]);
      return r.rows[0];
    });
    res.status(201).json(row);
  }));

  router.patch('/:campaignId/templates/:templateId', validate(TemplateUpdateSchema), asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { campaignId, templateId } = req.params;
    const { name, channel, content, conditions } = req.body;
    const campaign = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2',
      [campaignId, organizationId]
    );
    if (campaign.rows.length === 0) {
      throw new AppError(404, 'Campaign not found', ErrorCodes.NOT_FOUND);
    }
    const updates: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    let idx = 1;
    if (name !== undefined) {
      params.push(String(name).trim());
      updates.push(`name = $${idx++}`);
    }
    if (channel !== undefined) {
      params.push(String(channel).trim());
      updates.push(`channel = $${idx++}`);
    }
    if (content !== undefined) {
      params.push(typeof content === 'string' ? content : '');
      updates.push(`content = $${idx++}`);
    }
    if (conditions !== undefined) {
      params.push(JSON.stringify(conditions || {}));
      updates.push(`conditions = $${idx++}`);
    }
    if (params.length === 0) {
      const r = await withOrgContext(pool, organizationId, (client) =>
        client.query('SELECT * FROM campaign_templates WHERE id = $1 AND campaign_id = $2', [templateId, campaignId])
      );
      if (!r.rows.length) throw new AppError(404, 'Template not found', ErrorCodes.NOT_FOUND);
      return res.json(r.rows[0]);
    }
    params.push(templateId, campaignId);
    const result = await withOrgContext(pool, organizationId, (client) =>
      client.query(
        `UPDATE campaign_templates SET ${updates.join(', ')} WHERE id = $${idx} AND campaign_id = $${idx + 1} RETURNING *`,
        params
      )
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'Template not found', ErrorCodes.NOT_FOUND);
    }
    res.json(result.rows[0]);
  }));

  return router;
}
