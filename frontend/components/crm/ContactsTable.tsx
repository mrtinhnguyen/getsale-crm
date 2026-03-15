'use client';

import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import type { Contact } from '@/lib/api/crm';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { ContactRow } from './ContactRow';

interface ContactsTableProps {
  contacts: Contact[];
  loading: boolean;
  onOpen: (id: string) => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onAddToFunnel: (contact: Contact) => void;
  onAdd: () => void;
}

export function ContactsTable({ contacts, loading, onOpen, onEdit, onDelete, onAddToFunnel, onAdd }: ContactsTableProps) {
  const { t } = useTranslation();

  const header = (
    <thead className="bg-muted/50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.name')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.email')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('common.company')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.phone')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Username</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Telegram ID</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.premium')}</th>
        <th className="px-6 py-3 w-24" />
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <table className="w-full">
        {header}
        <TableSkeleton rows={5} cols={7} />
      </table>
    );
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={User}
        title={t('crm.noContacts')}
        description={t('crm.noContactsDesc')}
        action={<Button onClick={onAdd}>{t('crm.addContact')}</Button>}
      />
    );
  }

  return (
    <table className="w-full">
      {header}
      <tbody className="divide-y divide-border">
        {contacts.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            onOpen={() => onOpen(c.id)}
            onEdit={() => onEdit(c)}
            onDelete={() => onDelete(c)}
            onAddToFunnel={() => onAddToFunnel(c)}
          />
        ))}
      </tbody>
    </table>
  );
}
