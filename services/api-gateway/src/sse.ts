import type { Request, Response } from 'express';
import Redis from 'ioredis';
import type { Logger } from '@getsale/logger';
import { REDIS_URL, SSE_HEARTBEAT_MS } from './config';

export const sseClients = new Map<string, Response>();

let redisSub: Redis | null = null;

export function setupRedisSubscriber(log: Logger): void {
  try {
    const url = new URL(REDIS_URL);
    redisSub = new Redis({
      host: url.hostname,
      port: parseInt(url.port || '6379'),
      password: url.password || undefined,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });
    redisSub.on('error', (err: Error) => log.error({ message: 'Redis subscriber error', error: String(err) }));
    redisSub.on('message', (channel: string, message: string) => {
      const res = sseClients.get(channel);
      if (!res || res.writableEnded) return;
      try {
        const parsed = JSON.parse(message) as { event?: string; data?: unknown };
        const event = parsed.event ?? 'message';
        const data = parsed.data !== undefined ? JSON.stringify(parsed.data) : message;
        res.write(`event: ${event}\ndata: ${data}\n\n`);
      } catch {
        res.write(`data: ${message}\n\n`);
      }
    });
  } catch (e) {
    log.warn({ message: 'Redis subscriber not started', error: (e as Error).message });
  }
}

export function getRedisSub(): Redis | null {
  return redisSub;
}

export function createSseRoute(log: Logger) {
  const sub = getRedisSub();
  return function sseRoute(req: Request, res: Response): void {
    const user = req.user;
    if (!user?.id || !sub) {
      res.status(503).json({ error: 'Events stream unavailable' });
      return;
    }
    const channel = `events:${user.id}`;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.set(channel, res);
    sub.subscribe(channel).catch((err: Error) => {
      log.error({ message: 'SSE subscribe error', error: String(err) });
    });

    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      try {
        res.write(': heartbeat\n\n');
      } catch {
        /* ignore */
      }
    }, SSE_HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(channel);
      sub.unsubscribe(channel).catch(() => {});
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* ignore */
      }
    });
  };
}
