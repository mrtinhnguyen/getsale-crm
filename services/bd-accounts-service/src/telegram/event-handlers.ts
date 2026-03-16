// @ts-nocheck — GramJS types are incomplete
import { TelegramClient, Api } from 'telegram';
import { NewMessage, Raw } from 'telegram/events';
import { randomUUID } from 'crypto';
import {
  EventType,
  type MessageDeletedEvent,
  type MessageEditedEvent,
  type BDAccountTelegramUpdateEvent,
} from '@getsale/events';
import { getMessageText } from '../telegram-serialize';
import { getErrorMessage } from '../helpers';
import type { TelegramManagerDeps, TelegramClientInfo, StructuredLog } from './types';
import type { MessageHandler } from './message-handler';
import type { MessageDb } from './message-db';
import type { ConnectionManager } from './connection-manager';
import type { Pool } from 'pg';
import type { RabbitMQClient } from '@getsale/utils';

/**
 * Sets up all Telegram event handlers on a connected TelegramClient.
 */
export class EventHandlerSetup {
  private readonly pool: Pool;
  private readonly rabbitmq: RabbitMQClient;
  private readonly log: StructuredLog;
  private readonly clients: Map<string, TelegramClientInfo>;
  private messageHandler!: MessageHandler;
  private messageDb!: MessageDb;
  private connectionManager!: ConnectionManager;

  constructor(private readonly deps: TelegramManagerDeps) {
    this.pool = deps.pool;
    this.rabbitmq = deps.rabbitmq;
    this.log = deps.log;
    this.clients = deps.clients;
  }

  setMessageHandler(mh: MessageHandler): void { this.messageHandler = mh; }
  setMessageDb(mdb: MessageDb): void { this.messageDb = mdb; }
  setConnectionManager(cm: ConnectionManager): void { this.connectionManager = cm; }

  setupEventHandlers(
    client: TelegramClient,
    accountId: string,
    organizationId: string
  ): void {
    try {
      if (!client.connected) {
        this.log.warn({ message: `Client not connected for account ${accountId}, skipping event handlers` });
        return;
      }

      // Raw update logging (message only)
      try {
        client.addEventHandler(
          (update: any) => {
            const hasMessage = update?.message != null;
            if (!hasMessage) return;
            const name = update?.className ?? update?.constructor?.name ?? (update && typeof update === 'object' ? 'Object' : String(update));
            this.log.info({ message: `Raw update: ${name}, accountId=${accountId}` });
          },
          new Raw({ func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }

      // UpdateShortMessage / UpdateShortChatMessage
      try {
        client.addEventHandler(
          async (update: any) => {
            try {
              if (!client.connected) return;
              await this.messageHandler.handleShortMessageUpdate(update, accountId, organizationId);
            } catch (err: unknown) {
              const msg = getErrorMessage(err);
              if (msg === 'TIMEOUT' || msg.includes('TIMEOUT')) return;
              if (msg.includes('builder.resolve')) return;
              this.log.error({ message: `Short message handler error for ${accountId}`, error: msg });
            }
          },
          new Raw({
            func: (update: any) => {
              try {
                if (!update) return false;
                const name = update.className ?? update.constructor?.name ?? '';
                if (name === 'UpdateShortMessage' || name === 'UpdateShortChatMessage') {
                  const text = (update as any).message;
                  return typeof text === 'string' && text.length > 0;
                }
                return false;
              } catch (err) {
                this.log.debug({ message: 'UpdateShort filter check failed', accountId, error: getErrorMessage(err) });
                return false;
              }
            },
          })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }

      // UpdateNewMessage / UpdateNewChannelMessage
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              this.log.info({ message: `Raw UpdateNewMessage/UpdateNewChannelMessage, accountId=${accountId}, hasMessage=${!!event?.message}` });
              if (!client.connected) return;

              const accountCheck = await this.pool.query(
                'SELECT id, is_active FROM bd_accounts WHERE id = $1',
                [accountId]
              );
              if (accountCheck.rows.length === 0 || !accountCheck.rows[0].is_active) {
                this.log.info({ message: `Account ${accountId} no longer exists or is inactive, disconnecting...` });
                await this.connectionManager.disconnectAccount(accountId);
                return;
              }

              const message = event?.message;
              const isMessage = message && (message instanceof Api.Message || message.className === 'Message');
              if (isMessage) {
                await this.messageHandler.handleNewMessage(message, accountId, organizationId);
              }
            } catch (error: any) {
              if (error.message === 'TIMEOUT' || error.message?.includes('TIMEOUT')) {
                this.log.warn({ message: `Timeout error for account ${accountId}, will retry`, error: error.message });
                return;
              }
              if (error.message?.includes('builder.resolve') || error.stack?.includes('builder.resolve')) return;
              this.log.error({ message: `Error handling new message for account ${accountId}`, error: error?.message || String(error) });
            }
          },
          new Raw({
            types: [Api.UpdateNewMessage, Api.UpdateNewChannelMessage],
            func: (update: any) => update != null && update.message != null,
          })
        );
      } catch (error: any) {
        if (error.message?.includes('builder.resolve') || error.stack?.includes('builder.resolve')) {
          this.log.warn({ message: `Could not set up UpdateNewMessage handler for ${accountId}, will rely on Short/NewMessage` });
        } else {
          throw error;
        }
      }

      // NewMessage (incoming)
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const accountCheck = await this.pool.query(
                'SELECT id, is_active FROM bd_accounts WHERE id = $1',
                [accountId]
              );
              if (accountCheck.rows.length === 0 || !accountCheck.rows[0].is_active) return;
              const message = event?.message;
              if (message && (message.className === 'Message' || message instanceof Api.Message)) {
                await this.messageHandler.handleNewMessage(message, accountId, organizationId);
              }
            } catch (err: unknown) {
              const msg = getErrorMessage(err);
              if (msg === 'TIMEOUT' || msg.includes('TIMEOUT')) return;
              if (msg.includes('builder.resolve')) return;
              this.log.error({ message: `NewMessage(incoming) handler error for ${accountId}`, error: msg });
            }
          },
          new NewMessage({ incoming: true })
        );
        this.log.info({ message: `NewMessage(incoming) handler registered for account ${accountId}` });
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        const stack = err instanceof Error ? err.stack : undefined;
        if (msg.includes('builder.resolve') || (stack && stack.includes('builder.resolve'))) {
          this.log.warn({ message: `Could not set up NewMessage(incoming) handler for ${accountId}` });
        }
      }

      // NewMessage (outgoing)
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const accountCheck = await this.pool.query(
                'SELECT id, is_active FROM bd_accounts WHERE id = $1',
                [accountId]
              );
              if (accountCheck.rows.length === 0 || !accountCheck.rows[0].is_active) return;
              const message = event?.message;
              if (message && (message.className === 'Message' || message instanceof Api.Message)) {
                await this.messageHandler.handleNewMessage(message, accountId, organizationId);
              }
            } catch (err: unknown) {
              const msg = getErrorMessage(err);
              if (msg === 'TIMEOUT' || msg.includes('TIMEOUT')) return;
              if (msg.includes('builder.resolve')) return;
              this.log.error({ message: `NewMessage(outgoing) handler error for ${accountId}`, error: msg });
            }
          },
          new NewMessage({ incoming: false })
        );
        this.log.info({ message: `NewMessage(outgoing) handler registered for account ${accountId}` });
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        const stack = err instanceof Error ? err.stack : undefined;
        if (msg.includes('builder.resolve') || (stack && stack.includes('builder.resolve'))) {
          this.log.warn({ message: `Could not set up NewMessage(outgoing) handler for ${accountId}` });
        }
      }

      // UpdateDeleteMessages — A1 Stage 2: delete via MessageDb (messaging internal API or direct DB)
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const ids = event?.messages ?? [];
              if (!Array.isArray(ids) || ids.length === 0) return;
              const deleted = await this.messageDb.deleteByTelegram({ bdAccountId: accountId, organizationId, telegramMessageIds: ids });
              for (const row of deleted) {
                const ev: MessageDeletedEvent = {
                  id: randomUUID(),
                  type: EventType.MESSAGE_DELETED,
                  timestamp: new Date(),
                  organizationId: row.organization_id,
                  data: { messageId: row.id, bdAccountId: accountId, channelId: row.channel_id, telegramMessageId: row.telegram_message_id },
                };
                await this.rabbitmq.publishEvent(ev);
              }
            } catch (err: unknown) {
              const msg = getErrorMessage(err);
              if (msg?.includes('builder.resolve')) return;
              this.log.error({ message: `UpdateDeleteMessages handler error for ${accountId}`, error: msg });
            }
          },
          new Raw({
            types: [Api.UpdateDeleteMessages],
            func: () => true,
          })
        );
      } catch (err: unknown) {
        if (getErrorMessage(err)?.includes('builder.resolve')) {
          this.log.warn({ message: `Could not set up UpdateDeleteMessages for ${accountId}` });
        }
      }

      // UpdateDeleteChannelMessages — A1 Stage 2: delete via MessageDb
      try {
        const UpdateDeleteChannelMessages = (Api as any).UpdateDeleteChannelMessages;
        if (UpdateDeleteChannelMessages) {
          client.addEventHandler(
            async (event: any) => {
              try {
                if (!client.connected) return;
                const channelIdRaw = event?.channelId;
                const ids = event?.messages ?? [];
                if (channelIdRaw == null || !Array.isArray(ids) || ids.length === 0) return;
                const channelIdStr = String(channelIdRaw);
                const deleted = await this.messageDb.deleteByTelegram({
                  bdAccountId: accountId,
                  organizationId,
                  channelId: channelIdStr,
                  telegramMessageIds: ids,
                });
                for (const row of deleted) {
                  const ev: MessageDeletedEvent = {
                    id: randomUUID(),
                    type: EventType.MESSAGE_DELETED,
                    timestamp: new Date(),
                    organizationId: row.organization_id,
                    data: { messageId: row.id, bdAccountId: accountId, channelId: row.channel_id, telegramMessageId: row.telegram_message_id },
                  };
                  await this.rabbitmq.publishEvent(ev);
                }
              } catch (err: unknown) {
                const msg = getErrorMessage(err);
                if (msg?.includes('builder.resolve')) return;
                this.log.error({ message: `UpdateDeleteChannelMessages handler error for ${accountId}`, error: msg });
              }
            },
            new Raw({
              types: [UpdateDeleteChannelMessages],
              func: () => true,
            })
          );
        }
      } catch {
        // UpdateDeleteChannelMessages may not exist in some GramJS versions
      }

      // Edited message — A1 Stage 2: edit via MessageDb
      try {
        const EditTypes = [Api.UpdateEditMessage, Api.UpdateEditChannelMessage].filter(Boolean);
        if (EditTypes.length > 0) {
          client.addEventHandler(
            async (update: any) => {
              try {
                if (!client.connected) return;
                const message = update?.message;
                if (!message?.id) return;
                let channelId = '';
                if (message.peerId) {
                  if (message.peerId instanceof Api.PeerUser) channelId = String(message.peerId.userId);
                  else if (message.peerId instanceof Api.PeerChat) channelId = String(message.peerId.chatId);
                  else if (message.peerId instanceof Api.PeerChannel) channelId = String(message.peerId.channelId);
                }
                const content = getMessageText(message) || '';
                const telegram_entities = message.entities ? JSON.stringify(message.entities) : null;
                const telegram_media = message.media ? JSON.stringify((message.media as any).toJSON?.() ?? message.media) : null;
                const row = await this.messageDb.editByTelegram({
                  bdAccountId: accountId,
                  organizationId,
                  channelId,
                  telegramMessageId: message.id,
                  content,
                  telegram_entities,
                  telegram_media,
                });
                if (row) {
                  const ev: MessageEditedEvent = {
                    id: randomUUID(),
                    type: EventType.MESSAGE_EDITED,
                    timestamp: new Date(),
                    organizationId: row.organization_id,
                    data: { messageId: row.id, bdAccountId: accountId, channelId, content, telegramMessageId: message.id },
                  };
                  await this.rabbitmq.publishEvent(ev);
                }
              } catch (err: unknown) {
                const msg = getErrorMessage(err);
                if (msg?.includes('builder.resolve')) return;
                this.log.error({ message: `EditedMessage handler error for ${accountId}`, error: msg });
              }
            },
            new Raw({ types: EditTypes, func: () => true })
          );
        }
      } catch (err: unknown) {
        this.log.warn({ message: `Could not set up edited-message handler for ${accountId}`, error: getErrorMessage(err) });
      }

      // Presence and other handlers
      this.setupTelegramPresenceHandlers(client, accountId, organizationId).catch((err) =>
        this.log.warn({ message: "setupTelegramPresenceHandlers failed", error: err?.message })
      );
      this.setupTelegramOtherHandlers(client, accountId, organizationId).catch((err) =>
        this.log.warn({ message: "setupTelegramOtherHandlers failed", error: err?.message })
      );

    } catch (error: any) {
      this.log.error({ message: `Error setting up event handlers`, error: error.message });
    }
  }

  private async setupTelegramPresenceHandlers(
    client: TelegramClient,
    accountId: string,
    organizationId: string
  ): Promise<void> {
    const publish = async (data: BDAccountTelegramUpdateEvent['data']) => {
      const ev: BDAccountTelegramUpdateEvent = {
        id: randomUUID(),
        type: EventType.BD_ACCOUNT_TELEGRAM_UPDATE,
        timestamp: new Date(),
        organizationId,
        data: { ...data, bdAccountId: accountId, organizationId },
      };
      await this.rabbitmq.publishEvent(ev);
    };

    const ApiAny = Api as any;

    if (ApiAny.UpdateUserTyping) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const userId = event?.userId ?? event?.user_id;
              const channelId = userId != null ? String(userId) : '';
              if (!channelId) return;
              const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
              if (!allowed) return;
              const action = event?.action?.className ?? event?.action?.constructor?.name ?? '';
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'typing', channelId, userId: String(userId), action: action || undefined });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateUserTyping], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }

    if (ApiAny.UpdateChatUserTyping) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const chatIdRaw = event?.chatId ?? event?.chat_id;
              const channelId = chatIdRaw != null ? String(chatIdRaw) : '';
              if (!channelId) return;
              const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
              if (!allowed) return;
              const fromId = event?.fromId ?? event?.from_id;
              let userId: string | undefined;
              if (fromId) {
                if (fromId.userId != null) userId = String(fromId.userId);
                else if (fromId.channelId != null) userId = String(fromId.channelId);
                else userId = String(fromId);
              }
              const action = event?.action?.className ?? event?.action?.constructor?.name ?? '';
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'typing', channelId, userId, action: action || undefined });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateChatUserTyping], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }

    if (ApiAny.UpdateUserStatus) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const userId = event?.userId ?? event?.user_id;
              if (userId == null) return;
              const status = event?.status?.className ?? event?.status?.constructor?.name ?? '';
              const expires = (event?.status?.expires ?? event?.status?.until) ?? undefined;
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'user_status', userId: String(userId), status: status || undefined, expires: typeof expires === 'number' ? expires : undefined });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateUserStatus], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }

    if (ApiAny.UpdateReadHistoryInbox) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const peer = event?.peer;
              let channelId = '';
              if (peer) {
                if (peer.userId != null) channelId = String(peer.userId);
                else if (peer.chatId != null) channelId = String(peer.chatId);
                else if (peer.channelId != null) channelId = String(peer.channelId);
              }
              if (!channelId) return;
              const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
              if (!allowed) return;
              const maxId = event?.maxId ?? event?.max_id ?? 0;
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'read_inbox', channelId, maxId });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateReadHistoryInbox], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }

    if (ApiAny.UpdateReadChannelInbox) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const channelIdRaw = event?.channelId ?? event?.channel_id;
              const channelId = channelIdRaw != null ? String(channelIdRaw) : '';
              if (!channelId) return;
              const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
              if (!allowed) return;
              const maxId = event?.maxId ?? event?.max_id ?? 0;
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'read_channel_inbox', channelId, maxId });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateReadChannelInbox], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }

    if (ApiAny.UpdateDraftMessage) {
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              const peer = event?.peer;
              let channelId = '';
              if (peer) {
                if (peer.userId != null) channelId = String(peer.userId);
                else if (peer.chatId != null) channelId = String(peer.chatId);
                else if (peer.channelId != null) channelId = String(peer.channelId);
              }
              if (!channelId) return;
              const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
              if (!allowed) return;
              const draft = event?.draft;
              let draftText = '';
              let replyToMsgId: number | undefined;
              if (draft) {
                draftText = (draft.message ?? (draft as any).message ?? '') || '';
                replyToMsgId = (draft.replyTo as any)?.replyToMsgId ?? (draft as any).replyToMsgId ?? (draft as any).reply_to_msg_id;
              }
              await publish({ bdAccountId: accountId, organizationId, updateKind: 'draft', channelId, draftText: draftText || undefined, replyToMsgId });
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types: [ApiAny.UpdateDraftMessage], func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    }
  }

  private async setupTelegramOtherHandlers(
    client: TelegramClient,
    accountId: string,
    organizationId: string
  ): Promise<void> {
    const publish = async (data: BDAccountTelegramUpdateEvent['data']) => {
      const ev: BDAccountTelegramUpdateEvent = {
        id: randomUUID(),
        type: EventType.BD_ACCOUNT_TELEGRAM_UPDATE,
        timestamp: new Date(),
        organizationId,
        data: { ...data, bdAccountId: accountId, organizationId },
      };
      await this.rabbitmq.publishEvent(ev);
    };

    const ApiAny = Api as any;

    const wrap = (types: any[], handler: (event: any) => Promise<void>) => {
      if (!types.length) return;
      try {
        client.addEventHandler(
          async (event: any) => {
            try {
              if (!client.connected) return;
              await handler(event);
            } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
          },
          new Raw({ types, func: () => true })
        );
      } catch (err) { this.log.debug({ message: 'Raw update handler registration or run failed', accountId, error: getErrorMessage(err) }); }
    };

    wrap([ApiAny.UpdateMessageID], async (event) => {
      const telegramMessageId = event?.id;
      const randomId = event?.randomId ?? event?.random_id;
      if (telegramMessageId == null || randomId == null) return;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'message_id_confirmed', telegramMessageId: typeof telegramMessageId === 'number' ? telegramMessageId : undefined, randomId: String(randomId) });
    });

    wrap([ApiAny.UpdateReadHistoryOutbox], async (event) => {
      const peer = event?.peer;
      let channelId = '';
      if (peer) { if (peer.userId != null) channelId = String(peer.userId); else if (peer.chatId != null) channelId = String(peer.chatId); else if (peer.channelId != null) channelId = String(peer.channelId); }
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      const maxId = event?.maxId ?? event?.max_id ?? 0;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'read_outbox', channelId, maxId });
    });

    wrap([ApiAny.UpdateReadChannelOutbox], async (event) => {
      const channelIdRaw = event?.channelId ?? event?.channel_id;
      const channelId = channelIdRaw != null ? String(channelIdRaw) : '';
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      const maxId = event?.maxId ?? event?.max_id ?? 0;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'read_channel_outbox', channelId, maxId });
    });

    wrap([ApiAny.UpdateDialogPinned], async (event) => {
      const peer = event?.peer;
      let channelId = '';
      if (peer) { if (peer.userId != null) channelId = String(peer.userId); else if (peer.chatId != null) channelId = String(peer.chatId); else if (peer.channelId != null) channelId = String(peer.channelId); }
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      const pinned = Boolean(event?.pinned);
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'dialog_pinned', channelId, pinned });
    });

    wrap([ApiAny.UpdatePinnedDialogs], async (event) => {
      const folderId = event?.folderId ?? event?.folder_id ?? 0;
      const order = event?.order;
      const orderIds = Array.isArray(order) ? order.map((p: any) => { if (p?.userId != null) return String(p.userId); if (p?.chatId != null) return String(p.chatId); if (p?.channelId != null) return String(p.channelId); return String(p); }).filter(Boolean) : undefined;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'pinned_dialogs', folderId, order: orderIds });
    });

    wrap([ApiAny.UpdateNotifySettings], async (event) => {
      const peer = event?.peer;
      let channelId = '';
      if (peer) { if (peer.userId != null) channelId = String(peer.userId); else if (peer.chatId != null) channelId = String(peer.chatId); else if (peer.channelId != null) channelId = String(peer.channelId); }
      const settings = event?.notifySettings ?? event?.notify_settings;
      const notifySettings = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : undefined;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'notify_settings', channelId: channelId || undefined, notifySettings });
    });

    wrap([ApiAny.UpdateUserName], async (event) => {
      const userId = event?.userId ?? event?.user_id;
      if (userId == null) return;
      const firstName = event?.firstName ?? event?.first_name ?? '';
      const lastName = event?.lastName ?? event?.last_name ?? '';
      const usernames = event?.usernames ?? event?.username;
      const list = Array.isArray(usernames) ? usernames : (typeof usernames === 'string' && usernames ? [usernames] : undefined);
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'user_name', userId: String(userId), firstName: firstName || undefined, lastName: lastName || undefined, usernames: list });
    });

    wrap([ApiAny.UpdateUserPhone], async (event) => {
      const userId = event?.userId ?? event?.user_id;
      const phone = event?.phone ?? '';
      if (userId == null) return;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'user_phone', userId: String(userId), phone: phone || undefined });
    });

    wrap([ApiAny.UpdateChatParticipantAdd], async (event) => {
      const chatIdRaw = event?.chatId ?? event?.chat_id;
      const channelId = chatIdRaw != null ? String(chatIdRaw) : '';
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      const userId = event?.userId ?? event?.user_id;
      const inviterIdRaw = event?.inviterId ?? event?.inviter_id;
      let inviterId: string | undefined;
      if (inviterIdRaw != null) { if (typeof inviterIdRaw === 'object' && inviterIdRaw.userId != null) inviterId = String(inviterIdRaw.userId); else inviterId = String(inviterIdRaw); }
      const version = event?.version;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'chat_participant_add', channelId, userId: userId != null ? String(userId) : undefined, inviterId, version: typeof version === 'number' ? version : undefined });
    });

    wrap([ApiAny.UpdateChatParticipantDelete], async (event) => {
      const chatIdRaw = event?.chatId ?? event?.chat_id;
      const channelId = chatIdRaw != null ? String(chatIdRaw) : '';
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      const userId = event?.userId ?? event?.user_id;
      const version = event?.version;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'chat_participant_delete', channelId, userId: userId != null ? String(userId) : undefined, version: typeof version === 'number' ? version : undefined });
    });

    wrap([ApiAny.UpdateNewScheduledMessage], async (event) => {
      const message = event?.message;
      let channelId: string | undefined;
      if (message?.peerId) { const p = message.peerId; if (p?.userId != null) channelId = String(p.userId); else if (p?.chatId != null) channelId = String(p.chatId); else if (p?.channelId != null) channelId = String(p.channelId); }
      if (channelId) { const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId); if (!allowed) return; }
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'scheduled_message', channelId, poll: message ? (message as any) : undefined });
    });

    wrap([ApiAny.UpdateDeleteScheduledMessages], async (event) => {
      const peer = event?.peer;
      let channelId = '';
      if (peer) { if (peer.userId != null) channelId = String(peer.userId); else if (peer.chatId != null) channelId = String(peer.chatId); else if (peer.channelId != null) channelId = String(peer.channelId); }
      const ids = event?.messages ?? event?.messageIds ?? [];
      const messageIds = Array.isArray(ids) ? ids.filter((n: any) => typeof n === 'number') : [];
      if (channelId) { const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId); if (!allowed) return; }
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'delete_scheduled_messages', channelId: channelId || undefined, messageIds: messageIds.length ? messageIds : undefined });
    });

    wrap([ApiAny.UpdateMessagePoll], async (event) => {
      const pollId = event?.pollId ?? event?.poll_id;
      const poll = event?.poll;
      const results = event?.results;
      if (pollId == null) return;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'message_poll', pollId: String(pollId), poll: poll && typeof poll === 'object' ? (poll as Record<string, unknown>) : undefined, results: results && typeof results === 'object' ? (results as Record<string, unknown>) : undefined });
    });

    wrap([ApiAny.UpdateMessagePollVote], async (event) => {
      const pollId = event?.pollId ?? event?.poll_id;
      const options = event?.options;
      const opts = Array.isArray(options) ? options.map(String) : undefined;
      const qts = event?.qts;
      if (pollId == null) return;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'message_poll_vote', pollId: String(pollId), options: opts, qts: typeof qts === 'number' ? qts : undefined });
    });

    wrap([ApiAny.UpdateConfig], async () => { await publish({ bdAccountId: accountId, organizationId, updateKind: 'config' }); });
    wrap([ApiAny.UpdateDcOptions], async () => { await publish({ bdAccountId: accountId, organizationId, updateKind: 'dc_options' }); });
    wrap([ApiAny.UpdateLangPack], async () => { await publish({ bdAccountId: accountId, organizationId, updateKind: 'lang_pack' }); });
    wrap([ApiAny.UpdateTheme], async () => { await publish({ bdAccountId: accountId, organizationId, updateKind: 'theme' }); });

    wrap([ApiAny.UpdatePhoneCall], async (event) => {
      const phoneCall = event?.phoneCall;
      const phoneCallId = phoneCall?.id ?? (phoneCall as any)?.id;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'phone_call', phoneCallId: phoneCallId != null ? String(phoneCallId) : undefined });
    });

    wrap([ApiAny.UpdateBotCallbackQuery], async (event) => {
      const queryId = event?.queryId ?? event?.query_id;
      const userId = event?.userId ?? event?.user_id;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'callback_query', queryId: queryId != null ? String(queryId) : undefined, userId: userId != null ? String(userId) : undefined });
    });

    wrap([ApiAny.UpdateChannelTooLong], async (event) => {
      const channelIdRaw = event?.channelId ?? event?.channel_id;
      const channelId = channelIdRaw != null ? String(channelIdRaw) : '';
      const pts = event?.pts;
      if (!channelId) return;
      const allowed = await this.messageDb.isChatAllowedForAccount(accountId, channelId);
      if (!allowed) return;
      await publish({ bdAccountId: accountId, organizationId, updateKind: 'channel_too_long', channelId, pts: typeof pts === 'number' ? pts : undefined });
    });
  }
}
