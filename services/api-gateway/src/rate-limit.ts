import type { Request, Response, NextFunction } from 'express';
import type { RedisClient } from '@getsale/utils';
import { RATE_LIMIT_AUTH, RATE_LIMIT_ANON } from './config';

const RATE_LIMIT_WINDOW_SEC = 60;

/** Generous limit for webhook endpoints (e.g. Stripe) to allow retries without blocking. */
const WEBHOOK_RATE_LIMIT = 60; // requests per minute per IP
const WEBHOOK_KEY_PREFIX = 'rate_limit:webhook:';

/** Limit for public invite endpoints to reduce token enumeration and DoS. */
const INVITE_RATE_LIMIT = 30; // requests per minute per IP
const INVITE_KEY_PREFIX = 'rate_limit:invite:';

export function createRateLimit(redis: RedisClient) {
  return async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = req.user;
    const limit = user?.id ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON;
    const key = `rate_limit:${user?.id ?? req.ip}:${(Date.now() / 60000) | 0}`;

    const count = await redis.incr(key, RATE_LIMIT_WINDOW_SEC);
    if (count > limit) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };
}

export function createWebhookRateLimit(redis: RedisClient) {
  return async function webhookRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${WEBHOOK_KEY_PREFIX}${ip}:${(Date.now() / 60000) | 0}`;
    const count = await redis.incr(key, RATE_LIMIT_WINDOW_SEC);
    if (count > WEBHOOK_RATE_LIMIT) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };
}

export function createInviteRateLimit(redis: RedisClient) {
  return async function inviteRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${INVITE_KEY_PREFIX}${ip}:${(Date.now() / 60000) | 0}`;
    const count = await redis.incr(key, RATE_LIMIT_WINDOW_SEC);
    if (count > INVITE_RATE_LIMIT) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }
    next();
  };
}
