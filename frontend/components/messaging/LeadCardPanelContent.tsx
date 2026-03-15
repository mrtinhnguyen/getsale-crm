'use client';

import { useTranslation } from 'react-i18next';
import { Loader2, MessageSquare, ExternalLink, StickyNote, Bell, Trash2, User } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { LeadContextAvatarFromContext } from '@/components/messaging/LeadContextAvatar';
import {
  fetchContactNotes, deleteNote,
  fetchContactReminders, updateReminder, deleteReminder,
} from '@/lib/api/crm';
import { formatDealAmount } from '@/lib/format/currency';
import type { LeadContext, Note, Reminder } from '@/app/dashboard/messaging/types';
import { formatLeadPanelDate } from '@/app/dashboard/messaging/utils';

interface LeadCardPanelContentProps {
  leadContext: LeadContext | null;
  loading: boolean;
  error: string | null;
  selectedAccountId: string | null;
  chatName: string;
  notes: Note[];
  reminders: Reminder[];
  onNotesChange: (notes: Note[]) => void;
  onRemindersChange: (reminders: Reminder[]) => void;
  onCreateSharedChat: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onAddNote: () => void;
  onAddReminder: () => void;
  onOpenLeadCard: () => void;
}

export function LeadCardPanelContent({
  leadContext,
  loading,
  error,
  selectedAccountId,
  chatName,
  notes,
  reminders,
  onNotesChange,
  onRemindersChange,
  onCreateSharedChat,
  onMarkWon,
  onMarkLost,
  onAddNote,
  onAddReminder,
  onOpenLeadCard,
}: LeadCardPanelContentProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-center p-6">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (!leadContext) return <div className="flex-1 min-h-0 overflow-y-auto" />;

  const handleDeleteNote = (noteId: string) => {
    if (!leadContext.contact_id) return;
    deleteNote(noteId).then(() => fetchContactNotes(leadContext.contact_id!).then(onNotesChange));
  };

  const handleCompleteReminder = (reminderId: string) => {
    if (!leadContext.contact_id) return;
    updateReminder(reminderId, { done: true }).then(() =>
      fetchContactReminders(leadContext.contact_id!).then(onRemindersChange),
    );
  };

  const handleDeleteReminder = (reminderId: string) => {
    if (!leadContext.contact_id) return;
    deleteReminder(reminderId).then(() =>
      fetchContactReminders(leadContext.contact_id!).then(onRemindersChange),
    );
  };

  const sharedChatLink = (() => {
    if (leadContext.shared_chat_invite_link?.trim()) return leadContext.shared_chat_invite_link.trim();
    if (leadContext.shared_chat_channel_id != null) {
      const raw = Number(leadContext.shared_chat_channel_id);
      const id = Number.isNaN(raw)
        ? String(leadContext.shared_chat_channel_id).replace(/^-100/, '')
        : String(Math.abs(raw));
      return `https://t.me/c/${id}`;
    }
    return null;
  })();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="space-y-4 px-4 py-4">
        {/* Contact header */}
        <div className="flex items-start gap-3">
          <LeadContextAvatarFromContext leadContext={leadContext} bdAccountId={selectedAccountId} className="w-10 h-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-base font-semibold text-foreground truncate">
              {leadContext.contact_name || chatName || '—'}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {leadContext.company_name || (leadContext.contact_username ? `@${String(leadContext.contact_username).replace(/^@/, '')}` : null) || '—'}
            </p>
            <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-md bg-primary/15 text-primary">
              {t('messaging.badgeLead')}
            </span>
          </div>
        </div>

        {/* Pipeline info */}
        <dl className="grid grid-cols-1 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs">{t('crm.pipelineStage', 'Воронка / Стадия')}</dt>
            <dd className="font-medium text-foreground truncate mt-0.5">{leadContext.pipeline.name} → {leadContext.stage.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('crm.amount', 'Сумма')}</dt>
            <dd className="font-medium text-foreground mt-0.5">
              {leadContext.won_at && leadContext.revenue_amount != null && leadContext.revenue_amount > 0
                ? formatDealAmount(leadContext.revenue_amount, 'EUR')
                : '—'}
            </dd>
          </div>
        </dl>

        {/* Deal actions */}
        <div className="border-t border-border pt-3 space-y-2">
          {leadContext.campaign != null && !leadContext.shared_chat_created_at && (
            <Button variant="primary" size="sm" className="w-full justify-center" onClick={onCreateSharedChat}>
              {t('messaging.createSharedChat')}
            </Button>
          )}
          {leadContext.campaign != null && leadContext.shared_chat_created_at && (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                ✓ {t('messaging.sharedChatCreated', 'Общий чат создан')}
              </div>
              {sharedChatLink && (
                <a href={sharedChatLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  {t('messaging.openInTelegram', 'Открыть в Telegram')}<ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}
          {leadContext.shared_chat_created_at && !leadContext.won_at && !leadContext.lost_at && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={onMarkWon}>
                ✓ {t('messaging.markWon', 'Закрыть сделку')}
              </Button>
              <Button variant="outline" size="sm" className="flex-1 text-muted-foreground hover:text-destructive hover:border-destructive/50" onClick={onMarkLost}>
                ✕ {t('messaging.markLost', 'Потеряно')}
              </Button>
            </div>
          )}
          {leadContext.won_at && (
            <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ✓ {t('messaging.dealWon', 'Сделка закрыта')}
              {leadContext.revenue_amount != null && leadContext.revenue_amount > 0 ? ` — ${formatDealAmount(leadContext.revenue_amount, 'EUR')}` : ''}
            </div>
          )}
          {leadContext.lost_at && (
            <div className="text-xs text-muted-foreground">✕ {t('messaging.dealLost', 'Сделка потеряна')}</div>
          )}
        </div>

        {/* Quick actions */}
        {leadContext.contact_id && (
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" className="justify-center gap-1.5" onClick={onAddNote}>
              <StickyNote className="w-4 h-4" />
              <span className="text-xs">{t('pipeline.dealFormAddNote', 'Добавить заметку')}</span>
            </Button>
            <Button variant="outline" size="sm" className="justify-center gap-1.5" onClick={onAddReminder}>
              <Bell className="w-4 h-4" />
              <span className="text-xs">{t('pipeline.dealFormAddReminder', 'Добавить напоминание')}</span>
            </Button>
            <a
              href={`/dashboard/messaging?contactId=${leadContext.contact_id}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs">{t('pipeline.dealFormOpenChat', 'Открыть чат')}</span>
            </a>
          </div>
        )}

        {/* Notes */}
        <div className="border-t border-border pt-3 space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.notes', 'Заметки')}</h4>
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('crm.noNotes', 'Нет заметок')}</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="rounded-lg border border-border bg-muted/20 p-2 text-sm">
                  <p className="text-foreground whitespace-pre-wrap break-words">{note.content || '—'}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground">{formatLeadPanelDate(note.created_at)}</span>
                    <button type="button" onClick={() => handleDeleteNote(note.id)} className="text-muted-foreground hover:text-destructive text-xs flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" />{t('common.delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Reminders */}
        <div className="border-t border-border pt-3 space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.reminders', 'Напоминания')}</h4>
          {reminders.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('crm.noReminders', 'Нет напоминаний')}</p>
          ) : (
            <ul className="space-y-2">
              {reminders.map((rem) => (
                <li key={rem.id} className={clsx('rounded-lg border p-2 text-sm', rem.done ? 'border-border bg-muted/10 opacity-75' : 'border-border bg-muted/20')}>
                  <p className="text-foreground font-medium">{rem.title || '—'}</p>
                  <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
                    <span className="text-xs text-muted-foreground">{formatLeadPanelDate(rem.remind_at)}</span>
                    {rem.done ? (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('crm.markDone', 'Выполнено')}</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleCompleteReminder(rem.id)} className="text-xs text-primary hover:underline">
                          {t('crm.markDone', 'Выполнено')}
                        </button>
                        <button type="button" onClick={() => handleDeleteReminder(rem.id)} className="text-muted-foreground hover:text-destructive p-0.5">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button variant="outline" size="sm" className="w-full justify-center gap-2" onClick={onOpenLeadCard}>
          <User className="w-4 h-4" />{t('messaging.openLeadCard', 'Открыть карточку лида')}
        </Button>
      </div>
    </div>
  );
}
