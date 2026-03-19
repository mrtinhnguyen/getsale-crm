// @ts-nocheck — GramJS types
import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';

/** Returns true if chatId looks like a username (non-numeric or not a plain number string). */
export function isUsernameLike(chatId: string): boolean {
  const s = (chatId ?? '').trim().replace(/^@/, '');
  if (!s) return false;
  const n = Number(s);
  return Number.isNaN(n) || s !== String(n);
}

/**
 * Resolve @username via contacts.ResolveUsername (server-side). Returns InputPeer for sending
 * without relying on session cache; use for guaranteed delivery to new contacts.
 */
export async function resolveUsernameToInputPeer(
  client: TelegramClient,
  username: string
): Promise<Api.TypeInputPeer | null> {
  const u = (username ?? '').trim().replace(/^@/, '');
  if (!u) return null;
  try {
    const result = (await client.invoke(
      new Api.contacts.ResolveUsername({ username: u })
    )) as {
      peer?: { className?: string; userId?: bigint; channelId?: bigint };
      users?: Array<{ id?: bigint; accessHash?: bigint; className?: string }>;
      chats?: Array<{ id?: bigint; accessHash?: bigint; className?: string }>;
    };
    const peer = result?.peer;
    const users = result?.users ?? [];
    const chats = result?.chats ?? [];
    if (peer?.className === 'PeerUser') {
      const user = users.find((x) => x?.id === (peer as any).userId) ?? users[0];
      if (user?.id != null) {
        return new Api.InputPeerUser({ userId: user.id, accessHash: user.accessHash ?? BigInt(0) });
      }
    }
    if (peer?.className === 'PeerChannel') {
      const chat = chats.find((x) => x?.id === (peer as any).channelId) ?? chats[0];
      if (chat?.id != null) {
        return new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash ?? BigInt(0) });
      }
    }
  } catch {
    // Caller can log; return null to fall back to getInputEntity
  }
  return null;
}
