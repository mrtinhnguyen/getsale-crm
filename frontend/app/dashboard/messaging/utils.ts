import type { BDAccount, Chat, Message, MessageMediaType } from './types';

// ─── Account Helpers ─────────────────────────────────────────────────

export function getAccountDisplayName(account: BDAccount): string {
  if (account.display_name?.trim()) return account.display_name.trim();
  const first = (account.first_name ?? '').trim();
  const last = (account.last_name ?? '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  if (account.username?.trim()) return account.username.trim();
  if (account.phone_number?.trim()) return account.phone_number.trim();
  return account.telegram_id || account.id;
}

export function getAccountInitials(account: BDAccount): string {
  const name = getAccountDisplayName(account);
  const parts = name.replace(/@/g, '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  if (name.length >= 2) return name.slice(0, 2).toUpperCase();
  return name.slice(0, 1).toUpperCase() || '?';
}

// ─── Chat Helpers ────────────────────────────────────────────────────

export function getChatDisplayName(chat: Chat): string {
  if (chat.display_name?.trim()) return chat.display_name.trim();
  const firstLast = `${chat.first_name || ''} ${chat.last_name || ''}`.trim();
  if (firstLast && !/^Telegram\s+\d+$/.test(firstLast)) return firstLast;
  if (chat.username) return chat.username.startsWith('@') ? chat.username : `@${chat.username}`;
  if (chat.name?.trim()) return chat.name.trim();
  if (chat.email?.trim()) return chat.email.trim();
  if (chat.telegram_id) return chat.telegram_id;
  return '?';
}

export function getChatInitials(chat: Chat): string {
  const name = getChatDisplayName(chat).replace(/^@/, '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase().slice(0, 2);
  if (name.length >= 2) return name.slice(0, 2).toUpperCase();
  return name.slice(0, 1).toUpperCase() || '?';
}

export function getChatName(
  chat: Chat,
  overrides?: { firstName?: string; lastName?: string; usernames?: string[] },
): string {
  if (chat.display_name?.trim()) return chat.display_name.trim();
  const first = (overrides?.firstName ?? chat.first_name ?? '').trim();
  const last = (overrides?.lastName ?? chat.last_name ?? '').trim();
  const firstLast = `${first} ${last}`.trim();
  if (firstLast && !/^Telegram\s+\d+$/.test(firstLast)) return firstLast;
  const username = overrides?.usernames?.[0] ?? chat.username;
  if (username) return username.startsWith('@') ? username : `@${username}`;
  if (chat.name?.trim()) return chat.name.trim();
  if (chat.email?.trim()) return chat.email.trim();
  if (chat.telegram_id) return chat.telegram_id;
  return 'Unknown';
}

// ─── Message Helpers ─────────────────────────────────────────────────

export function getMessageMediaType(msg: Message): MessageMediaType {
  const media = msg.telegram_media;
  if (!media || typeof media !== 'object') return 'text';
  const type = (media as Record<string, unknown>)._ ?? (media as Record<string, unknown>).className;
  if (type === 'messageMediaPhoto' || type === 'MessageMediaPhoto') return 'photo';
  if (type === 'messageMediaDocument' || type === 'MessageMediaDocument') {
    const doc = (media as Record<string, unknown>).document as Record<string, unknown> | undefined;
    if (doc && Array.isArray(doc.attributes)) {
      for (const a of doc.attributes as Record<string, unknown>[]) {
        const attr = a._ ?? a.className;
        if (attr === 'documentAttributeAudio' || attr === 'DocumentAttributeAudio') {
          return a.voice ? 'voice' : 'audio';
        }
        if (attr === 'documentAttributeVideo' || attr === 'DocumentAttributeVideo') return 'video';
      }
    }
    return 'document';
  }
  if (type === 'messageMediaSticker' || type === 'MessageMediaSticker') return 'sticker';
  if (type === 'messageMediaContact' || type === 'MessageMediaContact') return 'unknown';
  return 'text';
}

export function getForwardedFromLabel(msg: Message): string | null {
  const extra = msg.telegram_extra;
  if (!extra || typeof extra !== 'object') return null;
  const fwd = extra.fwd_from as Record<string, unknown> | undefined;
  if (!fwd || typeof fwd !== 'object') return null;

  const fromNameRaw = (fwd.from_name ?? fwd.fromName) as string | undefined;
  const fromName = typeof fromNameRaw === 'string' && fromNameRaw.trim() ? fromNameRaw.trim() : null;
  if (fromName) return fromName;

  const postAuthorRaw = (fwd.post_author ?? fwd.postAuthor) as string | undefined;
  const postAuthor = typeof postAuthorRaw === 'string' && postAuthorRaw.trim() ? postAuthorRaw.trim() : null;
  if (postAuthor) return postAuthor;

  return null;
}

export function getMediaProxyUrl(bdAccountId: string, channelId: string, telegramMessageId: string): string {
  const base = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || '') : '';
  const params = new URLSearchParams({ channelId, messageId: telegramMessageId });
  return `${base}/api/bd-accounts/${bdAccountId}/media?${params.toString()}`;
}

// ─── Formatting ──────────────────────────────────────────────────────

export function formatTime(dateString: string): string {
  if (!dateString || !dateString.trim() || isNaN(new Date(dateString).getTime())) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days === 0) {
    if (minutes < 1) return 'только что';
    if (hours === 0) return `${minutes} мин. назад`;
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Вчера ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return date.toLocaleDateString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatLeadPanelDate(iso: string): string {
  if (!iso || isNaN(new Date(iso).getTime())) return '—';
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'short' });
  const year = d.getFullYear();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${month} ${year}, ${time}`;
}

// ─── Misc ────────────────────────────────────────────────────────────

export function getDraftKey(accountId: string, chatId: string): string {
  return `messaging.draft.${accountId}.${chatId}`;
}

export function getMessagesCacheKey(accountId: string, chatId: string): string {
  return `${accountId}:${chatId}`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
