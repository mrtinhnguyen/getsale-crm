'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChatAvatar } from '@/components/messaging/ChatAvatar';
import type { Chat } from '@/app/dashboard/messaging/types';

interface ForwardMessageModalProps {
  selectedAccountId: string;
  displayChats: Chat[];
  currentChannelId: string | null;
  forwardingToChatId: string | null;
  getChatNameWithOverrides: (chat: Chat) => string;
  onForward: (toChatId: string) => void;
  onClose: () => void;
}

export function ForwardMessageModal({
  selectedAccountId,
  displayChats,
  currentChannelId,
  forwardingToChatId,
  getChatNameWithOverrides,
  onForward,
  onClose,
}: ForwardMessageModalProps) {
  const { t } = useTranslation();
  const filteredChats = displayChats.filter((c) => c.channel_id !== currentChannelId);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => !forwardingToChatId && onClose()}
    >
      <div
        className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full mx-4 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-border font-semibold">{t('messaging.forwardToChat')}</div>
        <div className="overflow-y-auto flex-1 min-h-0 p-2">
          {filteredChats.map((chat) => (
            <button
              key={chat.channel_id}
              type="button"
              onClick={() => onForward(chat.channel_id)}
              disabled={!!forwardingToChatId}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent text-left disabled:opacity-50"
            >
              <ChatAvatar bdAccountId={selectedAccountId} chatId={chat.channel_id} chat={chat} className="w-10 h-10" />
              <span className="truncate flex-1">{getChatNameWithOverrides(chat)}</span>
              {forwardingToChatId === chat.channel_id && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            </button>
          ))}
          {filteredChats.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">{t('messaging.noChats')}</p>
          )}
        </div>
        <div className="p-2 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={!!forwardingToChatId}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
