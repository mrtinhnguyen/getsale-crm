'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  fetchCompanies,
  fetchCompany,
  fetchContact,
  deleteCompany,
  type Company,
  type Contact,
  type PaginationMeta,
} from '@/lib/api/crm';
import { useContactsStore } from '@/lib/stores/contacts-store';

export type TabId = 'companies' | 'contacts';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const VALID_TABS: TabId[] = ['companies', 'contacts'];

/** Display name for a contact: display_name → first+last (not "Telegram %") → @username → telegram_id → fallback */
export function getContactDisplayName(c: Contact, t: (key: string) => string): string {
  const dn = (c.display_name ?? '').trim();
  if (dn) return dn;
  const fn = (c.first_name ?? '').trim();
  const ln = (c.last_name ?? '').trim();
  const full = [fn, ln].filter(Boolean).join(' ').trim();
  if (full && !/^Telegram\s+\d+$/i.test(full)) return full;
  const un = (c.username ?? '').trim();
  if (un) return un.startsWith('@') ? un : `@${un}`;
  if (c.telegram_id) return String(c.telegram_id);
  return t('crm.noName');
}

export function useCrmData() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const urlOpenApplied = useRef(false);

  const [activeTab, setActiveTab] = useState<TabId>('companies');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesPagination, setCompaniesPagination] = useState<PaginationMeta | null>(null);

  const contactStoreIds = useContactsStore((s) => s.ids);
  const contactStoreById = useContactsStore((s) => s.byId);
  const contactStorePagination = useContactsStore((s) => s.pagination);
  const contactStoreFetchAll = useContactsStore((s) => s.fetchAll);
  const contactStoreRemove = useContactsStore((s) => s.remove);

  const contacts = useMemo<Contact[]>(
    () => contactStoreIds.map((id) => contactStoreById[id]).filter(Boolean),
    [contactStoreIds, contactStoreById],
  );
  const contactsPagination: PaginationMeta | null = contactStorePagination;

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailType, setDetailType] = useState<TabId | null>(null);
  const [detailData, setDetailData] = useState<Company | Contact | null>(null);

  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companyEdit, setCompanyEdit] = useState<Company | null>(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactEdit, setContactEdit] = useState<Contact | null>(null);
  const [addToFunnelContact, setAddToFunnelContact] = useState<Contact | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: TabId; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    if (urlOpenApplied.current) return;
    const tab = searchParams.get('tab');
    const open = searchParams.get('open');
    const resolvedTab = (tab === 'deals' ? 'contacts' : tab) as TabId;
    if (resolvedTab && open && VALID_TABS.includes(resolvedTab)) {
      urlOpenApplied.current = true;
      setActiveTab(resolvedTab);
      setDetailType(resolvedTab);
      setDetailId(open);
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchDebounced]);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCompanies({ page, limit: DEFAULT_LIMIT, search: searchDebounced || undefined });
      setCompanies(res.items);
      setCompaniesPagination(res.pagination);
    } catch {
      setError(t('crm.loadError'));
      setCompanies([]);
      setCompaniesPagination(null);
    } finally {
      setLoading(false);
    }
  }, [page, searchDebounced, t]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await contactStoreFetchAll(page, DEFAULT_LIMIT, searchDebounced || undefined);
    } catch {
      setError(t('crm.loadContactsError'));
    } finally {
      setLoading(false);
    }
  }, [page, searchDebounced, t, contactStoreFetchAll]);

  useEffect(() => {
    if (activeTab === 'companies') loadCompanies();
    else loadContacts();
  }, [activeTab, loadCompanies, loadContacts]);

  useEffect(() => {
    if (!detailId || !detailType) { setDetailData(null); return; }
    if (detailType === 'companies') {
      fetchCompany(detailId).then(setDetailData).catch(() => setDetailData(null));
    } else {
      fetchContact(detailId).then(setDetailData).catch(() => setDetailData(null));
    }
  }, [detailId, detailType]);

  const refresh = useCallback(() => {
    if (activeTab === 'companies') loadCompanies();
    else loadContacts();
  }, [activeTab, loadCompanies, loadContacts]);

  const openDetail = useCallback((type: TabId, id: string) => {
    setDetailType(type);
    setDetailId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetailType(null);
    setDetailData(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === 'companies') await deleteCompany(deleteConfirm.id);
      else await contactStoreRemove(deleteConfirm.id);
      setDeleteConfirm(null);
      if (detailId === deleteConfirm.id) {
        setDetailId(null);
        setDetailType(null);
        setDetailData(null);
      }
      refresh();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? t('crm.deleteError'));
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirm, detailId, refresh, t, contactStoreRemove]);

  const pagination = activeTab === 'companies' ? companiesPagination : contactsPagination;

  return {
    t,
    activeTab, setActiveTab,
    search, setSearch,
    page, setPage,
    loading, error,
    companies, contacts, pagination,
    detailId, detailType, detailData, setDetailData,
    openDetail, closeDetail,
    companyModalOpen, setCompanyModalOpen,
    companyEdit, setCompanyEdit,
    contactModalOpen, setContactModalOpen,
    contactEdit, setContactEdit,
    addToFunnelContact, setAddToFunnelContact,
    deleteConfirm, setDeleteConfirm,
    deleting, handleDelete,
    importModalOpen, setImportModalOpen,
    refresh, loadContacts,
  };
}
