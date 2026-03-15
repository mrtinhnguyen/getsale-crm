import type { Server } from 'socket.io';
import Redis from 'ioredis';
import type { Logger } from '@getsale/logger';

/**
 * Bridge between Redis Pub/Sub `events:{userId}` channels and Socket.IO `user:{userId}` rooms.
 * Backend services (crm-service, bd-accounts-service) publish user-targeted events
 * (parse_progress, sync_progress, notification) to Redis. This subscriber forwards
 * them into Socket.IO so clients receive everything over a single WebSocket connection.
 */
export function startRedisBridge(io: Server, redisConfig: Record<string, unknown>, log: Logger): Redis {
  const subscriber = new Redis({
    ...(redisConfig as any),
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  subscriber.on('error', (err: Error) => log.error({ message: 'Redis bridge subscriber error', error: String(err) }));
  subscriber.on('connect', () => log.info({ message: 'Redis bridge subscriber connected' }));

  subscriber.psubscribe('events:*').catch((err: Error) => {
    log.error({ message: 'Failed to psubscribe to events:*', error: String(err) });
  });

  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const userId = channel.replace(/^events:/, '');
    if (!userId) return;

    try {
      const parsed = JSON.parse(message) as { event?: string; data?: unknown };
      const eventName = parsed.event ?? 'message';
      const data = parsed.data ?? parsed;

      io.to(`user:${userId}`).emit('event', {
        type: eventName,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch {
      log.warn({ message: 'Redis bridge: failed to parse message', channel });
    }
  });

  return subscriber;
}
