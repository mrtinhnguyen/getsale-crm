import type { Socket } from 'socket.io';
import type { Pool } from 'pg';
import type { Logger } from '@getsale/logger';
import type { SocketUser } from './socket-auth';
import type { ConnectionTracker } from './connection-tracker';

interface RoomDeps {
  pool: Pool | null;
  log: Logger;
  tracker: ConnectionTracker;
}

export function registerRoomHandlers(socket: Socket, user: SocketUser, deps: RoomDeps) {
  const { pool, log, tracker } = deps;

  socket.on('subscribe', async (room: string) => {
    if (!tracker.checkRateLimit(user.organizationId, socket.id)) {
      socket.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    if (typeof room !== 'string' || !room.trim()) {
      socket.emit('error', { message: 'Invalid room format' });
      return;
    }

    const trimmed = room.trim();

    if (trimmed.startsWith('org:')) {
      if (trimmed.slice(4) !== user.organizationId) {
        socket.emit('error', { message: 'Invalid room access' });
        return;
      }
      socket.join(trimmed);
      socket.emit('subscribed', { room: trimmed });
      return;
    }

    if (trimmed.startsWith('user:')) {
      if (trimmed.slice(5) !== user.id) {
        socket.emit('error', { message: 'Invalid room access' });
        return;
      }
      socket.join(trimmed);
      socket.emit('subscribed', { room: trimmed });
      return;
    }

    if (trimmed.startsWith('bd-account:')) {
      const accountId = trimmed.slice(11);
      if (!accountId) {
        socket.emit('error', { message: 'Invalid room format' });
        return;
      }
      if (!pool) {
        socket.emit('error', { message: 'Room verification unavailable' });
        return;
      }
      try {
        const row = await pool.query(
          'SELECT organization_id FROM bd_accounts WHERE id = $1',
          [accountId],
        );
        if (row.rows.length === 0 || row.rows[0].organization_id !== user.organizationId) {
          socket.emit('error', { message: 'Invalid room access' });
          return;
        }
      } catch (err) {
        log.error({ message: 'Room ownership check failed', entity_type: 'bd-account', entity_id: accountId, error: String(err) });
        socket.emit('error', { message: 'Room verification failed' });
        return;
      }
      socket.join(trimmed);
      socket.emit('subscribed', { room: trimmed });
      return;
    }

    if (trimmed.startsWith('chat:')) {
      const conversationId = trimmed.slice(5);
      if (!conversationId) {
        socket.emit('error', { message: 'Invalid room format' });
        return;
      }
      if (!pool) {
        socket.emit('error', { message: 'Room verification unavailable' });
        return;
      }
      try {
        const row = await pool.query(
          `SELECT ba.organization_id FROM conversations c
           JOIN bd_accounts ba ON ba.id = c.bd_account_id
           WHERE c.id = $1`,
          [conversationId],
        );
        if (row.rows.length === 0 || row.rows[0].organization_id !== user.organizationId) {
          socket.emit('error', { message: 'Invalid room access' });
          return;
        }
      } catch (err) {
        log.error({ message: 'Chat room ownership check failed', entity_type: 'conversation', entity_id: conversationId, error: String(err) });
        socket.emit('error', { message: 'Room verification failed' });
        return;
      }
      socket.join(trimmed);
      socket.emit('subscribed', { room: trimmed });
      return;
    }

    socket.emit('error', { message: 'Invalid room format' });
  });

  socket.on('unsubscribe', (room: string) => {
    if (typeof room !== 'string') return;
    socket.leave(room);
    socket.emit('unsubscribed', { room });
  });
}
