// @ts-nocheck — GramJS types are incomplete
import type { Pool } from 'pg';
import type { SerializedTelegramMessage } from '../telegram-serialize';
import { reactionsFromTelegramExtra, ourReactionsFromTelegramExtra } from './helpers';
import type { StructuredLog } from './types';

/**
 * DB operations for conversations and messages.
 */
export class MessageDb {
  constructor(
    private readonly pool: Pool,
    private readonly log: StructuredLog
  ) {}

  async ensureConversation(params: {
    organizationId: string;
    bdAccountId: string;
    channel: string;
    channelId: string;
    contactId: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversations (id, organization_id, bd_account_id, channel, channel_id, contact_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (organization_id, bd_account_id, channel, channel_id)
       DO UPDATE SET contact_id = COALESCE(EXCLUDED.contact_id, conversations.contact_id), updated_at = NOW()`,
      [params.organizationId, params.bdAccountId, params.channel, params.channelId, params.contactId]
    );
  }

  async saveMessageToDb(params: {
    organizationId: string;
    bdAccountId: string;
    contactId: string | null;
    channel: string;
    channelId: string;
    direction: string;
    status: string;
    unread: boolean;
    serialized: SerializedTelegramMessage;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const {
      organizationId,
      bdAccountId,
      contactId,
      channel,
      channelId,
      direction,
      status,
      unread,
      serialized,
      metadata = {},
    } = params;

    await this.ensureConversation({ organizationId, bdAccountId, channel, channelId, contactId });

    const {
      telegram_message_id,
      telegram_date,
      content,
      telegram_entities,
      telegram_media,
      reply_to_telegram_id,
      telegram_extra,
    } = serialized;

    const reactionsFromTg = reactionsFromTelegramExtra(telegram_extra);
    const reactionsJson = reactionsFromTg ? JSON.stringify(reactionsFromTg) : null;
    const ourReactionsFromTg = ourReactionsFromTelegramExtra(telegram_extra);
    const ourReactionsJson = ourReactionsFromTg?.length ? JSON.stringify(ourReactionsFromTg) : null;

    const result = await this.pool.query(
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
        telegram_message_id || null,
        telegram_date,
        reply_to_telegram_id,
        telegram_entities ? JSON.stringify(telegram_entities) : null,
        telegram_media ? JSON.stringify(telegram_media) : null,
        Object.keys(telegram_extra).length ? JSON.stringify(telegram_extra) : null,
        reactionsJson,
        ourReactionsJson,
      ]
    );
    return result.rows[0];
  }

  async isChatAllowedForAccount(accountId: string, telegramChatId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM bd_account_sync_chats WHERE bd_account_id = $1 AND telegram_chat_id = $2 LIMIT 1',
      [accountId, telegramChatId]
    );
    return result.rows.length > 0;
  }

  async isChatInNonAllChatsFolder(accountId: string, telegramChatId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM (
        SELECT folder_id FROM bd_account_sync_chats WHERE bd_account_id = $1 AND telegram_chat_id = $2 AND folder_id IS NOT NULL AND folder_id <> 0
        UNION
        SELECT folder_id FROM bd_account_sync_chat_folders WHERE bd_account_id = $1 AND telegram_chat_id = $2 AND folder_id <> 0
      ) u LIMIT 1`,
      [accountId, telegramChatId]
    );
    return result.rows.length > 0;
  }
}
