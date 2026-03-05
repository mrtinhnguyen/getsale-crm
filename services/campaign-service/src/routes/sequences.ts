import { Router } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';

interface Deps {
  pool: Pool;
  log: Logger;
}

export function sequencesRouter({ pool }: Deps): Router {
  const router = Router();

  router.get('/:id/sequences', asyncHandler(async (req, res) => {
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
      'SELECT cs.*, ct.name as template_name, ct.channel, ct.content FROM campaign_sequences cs JOIN campaign_templates ct ON ct.id = cs.template_id WHERE cs.campaign_id = $1 ORDER BY cs.order_index',
      [id]
    );
    res.json(result.rows);
  }));

  router.post('/:id/sequences', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { orderIndex, templateId, delayHours, delayMinutes, conditions, triggerType } = req.body;
    const campaign = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (campaign.rows.length === 0) {
      throw new AppError(404, 'Campaign not found', ErrorCodes.NOT_FOUND);
    }
    const template = await pool.query(
      'SELECT id FROM campaign_templates WHERE id = $1 AND campaign_id = $2',
      [templateId, id]
    );
    if (template.rows.length === 0) {
      throw new AppError(400, 'Template not found or does not belong to this campaign', ErrorCodes.BAD_REQUEST);
    }
    const seqId = randomUUID();
    const trigger = triggerType === 'after_reply' ? 'after_reply' : 'delay';
    await pool.query(
      `INSERT INTO campaign_sequences (id, campaign_id, order_index, template_id, delay_hours, delay_minutes, conditions, trigger_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        seqId,
        id,
        typeof orderIndex === 'number' ? orderIndex : 0,
        templateId,
        typeof delayHours === 'number' ? Math.max(0, delayHours) : 24,
        typeof delayMinutes === 'number' ? Math.max(0, Math.min(59, delayMinutes)) : 0,
        JSON.stringify(conditions || {}),
        trigger,
      ]
    );
    const row = await pool.query(
      'SELECT cs.*, ct.name as template_name FROM campaign_sequences cs JOIN campaign_templates ct ON ct.id = cs.template_id WHERE cs.id = $1',
      [seqId]
    );
    res.status(201).json(row.rows[0]);
  }));

  router.patch('/:campaignId/sequences/:stepId', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { campaignId, stepId } = req.params;
    const { orderIndex, templateId, delayHours, delayMinutes, conditions, triggerType } = req.body;
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
    if (typeof orderIndex === 'number') {
      params.push(orderIndex);
      updates.push(`order_index = $${idx++}`);
    }
    if (templateId !== undefined) {
      params.push(templateId);
      updates.push(`template_id = $${idx++}`);
    }
    if (typeof delayHours === 'number') {
      params.push(Math.max(0, delayHours));
      updates.push(`delay_hours = $${idx++}`);
    }
    if (typeof delayMinutes === 'number') {
      params.push(Math.max(0, Math.min(59, delayMinutes)));
      updates.push(`delay_minutes = $${idx++}`);
    }
    if (conditions !== undefined) {
      params.push(JSON.stringify(conditions || {}));
      updates.push(`conditions = $${idx++}`);
    }
    if (triggerType !== undefined) {
      params.push(triggerType === 'after_reply' ? 'after_reply' : 'delay');
      updates.push(`trigger_type = $${idx++}`);
    }
    if (params.length === 0) {
      const r = await pool.query(
        'SELECT cs.*, ct.name as template_name, ct.channel, ct.content FROM campaign_sequences cs JOIN campaign_templates ct ON ct.id = cs.template_id WHERE cs.id = $1 AND cs.campaign_id = $2',
        [stepId, campaignId]
      );
      if (!r.rows.length) throw new AppError(404, 'Sequence step not found', ErrorCodes.NOT_FOUND);
      return res.json(r.rows[0]);
    }
    params.push(stepId, campaignId);
    const result = await pool.query(
      `UPDATE campaign_sequences SET ${updates.join(', ')} WHERE id = $${idx} AND campaign_id = $${idx + 1} RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'Sequence step not found', ErrorCodes.NOT_FOUND);
    }
    const row = await pool.query(
      'SELECT cs.*, ct.name as template_name, ct.channel, ct.content FROM campaign_sequences cs JOIN campaign_templates ct ON ct.id = cs.template_id WHERE cs.id = $1',
      [stepId]
    );
    res.json(row.rows[0]);
  }));

  router.delete('/:campaignId/sequences/:stepId', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { campaignId, stepId } = req.params;
    const campaign = await pool.query(
      'SELECT id FROM campaigns WHERE id = $1 AND organization_id = $2',
      [campaignId, organizationId]
    );
    if (campaign.rows.length === 0) {
      throw new AppError(404, 'Campaign not found', ErrorCodes.NOT_FOUND);
    }
    await pool.query(
      'DELETE FROM campaign_sequences WHERE id = $1 AND campaign_id = $2',
      [stepId, campaignId]
    );
    res.status(204).send();
  }));

  return router;
}
