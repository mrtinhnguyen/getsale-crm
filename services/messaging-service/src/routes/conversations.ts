import { Router } from 'express';
import { Pool } from 'pg';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';

interface Deps {
  pool: Pool;
}

export function conversationsRouter({ pool }: Deps): Router {
  const router = Router();

  // GET /new-leads — folder «Новые лиды»: one row per lead (lead_id != null, first_manager_reply_at IS NULL), deduplicated
  router.get('/new-leads', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const result = await pool.query(
      `SELECT DISTINCT ON (conv.lead_id)
              conv.id AS conversation_id, conv.organization_id, conv.bd_account_id, conv.channel, conv.channel_id,
              conv.contact_id, conv.lead_id, conv.campaign_id, conv.became_lead_at, conv.last_viewed_at,
              st.name AS lead_stage_name, p.name AS lead_pipeline_name, l.stage_id,
              c.first_name, c.last_name, c.display_name, c.username, c.telegram_id,
              (SELECT COUNT(*)::int FROM messages m WHERE m.organization_id = conv.organization_id AND m.channel = conv.channel AND m.channel_id = conv.channel_id AND m.bd_account_id IS NOT DISTINCT FROM conv.bd_account_id AND m.unread = true) AS unread_count,
              (SELECT MAX(COALESCE(m.telegram_date, m.created_at)) FROM messages m WHERE m.organization_id = conv.organization_id AND m.channel = conv.channel AND m.channel_id = conv.channel_id AND m.bd_account_id IS NOT DISTINCT FROM conv.bd_account_id) AS last_message_at,
              (SELECT COALESCE(NULLIF(TRIM(m2.content), ''), '[Media]') FROM messages m2 WHERE m2.organization_id = conv.organization_id AND m2.channel = conv.channel AND m2.channel_id = conv.channel_id AND m2.bd_account_id IS NOT DISTINCT FROM conv.bd_account_id ORDER BY COALESCE(m2.telegram_date, m2.created_at) DESC LIMIT 1) AS last_message
       FROM conversations conv
       JOIN leads l ON l.id = conv.lead_id
       JOIN stages st ON st.id = l.stage_id
       JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN contacts c ON c.id = conv.contact_id
       WHERE conv.organization_id = $1 AND conv.lead_id IS NOT NULL AND conv.first_manager_reply_at IS NULL
       ORDER BY conv.lead_id, conv.became_lead_at DESC NULLS LAST`,
      [organizationId]
    );
    // Return rows in became_lead_at desc order (reorder after DISTINCT ON)
    const rows = (result.rows as Array<{ became_lead_at: string | Date | null; [k: string]: unknown }>).sort((a, b) => {
      const at = a.became_lead_at ? new Date(a.became_lead_at).getTime() : 0;
      const bt = b.became_lead_at ? new Date(b.became_lead_at).getTime() : 0;
      return bt - at;
    });
    res.json(rows);
  }));

  // PATCH /conversations/:id/view — set last_viewed_at
  router.patch('/conversations/:id/view', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE conversations SET last_viewed_at = NOW(), updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [id, organizationId]
    );
    if (r.rows.length === 0) {
      throw new AppError(404, 'Conversation not found', ErrorCodes.NOT_FOUND);
    }
    res.json({ ok: true });
  }));

  // GET /resolve-contact — resolve contact to bd_account_id + channel_id
  router.get('/resolve-contact', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const contactId = req.query.contactId;
    if (!contactId || typeof contactId !== 'string') {
      throw new AppError(400, 'contactId required', ErrorCodes.VALIDATION);
    }
    const row = await pool.query(
      `SELECT bd_account_id, channel_id FROM conversations
       WHERE organization_id = $1 AND contact_id = $2
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [organizationId, contactId]
    );
    if (row.rows.length === 0) {
      throw new AppError(404, 'No conversation for this contact', ErrorCodes.NOT_FOUND);
    }
    const r = row.rows[0] as { bd_account_id: string; channel_id: string };
    res.json({ bd_account_id: r.bd_account_id, channel_id: r.channel_id });
  }));

  return router;
}
