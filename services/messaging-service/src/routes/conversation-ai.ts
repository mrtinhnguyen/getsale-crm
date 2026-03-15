import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import {
  asyncHandler,
  AppError,
  ErrorCodes,
  ServiceHttpClient,
  ServiceCallError,
} from '@getsale/service-core';
import { MESSAGES_FOR_AI_LIMIT, AI_INSIGHT_MODEL_VERSION } from '../helpers';

interface Deps {
  pool: Pool;
  log: Logger;
  aiClient: ServiceHttpClient;
}

export function conversationAiRouter({ pool, log, aiClient }: Deps): Router {
  const router = Router();

  router.post('/conversations/:id/ai/analysis', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id: conversationId } = req.params;

    const convRes = await pool.query(
      `SELECT id, organization_id, bd_account_id, channel_id FROM conversations WHERE id = $1 AND organization_id = $2`,
      [conversationId, organizationId]
    );
    if (convRes.rows.length === 0) {
      throw new AppError(404, 'Conversation not found', ErrorCodes.NOT_FOUND);
    }
    const conv = convRes.rows[0] as { id: string; bd_account_id: string | null; channel_id: string };
    if (!conv.bd_account_id || !conv.channel_id) {
      throw new AppError(400, 'Conversation has no bd_account or channel', ErrorCodes.BAD_REQUEST);
    }

    const msgRes = await pool.query(
      `SELECT id, content, direction, created_at FROM messages
       WHERE organization_id = $1 AND bd_account_id = $2 AND channel = 'telegram' AND channel_id = $3
       ORDER BY COALESCE(telegram_date, created_at) DESC LIMIT $4`,
      [organizationId, conv.bd_account_id, conv.channel_id, MESSAGES_FOR_AI_LIMIT]
    );
    const rows = (msgRes.rows as { id: string; content: string; direction: string; created_at: Date }[]).reverse();
    const messages = rows.map((m) => ({
      content: m.content,
      direction: m.direction,
      created_at: m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
    }));
    if (messages.length === 0) {
      throw new AppError(400, 'No messages in conversation', ErrorCodes.BAD_REQUEST);
    }

    try {
      const payload = await aiClient.post<Record<string, unknown>>(
        '/api/ai/conversations/analyze',
        { messages },
        { 'x-correlation-id': req.correlationId || '' }
      );

      await pool.query(
        `INSERT INTO conversation_ai_insights (conversation_id, account_id, type, payload_json, model_version, created_at)
         VALUES ($1, $2, 'analysis', $3, $4, NOW())`,
        [conversationId, conv.bd_account_id, JSON.stringify(payload), AI_INSIGHT_MODEL_VERSION]
      );
      res.json(payload);
    } catch (err: unknown) {
      if (err instanceof ServiceCallError) {
        const errBody = typeof err.body === 'object' && err.body !== null
          ? err.body as { error?: string; message?: string }
          : {};
        return res.status(err.statusCode).json({
          error: errBody.error || 'Service Unavailable',
          message: errBody.message || errBody.error || 'AI service error',
        });
      }
      throw err;
    }
  }));

  router.post('/conversations/:id/ai/summary', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id: conversationId } = req.params;
    const body = (req.body || {}) as { limit?: number };
    const MAX_SUMMARY_MESSAGES = 200;
    const msgLimit = Math.min(Math.max(Math.round(Number(body.limit) || 25), 1), MAX_SUMMARY_MESSAGES);

    const convRes = await pool.query(
      `SELECT id, organization_id, bd_account_id, channel_id FROM conversations WHERE id = $1 AND organization_id = $2`,
      [conversationId, organizationId]
    );
    if (convRes.rows.length === 0) {
      throw new AppError(404, 'Conversation not found', ErrorCodes.NOT_FOUND);
    }
    const conv = convRes.rows[0] as { id: string; bd_account_id: string | null; channel_id: string };
    if (!conv.bd_account_id || !conv.channel_id) {
      throw new AppError(400, 'Conversation has no bd_account or channel', ErrorCodes.BAD_REQUEST);
    }

    const msgRes = await pool.query(
      `SELECT id, content, direction, created_at, telegram_date FROM messages m
       WHERE m.organization_id = $1 AND m.bd_account_id = $2 AND m.channel = 'telegram' AND m.channel_id = $3
       ORDER BY COALESCE(m.telegram_date, m.created_at) DESC
       LIMIT $4`,
      [organizationId, conv.bd_account_id, conv.channel_id, msgLimit]
    );
    const rows = (msgRes.rows as { id: string; content: string; direction: string; created_at: Date; telegram_date: Date | null }[]).reverse();
    const messages = rows.map((m) => ({
      content: m.content,
      direction: m.direction,
      created_at: (m.telegram_date || m.created_at) instanceof Date ? (m.telegram_date || m.created_at)!.toISOString() : String(m.created_at),
    })).filter((m) => m.content && m.content.trim().length > 0);
    if (messages.length === 0) {
      throw new AppError(400, 'No messages to summarize', ErrorCodes.BAD_REQUEST);
    }

    try {
      const aiData = await aiClient.post<{ summary?: string }>(
        '/api/ai/chat/summarize',
        { messages },
        { 'x-correlation-id': req.correlationId || '' }
      );
      const summary = aiData.summary ?? '';

      await pool.query(
        `INSERT INTO conversation_ai_insights (conversation_id, account_id, type, payload_json, model_version, created_at)
         VALUES ($1, $2, 'summary', $3, $4, NOW())`,
        [conversationId, conv.bd_account_id, JSON.stringify({ summary }), AI_INSIGHT_MODEL_VERSION]
      );
      res.json({ summary });
    } catch (err: unknown) {
      if (err instanceof ServiceCallError) {
        const errBody = typeof err.body === 'object' && err.body !== null
          ? err.body as { error?: string; message?: string }
          : {};
        return res.status(err.statusCode).json({
          error: errBody.error || 'Service Unavailable',
          message: errBody.message || errBody.error || 'AI service error',
        });
      }
      throw err;
    }
  }));

  return router;
}
