// @ts-nocheck — GramJS types are incomplete
import { TelegramClient, Api } from 'telegram';
import type { Pool } from 'pg';
import { encryptSession, decryptIfNeeded } from '../crypto';
import type { TelegramManagerDeps, TelegramClientInfo, StructuredLog } from './types';

export class SessionManager {
  private readonly pool: Pool;
  private readonly log: StructuredLog;
  private readonly clients: Map<string, TelegramClientInfo>;
  private sessionSaveInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_SAVE_INTERVAL = 300000; // 5 minutes

  constructor(private readonly deps: TelegramManagerDeps) {
    this.pool = deps.pool;
    this.log = deps.log;
    this.clients = deps.clients;
  }

  async saveSession(accountId: string, client: TelegramClient): Promise<void> {
    try {
      const sessionString = client.session.save() as string;
      await this.pool.query(
        'UPDATE bd_accounts SET session_string = $1, session_encrypted = true, last_activity = NOW() WHERE id = $2',
        [encryptSession(sessionString), accountId]
      );
    } catch (error: any) {
      this.log.error({ message: `Error saving session for account ${accountId}`, error: error?.message || String(error) });
    }
  }

  async saveAllSessions(): Promise<void> {
    for (const [accountId, clientInfo] of this.clients) {
      if (clientInfo.isConnected && clientInfo.client.connected) {
        try {
          await this.saveSession(accountId, clientInfo.client);
          clientInfo.lastActivity = new Date();
        } catch (error: any) {
          this.log.error({ message: `Error saving session for account ${accountId}`, error: error?.message || String(error) });
        }
      }
    }
  }

  async saveAccountProfile(accountId: string, client: TelegramClient): Promise<void> {
    try {
      const me = (await client.getMe()) as Api.User;
      const telegramId = String(me?.id ?? '');
      const firstName = (me?.firstName ?? '').trim() || null;
      const lastName = (me?.lastName ?? '').trim() || null;
      const username = (me?.username ?? '').trim() || null;
      const phoneNumber = (me?.phone ?? '').trim() || null;

      let bio: string | null = null;
      let photoFileId: string | null = null;

      try {
        const inputMe = await client.getInputEntity('me');
        const fullUserResult = await client.invoke(
          new Api.users.GetFullUser({ id: inputMe })
        ) as Api.users.UserFull;
        if (fullUserResult?.fullUser?.about) {
          bio = String(fullUserResult.fullUser.about).trim() || null;
        }
        const profilePhoto = fullUserResult?.fullUser?.profile_photo;
        if (profilePhoto && typeof (profilePhoto as any).id === 'number') {
          photoFileId = String((profilePhoto as any).id);
        }
      } catch (e: any) {
        this.log.warn({ message: `GetFullUser for ${accountId} failed (non-fatal)`, error: e?.message });
      }

      if (!photoFileId) {
        try {
          const inputMe = await client.getInputEntity('me');
          const photos = await client.invoke(
            new Api.photos.GetUserPhotos({
              userId: inputMe,
              offset: 0,
              maxId: BigInt(0),
              limit: 1,
            })
          ) as Api.photos.Photos;
          const photo = (photos as any).photos?.[0];
          if (photo && typeof (photo as any).id === 'number') {
            photoFileId = String((photo as any).id);
          }
        } catch (e: any) {
          this.log.warn({ message: `GetUserPhotos for ${accountId} failed (non-fatal)`, error: e?.message });
        }
      }

      await this.pool.query(
        `UPDATE bd_accounts SET
          telegram_id = $1, phone_number = COALESCE($2, phone_number),
          first_name = $3, last_name = $4, username = $5, bio = $6, photo_file_id = $7,
          last_activity = NOW()
         WHERE id = $8`,
        [telegramId, phoneNumber, firstName, lastName, username, bio, photoFileId, accountId]
      );
      this.log.info({ message: `Profile saved for account ${accountId}` });
    } catch (error: any) {
      this.log.error({ message: `Error saving profile for account ${accountId}`, error: error?.message || String(error) });
    }
  }

  startSessionSaveInterval(): void {
    this.sessionSaveInterval = setInterval(async () => {
      try {
        await this.saveAllSessions();
      } catch (error) {
        this.log.error({ message: "Error during session save", error: String(error) });
      }
    }, this.SESSION_SAVE_INTERVAL);
  }

  stopSessionSaveInterval(): void {
    if (this.sessionSaveInterval) {
      clearInterval(this.sessionSaveInterval);
      this.sessionSaveInterval = null;
    }
  }
}
