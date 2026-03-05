import { Router } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';

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

  router.post('/:id/templates', asyncHandler(async (req, res) => {
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
    if (!name || !channel || content === undefined) {
      throw new AppError(400, 'name, channel, and content are required', ErrorCodes.VALIDATION);
    }
    const templateId = randomUUID();
    await pool.query(
      `INSERT INTO campaign_templates (id, organization_id, campaign_id, name, channel, content, conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        templateId,
        organizationId,
        id,
        String(name).trim(),
        String(channel).trim(),
        typeof content === 'string' ? content : '',
        JSON.stringify(conditions || {}),
      ]
    );
    const row = await pool.query('SELECT * FROM campaign_templates WHERE id = $1', [templateId]);
    res.status(201).json(row.rows[0]);
  }));

  router.patch('/:campaignId/templates/:templateId', asyncHandler(async (req, res) => {
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
      const r = await pool.query(
        'SELECT * FROM campaign_templates WHERE id = $1 AND campaign_id = $2',
        [templateId, campaignId]
      );
      if (!r.rows.length) throw new AppError(404, 'Template not found', ErrorCodes.NOT_FOUND);
      return res.json(r.rows[0]);
    }
    params.push(templateId, campaignId);
    const result = await pool.query(
      `UPDATE campaign_templates SET ${updates.join(', ')} WHERE id = $${idx} AND campaign_id = $${idx + 1} RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'Template not found', ErrorCodes.NOT_FOUND);
    }
    res.json(result.rows[0]);
  }));

  return router;
}
