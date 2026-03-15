import { apiClient } from './client';
import type { CompaniesListResponse } from './crm';

export interface ActivityItem {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  action_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface DashboardStats {
  companies: number;
  contacts: number;
  messages: number;
  leads: number;
}

interface Pipeline {
  id: string;
  is_default?: boolean;
}

interface LeadsResponse {
  pagination?: { total?: number };
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const [companiesRes, contactsRes, messagesRes, pipelinesRes] = await Promise.all([
    apiClient.get<CompaniesListResponse>('/api/crm/companies', { params: { limit: 1 } }).catch(() => ({ data: { items: [], pagination: { total: 0 } } })),
    apiClient.get<{ items?: unknown[]; pagination?: { total?: number } }>('/api/crm/contacts', { params: { limit: 1 } }).catch(() => ({ data: { items: [], pagination: { total: 0 } } })),
    apiClient.get<unknown[]>('/api/messaging/inbox').catch(() => ({ data: [] as unknown[] })),
    apiClient.get<Pipeline[]>('/api/pipeline').catch(() => ({ data: [] as Pipeline[] })),
  ]);

  const pipelines = Array.isArray(pipelinesRes.data) ? pipelinesRes.data : [];
  const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0];
  let leadsTotal = 0;
  if (defaultPipeline?.id) {
    const leadsRes = await apiClient
      .get<LeadsResponse>('/api/pipeline/leads', { params: { pipelineId: defaultPipeline.id, limit: 1 } })
      .catch(() => ({ data: { pagination: { total: 0 } } }));
    leadsTotal = leadsRes.data?.pagination?.total ?? 0;
  }

  const companiesData = companiesRes.data;
  const companiesCount = 'pagination' in companiesData && companiesData.pagination
    ? (companiesData as CompaniesListResponse).pagination.total
    : Array.isArray(companiesData) ? companiesData.length : 0;

  const contactsData = contactsRes.data;
  const contactsCount = contactsData && 'pagination' in contactsData && contactsData.pagination
    ? contactsData.pagination.total ?? 0
    : Array.isArray(contactsData) ? contactsData.length : 0;

  return {
    companies: companiesCount,
    contacts: contactsCount,
    messages: Array.isArray(messagesRes.data) ? messagesRes.data.length : 0,
    leads: leadsTotal,
  };
}

export async function fetchActivityFeed(limit = 50): Promise<ActivityItem[]> {
  const { data } = await apiClient.get<ActivityItem[]>('/api/activity', { params: { limit } });
  return Array.isArray(data) ? data : [];
}
