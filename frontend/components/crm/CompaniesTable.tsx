'use client';

import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import type { Company } from '@/lib/api/crm';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CompanyRow } from './CompanyRow';

interface CompaniesTableProps {
  companies: Company[];
  loading: boolean;
  onOpen: (id: string) => void;
  onEdit: (company: Company) => void;
  onDelete: (company: Company) => void;
  onAdd: () => void;
}

export function CompaniesTable({ companies, loading, onOpen, onEdit, onDelete, onAdd }: CompaniesTableProps) {
  const { t } = useTranslation();

  const header = (
    <thead className="bg-muted/50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.name')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.industry')}</th>
        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('crm.size')}</th>
        <th className="px-6 py-3 w-24" />
      </tr>
    </thead>
  );

  if (loading) {
    return (
      <table className="w-full">
        {header}
        <TableSkeleton rows={5} cols={3} />
      </table>
    );
  }

  if (companies.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title={t('crm.noCompanies')}
        description={t('crm.noCompaniesDesc')}
        action={<Button onClick={onAdd}>{t('crm.addCompany')}</Button>}
      />
    );
  }

  return (
    <table className="w-full">
      {header}
      <tbody className="divide-y divide-border">
        {companies.map((c) => (
          <CompanyRow
            key={c.id}
            company={c}
            onOpen={() => onOpen(c.id)}
            onEdit={() => onEdit(c)}
            onDelete={() => onDelete(c)}
          />
        ))}
      </tbody>
    </table>
  );
}
