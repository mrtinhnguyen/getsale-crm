import { Pool } from 'pg';
import { AppError, ErrorCodes } from '@getsale/service-core';
import { LeadActivityLogType } from '@getsale/types';
import type { LeadContextRow, TimelineRow } from '../types';
import { SYSTEM_MESSAGES } from '../system-messages';

/** Validate conversation_id and fetch lead conversation row or throw 400/404. */
export async function getLeadConversationOrThrow<T>(
  pool: Pool,
  conversationId: string | undefined,
  organizationId: string,
  columns: string
): Promise<T> {
  if (!conversationId || typeof conversationId !== 'string') {
    throw new AppError(400, 'conversation_id required', ErrorCodes.VALIDATION);
  }
  const r = await pool.query(
    `SELECT ${columns} FROM conversations WHERE id = $1 AND organization_id = $2 AND lead_id IS NOT NULL`,
    [conversationId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new AppError(404, 'Conversation not found or not a lead', ErrorCodes.NOT_FOUND);
  }
  return r.rows[0] as T;
}

const LEAD_CONTEXT_COLUMNS = `
  c.id AS conversation_id, c.lead_id, c.campaign_id, c.became_lead_at, c.contact_id,
  c.bd_account_id, c.channel_id,
  c.shared_chat_created_at, c.shared_chat_channel_id, c.shared_chat_invite_link,
  c.won_at, COALESCE(l.revenue_amount, c.revenue_amount) AS revenue_amount, c.lost_at, c.loss_reason,
  l.pipeline_id, l.stage_id, l.responsible_id,
  p.name AS pipeline_name,
  st.name AS stage_name,
  u.email AS responsible_email,
  COALESCE(
    NULLIF(TRIM(c2.display_name), ''),
    NULLIF(TRIM(CONCAT(COALESCE(c2.first_name,''), ' ', COALESCE(c2.last_name,''))), ''),
    c2.username,
    c2.telegram_id::text
  ) AS contact_name,
  c2.telegram_id AS contact_telegram_id,
  c2.username AS contact_username,
  camp.name AS campaign_name,
  co.name AS company_name`;

const LEAD_CONTEXT_JOINS = `
  FROM conversations c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN users u ON u.id = l.responsible_id
  LEFT JOIN pipelines p ON p.id = l.pipeline_id
  LEFT JOIN stages st ON st.id = l.stage_id
  LEFT JOIN contacts c2 ON c2.id = c.contact_id
  LEFT JOIN companies co ON co.id = c2.company_id
  LEFT JOIN campaigns camp ON camp.id = c.campaign_id`;

/**
 * Unified lead-context query supporting lookup by conversationId or leadId.
 * Returns the raw row; call buildLeadContextPayload to shape the response.
 */
export async function getLeadContext(
  pool: Pool,
  params: { conversationId?: string; leadId?: string; orgId: string }
): Promise<LeadContextRow> {
  const { conversationId, leadId, orgId } = params;
  if (conversationId) return getLeadContextByConversation(pool, conversationId, orgId);
  if (leadId) return getLeadContextByLead(pool, leadId, orgId);
  throw new AppError(400, 'conversationId or leadId required', ErrorCodes.VALIDATION);
}

async function getLeadContextByConversation(pool: Pool, conversationId: string, orgId: string): Promise<LeadContextRow> {
  const conv = await pool.query(
    `SELECT ${LEAD_CONTEXT_COLUMNS} ${LEAD_CONTEXT_JOINS}
     WHERE c.id = $1 AND c.organization_id = $2`,
    [conversationId, orgId]
  );
  if (conv.rows.length === 0) {
    throw new AppError(404, 'Conversation not found', ErrorCodes.NOT_FOUND);
  }
  let row = conv.rows[0] as LeadContextRow;

  if (row.lead_id == null && row.contact_id) {
    const fallback = await pool.query(
      `SELECT l.id AS lead_id, l.contact_id, l.pipeline_id, l.stage_id, l.responsible_id, l.created_at AS became_lead_at,
              $3::uuid AS conversation_id, $4 AS bd_account_id, $5 AS channel_id,
              $6::uuid AS campaign_id, $7 AS campaign_name,
              l.revenue_amount,
              p.name AS pipeline_name, st.name AS stage_name,
              u.email AS responsible_email,
              COALESCE(
                NULLIF(TRIM(c2.display_name), ''),
                NULLIF(TRIM(CONCAT(COALESCE(c2.first_name,''), ' ', COALESCE(c2.last_name,''))), ''),
                c2.username, c2.telegram_id::text
              ) AS contact_name,
              c2.telegram_id AS contact_telegram_id,
              c2.username AS contact_username,
              co.name AS company_name,
              NULL::timestamptz AS shared_chat_created_at, NULL AS shared_chat_channel_id, NULL AS shared_chat_invite_link,
              NULL::timestamptz AS won_at, NULL::timestamptz AS lost_at, NULL AS loss_reason
       FROM leads l
       LEFT JOIN users u ON u.id = l.responsible_id
       LEFT JOIN pipelines p ON p.id = l.pipeline_id
       LEFT JOIN stages st ON st.id = l.stage_id
       LEFT JOIN contacts c2 ON c2.id = l.contact_id
       LEFT JOIN companies co ON co.id = c2.company_id
       WHERE l.contact_id = $1 AND l.organization_id = $2
       ORDER BY l.created_at DESC LIMIT 1`,
      [row.contact_id, orgId, row.conversation_id, row.bd_account_id, row.channel_id, row.campaign_id, row.campaign_name ?? null]
    );
    if (fallback.rows.length > 0) {
      row = fallback.rows[0];
    }
  }

  if (row.lead_id == null) {
    throw new AppError(404, 'No lead for this conversation', ErrorCodes.NOT_FOUND);
  }
  return row;
}

async function getLeadContextByLead(pool: Pool, leadId: string, orgId: string): Promise<LeadContextRow> {
  const conv = await pool.query(
    `SELECT ${LEAD_CONTEXT_COLUMNS} ${LEAD_CONTEXT_JOINS}
     WHERE c.lead_id = $1 AND c.organization_id = $2`,
    [leadId, orgId]
  );

  if (conv.rows.length > 0 && conv.rows[0].lead_id != null) {
    return conv.rows[0];
  }

  const leadOnly = await pool.query(
    `SELECT l.id AS lead_id, l.contact_id, l.pipeline_id, l.stage_id, l.responsible_id, l.created_at AS became_lead_at,
            NULL::uuid AS conversation_id, NULL AS bd_account_id, NULL AS channel_id,
            NULL AS campaign_id, NULL AS campaign_name,
            NULL::timestamptz AS shared_chat_created_at, NULL AS shared_chat_channel_id, NULL AS shared_chat_invite_link,
            NULL::timestamptz AS won_at, l.revenue_amount, NULL::timestamptz AS lost_at, NULL AS loss_reason,
            p.name AS pipeline_name, st.name AS stage_name,
            u.email AS responsible_email,
            COALESCE(
              NULLIF(TRIM(c2.display_name), ''),
              NULLIF(TRIM(CONCAT(COALESCE(c2.first_name,''), ' ', COALESCE(c2.last_name,''))), ''),
              c2.username,
              c2.telegram_id::text
            ) AS contact_name,
            c2.telegram_id AS contact_telegram_id,
            c2.username AS contact_username,
            co.name AS company_name
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsible_id
     LEFT JOIN pipelines p ON p.id = l.pipeline_id
     LEFT JOIN stages st ON st.id = l.stage_id
     LEFT JOIN contacts c2 ON c2.id = l.contact_id AND c2.organization_id = l.organization_id
     LEFT JOIN companies co ON co.id = c2.company_id
     WHERE l.id = $1 AND l.organization_id = $2`,
    [leadId, orgId]
  );
  if (leadOnly.rows.length === 0) {
    throw new AppError(404, 'Lead not found', ErrorCodes.NOT_FOUND);
  }
  return leadOnly.rows[0];
}

/** Build the full lead-context response payload from a raw row. */
export async function buildLeadContextPayload(pool: Pool, organizationId: string, row: LeadContextRow) {
  const pipelineId = row.pipeline_id;
  const leadId = row.lead_id;

  let sharedChatSettings: { titleTemplate: string; extraUsernames: string[] } = {
    titleTemplate: SYSTEM_MESSAGES.SHARED_CHAT_TITLE_TEMPLATE,
    extraUsernames: [],
  };
  const settingsRow = await pool.query(
    `SELECT value FROM organization_settings WHERE organization_id = $1 AND key = 'shared_chat'`,
    [organizationId]
  );
  if (settingsRow.rows.length > 0 && settingsRow.rows[0].value) {
    const v = settingsRow.rows[0].value as Record<string, unknown>;
    if (typeof v?.titleTemplate === 'string') sharedChatSettings.titleTemplate = v.titleTemplate;
    if (Array.isArray(v?.extraUsernames)) sharedChatSettings.extraUsernames = v.extraUsernames.filter((u): u is string => typeof u === 'string');
  }

  const [stagesResult, timelineResult] = await Promise.all([
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM stages WHERE pipeline_id = $1 AND organization_id = $2 ORDER BY order_index`,
      [pipelineId, organizationId]
    ),
    pool.query(
      `SELECT lal.type, lal.created_at, lal.metadata, s.name AS to_stage_name
       FROM lead_activity_log lal
       LEFT JOIN stages s ON s.id = (lal.metadata->>'to_stage_id')::uuid
       WHERE lal.lead_id = $1 AND lal.type IN ($2, $3, $4)
       ORDER BY lal.created_at DESC
       LIMIT 10`,
      [leadId, LeadActivityLogType.LEAD_CREATED, LeadActivityLogType.STAGE_CHANGED, LeadActivityLogType.DEAL_CREATED]
    ),
  ]);

  const timeline = timelineResult.rows.map((t: unknown) => {
    const tr = t as TimelineRow;
    const item: { type: string; created_at: string; stage_name?: string } = {
      type: tr.type,
      created_at: tr.created_at instanceof Date ? tr.created_at.toISOString() : String(tr.created_at),
    };
    if (tr.type === 'stage_changed' && tr.to_stage_name != null) {
      item.stage_name = tr.to_stage_name;
    }
    return item;
  });

  return {
    conversation_id: row.conversation_id,
    lead_id: row.lead_id,
    contact_id: row.contact_id ?? null,
    contact_name: row.contact_name ?? '',
    contact_telegram_id: row.contact_telegram_id != null ? String(row.contact_telegram_id) : null,
    contact_username: typeof row.contact_username === 'string' ? row.contact_username : null,
    company_name: row.company_name != null ? String(row.company_name).trim() || null : null,
    bd_account_id: row.bd_account_id ?? null,
    channel_id: row.channel_id ?? null,
    responsible_id: row.responsible_id ?? null,
    responsible_email: row.responsible_email != null ? String(row.responsible_email).trim() || null : null,
    pipeline: { id: row.pipeline_id, name: row.pipeline_name ?? '' },
    stage: { id: row.stage_id, name: row.stage_name ?? '' },
    stages: stagesResult.rows.map((s) => ({ id: s.id, name: s.name })),
    campaign: row.campaign_id != null ? { id: row.campaign_id, name: row.campaign_name ?? '' } : null,
    became_lead_at: row.became_lead_at instanceof Date ? row.became_lead_at.toISOString() : row.became_lead_at,
    shared_chat_created_at: row.shared_chat_created_at != null && row.shared_chat_created_at instanceof Date ? row.shared_chat_created_at.toISOString() : row.shared_chat_created_at,
    shared_chat_channel_id: row.shared_chat_channel_id != null ? String(row.shared_chat_channel_id) : null,
    shared_chat_invite_link: row.shared_chat_invite_link != null ? String(row.shared_chat_invite_link).trim() || null : null,
    won_at: row.won_at != null && row.won_at instanceof Date ? row.won_at.toISOString() : row.won_at,
    revenue_amount: row.revenue_amount != null ? Number(row.revenue_amount) : null,
    lost_at: row.lost_at != null && row.lost_at instanceof Date ? row.lost_at.toISOString() : row.lost_at,
    loss_reason: row.loss_reason != null ? String(row.loss_reason) : null,
    shared_chat_settings: sharedChatSettings,
    timeline,
  };
}
