// @ts-nocheck — GramJS types are incomplete
import { Api } from 'telegram';
import type { TelegramManagerDeps, TelegramClientInfo, StructuredLog } from './types';
import type { Pool } from 'pg';

const REACTION_EMOJI_ALLOWED_NFC = new Set(
  ['👍', '👎', '❤️', '🔥', '👏', '😄', '😮', '😢', '🙏'].map((e) => e.normalize('NFC'))
);

function normalizeReactionEmoji(emoji: string): string | null {
  if (typeof emoji !== 'string' || !emoji.trim()) return null;
  const normalized = emoji.trim().normalize('NFC');
  return REACTION_EMOJI_ALLOWED_NFC.has(normalized) ? normalized : null;
}

/**
 * Message reactions: send/update reactions on messages.
 */
export class ReactionHandler {
  private readonly pool: Pool;
  private readonly log: StructuredLog;
  private readonly clients: Map<string, TelegramClientInfo>;

  constructor(private readonly deps: TelegramManagerDeps) {
    this.pool = deps.pool;
    this.log = deps.log;
    this.clients = deps.clients;
  }

  async sendReaction(
    accountId: string,
    chatId: string,
    telegramMessageId: number,
    reactionEmojis: string[]
  ): Promise<void> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }
    const client = clientInfo.client;
    const peer = await client.getInputEntity(chatId);
    const reaction = (reactionEmojis || [])
      .map((e) => normalizeReactionEmoji(e))
      .filter((e): e is string => e != null)
      .filter((e, i, a) => a.indexOf(e) === i)
      .slice(0, 3)
      .map((emoticon) => new Api.ReactionEmoji({ emoticon }));
    await client.invoke(
      new Api.messages.SendReaction({
        peer,
        msgId: telegramMessageId,
        reaction,
      })
    );
    clientInfo.lastActivity = new Date();
    await this.pool.query(
      'UPDATE bd_accounts SET last_activity = NOW() WHERE id = $1',
      [accountId]
    );
  }
}
