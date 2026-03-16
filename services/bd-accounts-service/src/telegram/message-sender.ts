// @ts-nocheck — GramJS types are incomplete
import { Api } from 'telegram';
import { getErrorMessage } from '../helpers';
import type { TelegramManagerDeps, TelegramClientInfo, StructuredLog } from './types';
import type { Pool } from 'pg';

/**
 * Sending messages, typing, read receipts, drafts.
 */
export class MessageSender {
  private readonly pool: Pool;
  private readonly log: StructuredLog;
  private readonly clients: Map<string, TelegramClientInfo>;

  constructor(private readonly deps: TelegramManagerDeps) {
    this.pool = deps.pool;
    this.log = deps.log;
    this.clients = deps.clients;
  }

  async sendMessage(
    accountId: string,
    chatId: string,
    text: string,
    opts: { replyTo?: number } = {}
  ): Promise<Api.Message> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }

    try {
      const message = await clientInfo.client.sendMessage(chatId, {
        message: text,
        ...(opts.replyTo != null ? { replyTo: opts.replyTo } : {}),
      });

      clientInfo.lastActivity = new Date();
      await this.pool.query(
        'UPDATE bd_accounts SET last_activity = NOW() WHERE id = $1',
        [accountId]
      );

      return message;
    } catch (error: unknown) {
      this.log.error({ message: `Error sending message`, error: getErrorMessage(error) });
      throw error;
    }
  }

  async setTyping(accountId: string, chatId: string): Promise<void> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }
    try {
      const peer = await clientInfo.client.getInputEntity(chatId);
      await clientInfo.client.invoke(
        new Api.messages.SetTyping({ peer, action: new Api.SendMessageTypingAction() })
      );
    } catch (error: unknown) {
      this.log.warn({ message: 'setTyping failed', accountId, chatId, error: getErrorMessage(error) });
    }
  }

  async markAsRead(accountId: string, chatId: string): Promise<void> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }
    try {
      const entity = await clientInfo.client.getInputEntity(chatId);
      if ((entity as any).className === 'InputPeerChannel') {
        await clientInfo.client.invoke(
          new Api.channels.ReadHistory({ channel: entity as any, maxId: 0 })
        );
      } else {
        await clientInfo.client.invoke(
          new Api.messages.ReadHistory({ peer: entity, maxId: 0 })
        );
      }
    } catch (error: unknown) {
      this.log.warn({ message: 'markAsRead failed', accountId, chatId, error: getErrorMessage(error) });
    }
  }

  async saveDraft(
    accountId: string,
    chatId: string,
    text: string,
    opts: { replyToMsgId?: number } = {}
  ): Promise<void> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }
    const client = clientInfo.client;
    const ApiAny = Api as any;
    const peer = await client.getInputEntity(chatId);
    const replyTo = opts.replyToMsgId != null ? { replyToMsgId: opts.replyToMsgId } : undefined;
    await client.invoke(
      new ApiAny.messages.SaveDraft({
        peer,
        message: text || '',
        ...(replyTo ? { replyTo } : {}),
      })
    );
    clientInfo.lastActivity = new Date();
  }

  async forwardMessage(
    accountId: string,
    fromChatId: string,
    toChatId: string,
    telegramMessageId: number
  ): Promise<Api.Message> {
    const clientInfo = this.clients.get(accountId);
    if (!clientInfo || !clientInfo.isConnected) {
      throw new Error(`Account ${accountId} is not connected`);
    }
    const client = clientInfo.client;
    const fromPeer = await client.getInputEntity(fromChatId);
    const toPeer = await client.getInputEntity(toChatId);
    const randomId = BigInt(Math.floor(Math.random() * 1e15)) * BigInt(1e5) + BigInt(Math.floor(Math.random() * 1e5));
    const result = await client.invoke(
      new Api.messages.ForwardMessages({
        fromPeer,
        toPeer,
        id: [telegramMessageId],
        randomId: [randomId],
      })
    );
    clientInfo.lastActivity = new Date();
    await this.pool.query(
      'UPDATE bd_accounts SET last_activity = NOW() WHERE id = $1',
      [accountId]
    );
    const updates = result as any;
    const message = updates?.updates?.[0]?.message ?? updates?.updates?.find((u: any) => u.message)?.message;
    if (!message) throw new Error('Forward succeeded but no message in response');
    return message;
  }
}
