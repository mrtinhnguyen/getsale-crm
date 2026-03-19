import { Router } from 'express';
import { z } from 'zod';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes, validate } from '@getsale/service-core';
import { AIRateLimiter } from '../rate-limiter';

const RephraseSchema = z.object({
  text: z.string().min(1).max(4000),
});

interface Deps {
  log: Logger;
  rateLimiter: AIRateLimiter;
}

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 15_000;

export function campaignRephraseRouter({ log, rateLimiter }: Deps): Router {
  const router = Router();

  router.post('/campaigns/rephrase', validate(RephraseSchema), asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { text } = req.body as { text: string };
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim() || 'openrouter/free';

    if (!apiKey) {
      log.warn({ message: 'Campaign rephrase: OPENROUTER_API_KEY not set in ai-service' });
      throw new AppError(
        503,
        'AI rephrase is not configured. Set OPENROUTER_API_KEY in ai-service.',
        ErrorCodes.SERVICE_UNAVAILABLE
      );
    }

    const rateCheck = await rateLimiter.check(organizationId);
    if (!rateCheck.allowed) {
      throw new AppError(429, `AI rate limit exceeded. Reset in ${rateCheck.resetInSeconds}s`, ErrorCodes.RATE_LIMITED);
    }

    const prompt =
      'Rephrase the following message for a personal Telegram DM. Use different wording and sentence structure so it feels unique. Keep the same meaning and a natural tone. Return only the rephrased text, no quotes or explanation.\n\n'
      + text;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
    try {
      const response = await fetch(OPENROUTER_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        log.warn({ message: 'AI campaign rephrase failed', httpStatus: response.status, body });
        throw new AppError(502, 'AI rephrase provider failed', ErrorCodes.SERVICE_UNAVAILABLE);
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) {
        log.warn({ message: 'Campaign rephrase: OpenRouter returned empty content', body: data });
        throw new AppError(502, 'AI rephrase returned empty response', ErrorCodes.SERVICE_UNAVAILABLE);
      }

      await rateLimiter.increment(organizationId);
      log.info({ message: 'Campaign rephrase success', organizationId, model });
      res.json({ content, model, provider: 'openrouter' });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof AppError) throw err;
      log.warn({ message: 'AI campaign rephrase error', error: err instanceof Error ? err.message : String(err) });
      throw new AppError(502, 'AI rephrase failed', ErrorCodes.SERVICE_UNAVAILABLE);
    }
  }));

  return router;
}

