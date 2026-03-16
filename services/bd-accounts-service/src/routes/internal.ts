import { Router } from 'express';
import { Pool } from 'pg';
import { Logger } from '@getsale/logger';
import { asyncHandler, AppError, ErrorCodes } from '@getsale/service-core';

/** Internal API for other services (e.g. messaging). Requires X-Organization-Id and internal auth. */

export interface InternalSyncChatRow {
  telegram_chat_id: string;
  title: string | null;
  peer_type: string;
  history_exhausted: boolean;
  folder_id: number | null;
  folder_ids: number[];
}

export function internalBdAccountsRouter({ pool, log }: { pool: Pool; log: Logger }): Router {
  const router = Router();

  // GET /sync-chats?bdAccountId= — list sync chats for an account (tenant check via X-Organization-Id)
  router.get('/sync-chats', asyncHandler(async (req, res) => {
    const organizationId = req.headers['x-organization-id'] as string | undefined;
    if (!organizationId?.trim()) {
      throw new AppError(400, 'X-Organization-Id required', ErrorCodes.VALIDATION);
    }
    const bdAccountId = req.query.bdAccountId as string | undefined;
    if (!bdAccountId?.trim()) {
      throw new AppError(400, 'bdAccountId query required', ErrorCodes.VALIDATION);
    }

    const accountCheck = await pool.query(
      'SELECT id FROM bd_accounts WHERE id = $1 AND organization_id = $2',
      [bdAccountId.trim(), organizationId.trim()]
    );
    if (accountCheck.rows.length === 0) {
      throw new AppError(404, 'Account not found', ErrorCodes.NOT_FOUND);
    }

    const chatsRows = await pool.query(
      `SELECT s.telegram_chat_id::text AS telegram_chat_id, s.title, s.peer_type,
              COALESCE(s.history_exhausted, false) AS history_exhausted, s.folder_id
       FROM bd_account_sync_chats s
       WHERE s.bd_account_id = $1 AND s.peer_type IN ('user', 'chat', 'channel')
       ORDER BY s.telegram_chat_id`,
      [bdAccountId.trim()]
    );
    const junctionRows = await pool.query(
      'SELECT telegram_chat_id::text, folder_id FROM bd_account_sync_chat_folders WHERE bd_account_id = $1',
      [bdAccountId.trim()]
    );
    const folderIdsByChat = new Map<string, number[]>();
    for (const r of junctionRows.rows as { telegram_chat_id: string; folder_id: number }[]) {
      const tid = String(r.telegram_chat_id);
      if (!folderIdsByChat.has(tid)) folderIdsByChat.set(tid, []);
      folderIdsByChat.get(tid)!.push(Number(r.folder_id));
    }

    const chats: InternalSyncChatRow[] = (chatsRows.rows as Array<{
      telegram_chat_id: string;
      title: string | null;
      peer_type: string;
      history_exhausted: boolean;
      folder_id: number | null;
    }>).map((row) => ({
      telegram_chat_id: row.telegram_chat_id,
      title: row.title,
      peer_type: row.peer_type,
      history_exhausted: Boolean(row.history_exhausted),
      folder_id: row.folder_id,
      folder_ids: folderIdsByChat.get(row.telegram_chat_id) ?? [],
    }));

    res.json({ chats });
  }));

  return router;
}
