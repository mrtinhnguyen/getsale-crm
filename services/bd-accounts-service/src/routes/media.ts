import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';
import { TelegramManager } from '../telegram-manager';

interface Deps {
  pool: Pool;
  log: Logger;
  telegramManager: TelegramManager;
}

export function mediaRouter({ pool, log, telegramManager }: Deps): Router {
  const router = Router();

  // GET /:id/avatar — BD account profile photo
  router.get('/:id/avatar', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;

    const accountResult = await pool.query(
      'SELECT id FROM bd_accounts WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (accountResult.rows.length === 0) {
      throw new AppError(404, 'BD account not found', ErrorCodes.NOT_FOUND);
    }

    const result = await telegramManager.downloadAccountProfilePhoto(id);
    if (!result) {
      throw new AppError(404, 'Avatar not available (account offline or no photo)', ErrorCodes.NOT_FOUND);
    }
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.buffer);
  }));

  // GET /:id/chats/:chatId/avatar — chat/peer profile photo
  router.get('/:id/chats/:chatId/avatar', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id, chatId } = req.params;

    const accountResult = await pool.query(
      'SELECT id FROM bd_accounts WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (accountResult.rows.length === 0) {
      throw new AppError(404, 'BD account not found', ErrorCodes.NOT_FOUND);
    }

    const result = await telegramManager.downloadChatProfilePhoto(id, chatId);
    if (!result) {
      throw new AppError(404, 'Chat avatar not available', ErrorCodes.NOT_FOUND);
    }
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.buffer);
  }));

  // GET /:id/media — proxy media from Telegram (photo, video, voice, document)
  router.get('/:id/media', asyncHandler(async (req, res) => {
    const { organizationId } = req.user;
    const { id } = req.params;
    const { channelId, messageId } = req.query;

    if (!channelId || !messageId) {
      throw new AppError(400, 'channelId and messageId query params required', ErrorCodes.VALIDATION);
    }

    const accountResult = await pool.query(
      'SELECT id FROM bd_accounts WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    if (accountResult.rows.length === 0) {
      throw new AppError(404, 'BD account not found', ErrorCodes.NOT_FOUND);
    }

    try {
      const result = await telegramManager.downloadMessageMedia(id, String(channelId), String(messageId));
      if (!result) {
        throw new AppError(404, 'Message or media not found', ErrorCodes.NOT_FOUND);
      }

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(result.buffer);
    } catch (error: any) {
      if (error?.message?.includes('not connected')) {
        throw new AppError(400, 'Account is not connected', ErrorCodes.BAD_REQUEST);
      }
      throw error;
    }
  }));

  return router;
}
