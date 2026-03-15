'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { User, Crown, Filter, Pencil, Trash2, ChevronRight } from 'lucide-react';
import type { Contact } from '@/lib/api/crm';
import { getContactDisplayName } from '@/app/dashboard/crm/hooks/useCrmData';

interface ContactRowProps {
  contact: Contact;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddToFunnel: () => void;
}

export const ContactRow = React.memo(function ContactRow({
  contact,
  onOpen,
  onEdit,
  onDelete,
  onAddToFunnel,
}: ContactRowProps) {
  const { t } = useTranslation();
  const name = getContactDisplayName(contact, t);

  return (
    <tr
      className="hover:bg-muted/30 transition-colors cursor-pointer group"
      onClick={onOpen}
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-primary/10 text-primary">
            <User className="w-4 h-4" />
          </div>
          <span className="font-medium text-foreground">{name}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">{contact.email ?? '—'}</td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        {contact.companyName ?? contact.company_name ?? '—'}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">{contact.phone ?? '—'}</td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        {contact.username ? (contact.username.startsWith('@') ? contact.username : `@${contact.username}`) : '—'}
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">{contact.telegram_id ?? '—'}</td>
      <td className="px-6 py-4 text-sm text-muted-foreground">
        {contact.premium === true ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Crown className="w-4 h-4" />{t('crm.yes')}
          </span>
        ) : contact.premium === false ? (
          <span className="text-muted-foreground">{t('crm.no')}</span>
        ) : '—'}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddToFunnel(); }}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('pipeline.addToFunnel')}
            aria-label={t('pipeline.addToFunnel')}
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('crm.editAction')}
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={t('crm.deleteAction')}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </td>
    </tr>
  );
});
