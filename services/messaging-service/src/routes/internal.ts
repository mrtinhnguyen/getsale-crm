import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, withOrgContext } from '@getsale/service-core';
import { ensureConversation } from '../helpers';
import { z } from 'zod';

/** S1: Prefer X-Organization-Id header over body for tenant context. */
function getOrganizationId(req: { headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown> }, bodyOrgId?: string): string | null {
  const raw = req.headers['x-organization-id'];
  const fromHeader = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? raw[0]?.trim() : null;
  if (fromHeader) return fromHeader;
  return bodyOrgId ?? null;
}

const EnsureConversationSchema = z.object({
  organizationId: z.string().uuid(),
  bdAccountId: z.string().uuid(),
  channel: z.string().min(1).max(64),
  channelId: z.string().min(1).max(256),
  contactId: z.string().uuid().nullable(),
});

/** Accept string or number from bd-accounts (SerializedTelegramMessage uses string); normalize to number for DB. */
const telegramIdSchema = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? null : n;
  });

const SerializedTelegramSchema = z.object({
  telegram_message_id: telegramIdSchema,
  telegram_date: z.union([z.string(), z.date(), z.number()]).nullable().optional(),
  content: z.string(),
  telegram_entities: z.unknown().nullable().optional(),
  telegram_media: z.unknown().nullable().optional(),
  reply_to_telegram_id: telegramIdSchema,
  telegram_extra: z.record(z.unknown()).optional(),
});

const CreateMessageSchema = z.object({
  organizationId: z.string().uuid(),
  bdAccountId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  channel: z.string().min(1).max(64),
  channelId: z.string().min(1).max(256),
  direction: z.string().min(1).max(32),
  status: z.string().min(1).max(32),
  unread: z.boolean(),
  serialized: SerializedTelegramSchema,
  metadata: z.record(z.unknown()).optional(),
  /** Pre-computed by caller (e.g. bd-accounts) from telegram_extra */
  reactions: z.unknown().optional(),
  our_reactions: z.unknown().optional(),
});

/** A1 Stage 2: edit message by Telegram identifiers (bd-accounts → messaging only) */
const EditByTelegramSchema = z.object({
  bdAccountId: z.string().uuid(),
  channelId: z.string().min(1).max(256),
  telegramMessageId: z.number().int(),
  content: z.string(),
  telegram_entities: z.unknown().nullable().optional(),
  telegram_media: z.unknown().nullable().optional(),
});

/** A1 Stage 2: delete messages by Telegram identifiers (bd-accounts → messaging only) */
const DeleteByTelegramSchema = z.object({
  bdAccountId: z.string().uuid(),
  /** Required for channel/supergroup deletes (UpdateDeleteChannelMessages) */
  channelId: z.string().min(1).max(256).optional(),
  telegramMessageIds: z.array(z.number().int()).min(1).max(500),
});

/** S2/A1: orphan messages when bd-account is deleted; caller must send X-Organization-Id */
const OrphanByBdAccountSchema = z.object({
  bdAccountId: z.string().uuid(),
});

interface Deps {
  pool: Pool;
  log: Logger;
}

/**
 * Internal router for service-to-service calls (e.g. bd-accounts persisting Telegram messages).
 * Protects ownership of messages/conversations tables; only messaging-service writes to them.
 * Protected by internalAuth at app level.
 */
export function internalMessagingRouter({ pool, log }: Deps): Router {
  const router = Router();

  router.post('/conversations/ensure', asyncHandler(async (req, res) => {
    const parsed = EnsureConversationSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = process.env.NODE_ENV === 'production' ? 'Validation failed' : 'Invalid body: ' + parsed.error.message;
      throw new AppError(400, msg, ErrorCodes.BAD_REQUEST);
    }
    const { organizationId: bodyOrgId, bdAccountId, channel, channelId, contactId } = parsed.data;
    const organizationId = getOrganizationId(req, bodyOrgId) ?? bodyOrgId;
    if (!organizationId) {
      throw new AppError(400, 'X-Organization-Id header or body.organizationId required', ErrorCodes.BAD_REQUEST);
    }
    await withOrgContext(pool, organizationId, async (client) => {
      await ensureConversation(client, {
        organizationId,
        bdAccountId,
        channel,
        channelId,
        contactId,
      });
    });
    res.status(204).end();
  }));

  router.post('/messages', asyncHandler(async (req, res) => {
    const parsed = CreateMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = process.env.NODE_ENV === 'production' ? 'Validation failed' : 'Invalid body: ' + parsed.error.message;
      throw new AppError(400, msg, ErrorCodes.BAD_REQUEST);
    }
    const {
      organizationId: bodyOrgId,
      bdAccountId,
      contactId,
      channel,
      channelId,
      direction,
      status,
      unread,
      serialized,
      metadata = {},
      reactions: reactionsPayload,
      our_reactions: ourReactionsPayload,
    } = parsed.data;

    const organizationId = getOrganizationId(req, bodyOrgId) ?? bodyOrgId;
    if (!organizationId) {
      throw new AppError(400, 'X-Organization-Id header or body.organizationId required', ErrorCodes.BAD_REQUEST);
    }

    await withOrgContext(pool, organizationId, async (client) => {
    await ensureConversation(client, {
      organizationId,
      bdAccountId,
      channel,
      channelId,
      contactId,
    });

    const {
      telegram_message_id,
      telegram_date,
      content,
      telegram_entities,
      telegram_media,
      reply_to_telegram_id,
      telegram_extra = {},
    } = serialized;

    const reactionsJson =
      reactionsPayload != null ? JSON.stringify(reactionsPayload) : null;
    const ourReactionsJson =
      ourReactionsPayload != null && Array.isArray(ourReactionsPayload) && ourReactionsPayload.length > 0
        ? JSON.stringify(ourReactionsPayload)
        : ourReactionsPayload != null
          ? JSON.stringify(ourReactionsPayload)
          : null;

    const telegramDate =
      telegram_date instanceof Date
        ? telegram_date
        : typeof telegram_date === 'string'
          ? new Date(telegram_date)
          : typeof telegram_date === 'number'
            ? new Date(telegram_date * 1000)
            : null;
    const telegramDateVal = telegramDate && !Number.isNaN(telegramDate.getTime()) ? telegramDate : null;

    const result = await client.query(
      `INSERT INTO messages (
        organization_id, bd_account_id, contact_id, channel, channel_id, direction, content, status, unread,
        metadata, telegram_message_id, telegram_date, loaded_at, reply_to_telegram_id, telegram_entities, telegram_media, telegram_extra, reactions, our_reactions
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16, $17, $18)
      ON CONFLICT (bd_account_id, channel_id, telegram_message_id) WHERE (telegram_message_id IS NOT NULL)
      DO UPDATE SET
        content = EXCLUDED.content,
        reply_to_telegram_id = COALESCE(EXCLUDED.reply_to_telegram_id, messages.reply_to_telegram_id),
        telegram_entities = EXCLUDED.telegram_entities,
        telegram_media = EXCLUDED.telegram_media,
        telegram_extra = EXCLUDED.telegram_extra,
        reactions = COALESCE(EXCLUDED.reactions, messages.reactions),
        our_reactions = COALESCE(EXCLUDED.our_reactions, messages.our_reactions),
        unread = EXCLUDED.unread,
        updated_at = NOW()
      RETURNING id`,
      [
        organizationId,
        bdAccountId,
        contactId,
        channel,
        channelId,
        direction,
        content,
        status,
        unread,
        JSON.stringify(metadata),
        telegram_message_id ?? null,
        telegramDateVal,
        reply_to_telegram_id ?? null,
        telegram_entities != null ? JSON.stringify(telegram_entities) : null,
        telegram_media != null ? JSON.stringify(telegram_media) : null,
        Object.keys(telegram_extra).length > 0 ? JSON.stringify(telegram_extra) : null,
        reactionsJson,
        ourReactionsJson,
      ]
    );
    const row = result.rows[0] as { id: string };
    res.status(200).json({ id: row.id });
    });
  }));

  // A1 Stage 2: edit message by Telegram (bd_account_id, channel_id, telegram_message_id). S4: require X-Organization-Id.
  router.patch('/messages/edit-by-telegram', asyncHandler(async (req, res) => {
    const parsed = EditByTelegramSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = process.env.NODE_ENV === 'production' ? 'Validation failed' : 'Invalid body: ' + parsed.error.message;
      throw new AppError(400, msg, ErrorCodes.BAD_REQUEST);
    }
    const organizationId = getOrganizationId(req);
    if (!organizationId) {
      throw new AppError(400, 'X-Organization-Id header required', ErrorCodes.BAD_REQUEST);
    }
    const { bdAccountId, channelId, telegramMessageId, content, telegram_entities, telegram_media } = parsed.data;
    const result = await pool.query(
      `UPDATE messages SET content = $1, updated_at = NOW(), telegram_entities = $2, telegram_media = $3
       WHERE bd_account_id = $4 AND channel_id = $5 AND telegram_message_id = $6 AND organization_id = $7
       RETURNING id, organization_id`,
      [
        content,
        telegram_entities != null ? JSON.stringify(telegram_entities) : null,
        telegram_media != null ? JSON.stringify(telegram_media) : null,
        bdAccountId,
        channelId,
        telegramMessageId,
        organizationId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const row = result.rows[0] as { id: string; organization_id: string };
    res.status(200).json({ id: row.id, organization_id: row.organization_id });
  }));

  // A1 Stage 2: delete messages by Telegram ids; returns deleted rows for MESSAGE_DELETED events. S4: require X-Organization-Id.
  router.post('/messages/delete-by-telegram', asyncHandler(async (req, res) => {
    const parsed = DeleteByTelegramSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = process.env.NODE_ENV === 'production' ? 'Validation failed' : 'Invalid body: ' + parsed.error.message;
      throw new AppError(400, msg, ErrorCodes.BAD_REQUEST);
    }
    const organizationId = getOrganizationId(req);
    if (!organizationId) {
      throw new AppError(400, 'X-Organization-Id header required', ErrorCodes.BAD_REQUEST);
    }
    const { bdAccountId, channelId, telegramMessageIds } = parsed.data;
    const result =
      channelId != null
        ? await pool.query(
            `DELETE FROM messages WHERE bd_account_id = $1 AND channel_id = $2 AND telegram_message_id = ANY($3::bigint[]) AND organization_id = $4
             RETURNING id, organization_id, channel_id, telegram_message_id`,
            [bdAccountId, channelId, telegramMessageIds, organizationId]
          )
        : await pool.query(
            `DELETE FROM messages WHERE bd_account_id = $1 AND telegram_message_id = ANY($2::bigint[]) AND organization_id = $3
             RETURNING id, organization_id, channel_id, telegram_message_id`,
            [bdAccountId, telegramMessageIds, organizationId]
          );
    const deleted = (result.rows as Array<{ id: string; organization_id: string; channel_id: string; telegram_message_id: number }>).map(
      (r) => ({ id: r.id, organization_id: r.organization_id, channel_id: r.channel_id, telegram_message_id: r.telegram_message_id })
    );
    res.status(200).json({ deleted });
  }));

  // S2/A1: orphan messages when bd-account is deleted; bd-accounts calls this before deleting sync tables and account.
  router.post('/messages/orphan-by-bd-account', asyncHandler(async (req, res) => {
    const parsed = OrphanByBdAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = process.env.NODE_ENV === 'production' ? 'Validation failed' : 'Invalid body: ' + parsed.error.message;
      throw new AppError(400, msg, ErrorCodes.BAD_REQUEST);
    }
    const organizationId = getOrganizationId(req);
    if (!organizationId) {
      throw new AppError(400, 'X-Organization-Id header required', ErrorCodes.BAD_REQUEST);
    }
    const { bdAccountId } = parsed.data;
    await withOrgContext(pool, organizationId, async (client) => {
      await client.query(
        'UPDATE messages SET bd_account_id = NULL WHERE bd_account_id = $1 AND organization_id = $2',
        [bdAccountId, organizationId]
      );
    });
    res.status(204).end();
  }));

  return router;
}
