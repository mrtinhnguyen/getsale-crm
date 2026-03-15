'use client';

import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import type { Company } from '@/lib/api/crm';
import { Button } from '@/components/ui/Button';

interface CompanyDetailProps {
  company: Company;
  onEdit: () => void;
  onDelete: () => void;
}

export function CompanyDetail({ company, onEdit, onDelete }: CompanyDetailProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10 text-primary">
          <Building2 className="w-8 h-8" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading text-lg font-semibold text-foreground truncate">{company.name}</h3>
          {company.industry && <p className="text-sm text-muted-foreground">{company.industry}</p>}
          {company.size && <p className="text-sm text-muted-foreground">{t('crm.size')}: {company.size}</p>}
        </div>
      </div>
      {company.description && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-1">{t('crm.description')}</h4>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{company.description}</p>
        </div>
      )}
      <div className="flex gap-2 pt-4 border-t border-border">
        <Button variant="outline" size="sm" onClick={onEdit}>{t('crm.editAction')}</Button>
        <Button variant="danger" size="sm" onClick={onDelete}>{t('crm.deleteAction')}</Button>
      </div>
    </div>
  );
}
