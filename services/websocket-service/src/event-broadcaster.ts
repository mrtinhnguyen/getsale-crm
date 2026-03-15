import type { Server } from 'socket.io';
import type { RabbitMQClient } from '@getsale/utils';
import type { Logger } from '@getsale/logger';
import { EventType } from '@getsale/events';

export async function subscribeToEvents(io: Server, rabbitmq: RabbitMQClient, log: Logger) {
  await rabbitmq.subscribeToEvents(
    [
      EventType.MESSAGE_RECEIVED,
      EventType.MESSAGE_SENT,
      EventType.MESSAGE_DELETED,
      EventType.MESSAGE_EDITED,
      EventType.DEAL_STAGE_CHANGED,
      EventType.AI_DRAFT_GENERATED,
      EventType.AI_DRAFT_APPROVED,
      EventType.BD_ACCOUNT_CONNECTED,
      EventType.BD_ACCOUNT_DISCONNECTED,
      EventType.BD_ACCOUNT_SYNC_STARTED,
      EventType.BD_ACCOUNT_SYNC_PROGRESS,
      EventType.BD_ACCOUNT_SYNC_COMPLETED,
      EventType.BD_ACCOUNT_SYNC_FAILED,
      EventType.BD_ACCOUNT_TELEGRAM_UPDATE,
      EventType.CONTACT_CREATED,
    ],
    async (event) => {
      try {
        broadcastOrgEvent(io, event);
        broadcastTelegramUpdate(io, event);
        broadcastMessageEvent(io, event, log);
        broadcastMessageEditDelete(io, event);
        broadcastSyncProgress(io, event);
        broadcastUserEvent(io, event);
      } catch (error) {
        log.error({ message: 'Error broadcasting event', error: String(error) });
      }
    },
    'events',
    'websocket-service',
  );
}

function emitEvent(io: Server, room: string, eventName: string, payload: object) {
  io.to(room).emit(eventName, payload);
}

function broadcastOrgEvent(io: Server, event: any) {
  if (
    event.type === EventType.MESSAGE_RECEIVED ||
    event.type === EventType.MESSAGE_SENT ||
    event.type === EventType.BD_ACCOUNT_TELEGRAM_UPDATE
  ) {
    return;
  }
  emitEvent(io, `org:${event.organizationId}`, 'event', {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });
}

function broadcastTelegramUpdate(io: Server, event: any) {
  if (event.type !== EventType.BD_ACCOUNT_TELEGRAM_UPDATE) return;
  const data = event.data as any;
  if (!data?.bdAccountId) return;
  emitEvent(io, `bd-account:${data.bdAccountId}`, 'event', {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });
}

function broadcastMessageEvent(io: Server, event: any, log: Logger) {
  if (event.type !== EventType.MESSAGE_RECEIVED && event.type !== EventType.MESSAGE_SENT) return;
  const data = event.data as any;
  log.info({
    message: `${event.type} received`,
    entity_type: 'message',
    bd_account_id: data?.bdAccountId,
    channel_id: data?.channelId,
  });

  if (data.contactId) {
    emitEvent(io, `chat:${data.contactId}`, 'event', {
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
    });
  }

  if (data.bdAccountId) {
    emitEvent(io, `bd-account:${data.bdAccountId}`, 'event', {
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
    });

    if (data.channelId) {
      const chatRoom = `bd-account:${data.bdAccountId}:chat:${data.channelId}`;
      emitEvent(io, chatRoom, 'new-message', {
        message: data,
        timestamp: event.timestamp,
      });
      emitEvent(io, `bd-account:${data.bdAccountId}`, 'new-message', {
        message: data,
        timestamp: event.timestamp,
      });
    }
  }
}

function broadcastMessageEditDelete(io: Server, event: any) {
  if (event.type !== EventType.MESSAGE_DELETED && event.type !== EventType.MESSAGE_EDITED) return;
  const data = event.data as any;
  if (!data?.bdAccountId) return;
  emitEvent(io, `bd-account:${data.bdAccountId}`, 'event', {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });
}

function broadcastSyncProgress(io: Server, event: any) {
  if (
    event.type !== EventType.BD_ACCOUNT_SYNC_STARTED &&
    event.type !== EventType.BD_ACCOUNT_SYNC_PROGRESS &&
    event.type !== EventType.BD_ACCOUNT_SYNC_COMPLETED &&
    event.type !== EventType.BD_ACCOUNT_SYNC_FAILED
  ) {
    return;
  }
  const data = event.data as any;
  if (!data?.bdAccountId) return;
  emitEvent(io, `bd-account:${data.bdAccountId}`, 'event', {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });
}

function broadcastUserEvent(io: Server, event: any) {
  if (!event.userId) return;
  emitEvent(io, `user:${event.userId}`, 'event', {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp,
  });
}
