'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Pencil, Trash2, ChevronRight } from 'lucide-react';
import type { Company } from '@/lib/api/crm';

interface CompanyRowProps {
  company: Company;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const CompanyRow = React.memo(function CompanyRow({
  company,
  onOpen,
  onEdit,
  onDelete,
}: CompanyRowProps) {
  const { t } = useTranslation();

  return (
    <tr
      className="hover:bg-muted/30 transition-colors cursor-pointer group"
      onClick={onOpen}
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Building2 className="w-4 h-4" />
          </div>
          <span className="font-medium text-foreground">{company.name}</span>
        </div>
      </td>
      <td className="px-6 py-4 text-sm text-muted-foreground">{company.industry ?? '—'}</td>
      <td className="px-6 py-4 text-sm text-muted-foreground">{company.size ?? '—'}</td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
