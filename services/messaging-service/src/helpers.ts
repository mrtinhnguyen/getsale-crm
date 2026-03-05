import { Pool } from 'pg';

/** Single point of conversation creation. Call before saving any message. */
export async function ensureConversation(
  db: Pool,
  params: { organizationId: string; bdAccountId: string | null; channel: string; channelId: string; contactId: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO conversations (id, organization_id, bd_account_id, channel, channel_id, contact_id, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (organization_id, bd_account_id, channel, channel_id)
     DO UPDATE SET contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id), updated_at = NOW()`,
    [params.organizationId, params.bdAccountId, params.channel, params.channelId, params.contactId]
  );
  if (params.contactId) {
    await db.query(
      `UPDATE conversations c SET lead_id = sub.id, became_lead_at = COALESCE(c.became_lead_at, sub.created_at), updated_at = NOW()
       FROM (SELECT id, created_at FROM leads WHERE organization_id = $1 AND contact_id = $5 ORDER BY created_at DESC LIMIT 1) sub
       WHERE c.organization_id = $1 AND c.bd_account_id IS NOT DISTINCT FROM $2 AND c.channel = $3 AND c.channel_id = $4 AND c.lead_id IS NULL`,
      [params.organizationId, params.bdAccountId, params.channel, params.channelId, params.contactId]
    );
  }
}

/** Attach lead to conversation (idempotent). Triggered by LEAD_CREATED_FROM_CAMPAIGN. */
export async function attachLead(
  db: Pool,
  params: { conversationId: string; leadId: string; campaignId: string }
): Promise<void> {
  await db.query(
    `UPDATE conversations SET lead_id = $1, campaign_id = $2, became_lead_at = COALESCE(became_lead_at, NOW()), updated_at = NOW()
     WHERE id = $3 AND (lead_id IS NULL OR lead_id = $1)`,
    [params.leadId, params.campaignId, params.conversationId]
  );
}

export const MESSAGES_FOR_AI_LIMIT = 200;
export const AI_INSIGHT_MODEL_VERSION = 'gpt-4';
export const ALLOWED_EMOJI = ['👍', '👎', '❤️', '🔥', '👏', '😄', '😮', '😢', '🙏'];
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const UNFURL_TIMEOUT_MS = 4000;
export const UNFURL_MAX_BODY = 300_000; // 300 KB
export const URL_REGEX = /^https?:\/\/[^\s<>"']+$/i;
