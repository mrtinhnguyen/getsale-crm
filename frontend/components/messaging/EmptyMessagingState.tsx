'use client';

import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';

export function EmptyMessagingState() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/20">
      <div className="text-center px-4">
        <MessageSquare className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {t('messaging.selectChat')}
        </h3>
        <p className="text-muted-foreground text-sm">
          {t('messaging.selectChatDesc')}
        </p>
      </div>
    </div>
  );
}
