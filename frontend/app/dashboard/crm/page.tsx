'use client';

import { Building2, User, Plus, FileUp } from 'lucide-react';
import { fetchContact, type Company, type Contact } from '@/lib/api/crm';
import { safeGetItem } from '@/lib/safe-storage';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/SearchInput';
import { Pagination } from '@/components/ui/Pagination';
import { Button } from '@/components/ui/Button';
import { CompanyFormModal } from '@/components/crm/CompanyFormModal';
import { ContactFormModal } from '@/components/crm/ContactFormModal';
import { AddToFunnelModal } from '@/components/crm/AddToFunnelModal';
import { CompaniesTable } from '@/components/crm/CompaniesTable';
import { ContactsTable } from '@/components/crm/ContactsTable';
import { CompanyDetail } from '@/components/crm/CompanyDetail';
import { ContactDetail } from '@/components/crm/ContactDetail';
import { ImportContactsModal } from '@/components/crm/ImportContactsModal';
import { useCrmData, getContactDisplayName, type TabId } from './hooks/useCrmData';
import { clsx } from 'clsx';

const TABS: { id: TabId; i18nKey: string; icon: typeof Building2 }[] = [
  { id: 'companies', i18nKey: 'companies', icon: Building2 },
  { id: 'contacts', i18nKey: 'contacts', icon: User },
];

export default function CRMPage() {
  const d = useCrmData();
  const { t } = d;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground tracking-tight">{t('crm.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('crm.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {d.activeTab === 'companies' && (
            <Button onClick={() => { d.setCompanyEdit(null); d.setCompanyModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />{t('common.company')}
            </Button>
          )}
          {d.activeTab === 'contacts' && (
            <>
              <Button variant="outline" onClick={() => d.setImportModalOpen(true)}>
                <FileUp className="w-4 h-4 mr-2" />{t('crm.importContacts')}
              </Button>
              <Button onClick={() => { d.setContactEdit(null); d.setContactModalOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" />{t('common.contact')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-1" aria-label={t('crm.tabsAriaLabel')}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => d.setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-t-lg -mb-px',
                  d.activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <Icon className="w-4 h-4" />{t(`crm.${tab.i18nKey}`)}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <SearchInput
            placeholder={d.activeTab === 'companies' ? t('crm.searchCompanies') : t('crm.searchContacts')}
            value={d.search}
            onChange={(e) => d.setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>

      {d.error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">{d.error}</div>
      )}

      {/* Data Table */}
      <div className="rounded-xl border border-border bg-card shadow-soft overflow-hidden">
        {d.activeTab === 'companies' && (
          <CompaniesTable
            companies={d.companies}
            loading={d.loading}
            onOpen={(id) => d.openDetail('companies', id)}
            onEdit={(c) => { d.setCompanyEdit(c); d.setCompanyModalOpen(true); }}
            onDelete={(c) => d.setDeleteConfirm({ type: 'companies', id: c.id, name: c.name })}
            onAdd={() => d.setCompanyModalOpen(true)}
          />
        )}
        {d.activeTab === 'contacts' && (
          <ContactsTable
            contacts={d.contacts}
            loading={d.loading}
            onOpen={(id) => d.openDetail('contacts', id)}
            onEdit={(c) => d.openDetail('contacts', c.id)}
            onDelete={(c) => d.setDeleteConfirm({ type: 'contacts', id: c.id, name: getContactDisplayName(c, t) || c.email || c.id })}
            onAddToFunnel={(c) => d.setAddToFunnelContact(c)}
            onAdd={() => d.setContactModalOpen(true)}
          />
        )}
        {d.pagination && d.pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-border">
            <Pagination page={d.page} totalPages={d.pagination.totalPages} onPageChange={d.setPage} />
            <p className="mt-2 text-center text-sm text-muted-foreground">
              {t('crm.shownCount', {
                from: ((d.page - 1) * d.pagination.limit) + 1,
                to: Math.min(d.page * d.pagination.limit, d.pagination.total),
                total: d.pagination.total,
              })}
            </p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Modal
        isOpen={Boolean(d.detailId && d.detailType)}
        onClose={d.closeDetail}
        title={d.detailType === 'companies' ? t('common.company') : t('common.contact')}
        size="lg"
      >
        {d.detailData && d.detailType === 'companies' && (
          <CompanyDetail
            company={d.detailData as Company}
            onEdit={() => { d.setCompanyEdit(d.detailData as Company); d.setCompanyModalOpen(true); d.closeDetail(); }}
            onDelete={() => d.setDeleteConfirm({ type: 'companies', id: (d.detailData as Company).id, name: (d.detailData as Company).name })}
          />
        )}
        {d.detailData && d.detailType === 'contacts' && (
          <ContactDetail
            contact={d.detailData as Contact & { companyName?: string | null }}
            onEdit={() => {}}
            onDelete={() => d.setDeleteConfirm({ type: 'contacts', id: (d.detailData as Contact).id, name: getContactDisplayName(d.detailData as Contact, t) || (d.detailData as Contact).email || '' })}
            onAddToFunnel={() => d.setAddToFunnelContact(d.detailData as Contact)}
            onContactUpdated={(updated) => fetchContact(updated.id).then(d.setDetailData).catch(() => d.setDetailData(updated))}
          />
        )}
      </Modal>

      {/* Form Modals */}
      <CompanyFormModal
        isOpen={d.companyModalOpen}
        onClose={() => { d.setCompanyModalOpen(false); d.setCompanyEdit(null); }}
        onSuccess={() => { d.refresh(); d.setCompanyModalOpen(false); d.setCompanyEdit(null); }}
        edit={d.companyEdit}
      />
      <ContactFormModal
        isOpen={d.contactModalOpen}
        onClose={() => { d.setContactModalOpen(false); d.setContactEdit(null); }}
        onSuccess={() => { d.refresh(); d.setContactModalOpen(false); d.setContactEdit(null); }}
        edit={d.contactEdit}
      />
      <AddToFunnelModal
        isOpen={!!d.addToFunnelContact}
        onClose={() => d.setAddToFunnelContact(null)}
        contactId={d.addToFunnelContact?.id ?? ''}
        contactName={d.addToFunnelContact ? getContactDisplayName(d.addToFunnelContact, t) : undefined}
        defaultPipelineId={safeGetItem('pipeline.selectedPipelineId')}
      />

      {/* Delete Confirmation */}
      <Modal isOpen={Boolean(d.deleteConfirm)} onClose={() => d.setDeleteConfirm(null)} title={t('crm.deleteConfirmTitle')} size="sm">
        {d.deleteConfirm && (
          <div className="space-y-4">
            <p className="text-muted-foreground">{t('crm.deleteConfirmText', { name: d.deleteConfirm.name })}</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => d.setDeleteConfirm(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" className="flex-1" onClick={d.handleDelete} disabled={d.deleting}>
                {d.deleting ? t('common.deleting') : t('common.delete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Modal */}
      <ImportContactsModal
        isOpen={d.importModalOpen}
        onClose={() => d.setImportModalOpen(false)}
        onSuccess={d.loadContacts}
      />
    </div>
  );
}
