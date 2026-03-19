import type { Request, Response, NextFunction } from 'express';
import { allowedOrigins, DEFAULT_ORIGIN, CORRELATION_HEADER } from './config';
import { randomUUID } from 'crypto';

function isValidOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  const o = origin.trim();
  if (!o) return false;
  try {
    const u = new URL(o);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolveOrigin(reqOrigin: string | undefined): string {
  const raw = typeof reqOrigin === 'string' ? reqOrigin.trim() : '';
  const fromRequest = raw && isValidOrigin(raw) ? raw : '';

  if (allowedOrigins.length > 0) {
    if (fromRequest && allowedOrigins.includes(fromRequest)) return fromRequest;
    if (process.env.NODE_ENV !== 'production' && fromRequest) {
      try {
        const u = new URL(fromRequest);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return fromRequest;
      } catch {
        /* fall through */
      }
    }
    return allowedOrigins[0];
  }
  if (fromRequest) return fromRequest;
  return DEFAULT_ORIGIN;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = resolveOrigin(req.headers.origin);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  const allowHeaders =
    typeof requestedHeaders === 'string' && requestedHeaders.trim()
      ? requestedHeaders
      : 'Content-Type, Authorization, Cache-Control, Pragma, x-correlation-id';
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

export function correlationIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const incoming = req.headers[CORRELATION_HEADER] as string | undefined;
  req.correlationId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  next();
}
