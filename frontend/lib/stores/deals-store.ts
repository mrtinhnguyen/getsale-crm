import { create } from 'zustand';
import {
  type Deal,
  type PaginationMeta,
  fetchDeals,
  fetchDeal,
  createDeal as apiCreateDeal,
  updateDeal as apiUpdateDeal,
  updateDealStage,
  deleteDeal,
} from '@/lib/api/crm';

interface DealsState {
  byId: Record<string, Deal>;
  ids: string[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;

  fetchAll: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    pipelineId?: string;
    stageId?: string;
    companyId?: string;
    contactId?: string;
  }) => Promise<void>;
  fetchOne: (id: string) => Promise<Deal>;
  create: (data: Parameters<typeof apiCreateDeal>[0]) => Promise<Deal>;
  update: (id: string, data: Parameters<typeof apiUpdateDeal>[1]) => Promise<Deal>;
  updateStage: (id: string, stageId: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  getById: (id: string) => Deal | undefined;
}

const defaultPagination: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

export const useDealsStore = create<DealsState>((set, get) => ({
  byId: {},
  ids: [],
  pagination: defaultPagination,
  loading: false,
  error: null,

  fetchAll: async (params = {}) => {
    const { page = 1, limit = 20, search, pipelineId, stageId, companyId, contactId } = params;
    set({ loading: true, error: null });
    try {
      const { items, pagination } = await fetchDeals({
        page,
        limit,
        ...(search && { search }),
        ...(pipelineId && { pipelineId }),
        ...(stageId && { stageId }),
        ...(companyId && { companyId }),
        ...(contactId && { contactId }),
      });
      const byId: Record<string, Deal> = {};
      const ids: string[] = [];
      for (const item of items) {
        byId[item.id] = item;
        ids.push(item.id);
      }
      set((state) => ({
        byId: { ...state.byId, ...byId },
        ids,
        pagination,
        loading: false,
        error: null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch deals';
      set({ loading: false, error: message });
      throw err;
    }
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const deal = await fetchDeal(id);
      set((state) => ({
        byId: { ...state.byId, [deal.id]: deal },
        ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
        loading: false,
        error: null,
      }));
      return deal;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch deal';
      set({ loading: false, error: message });
      throw err;
    }
  },

  create: async (data) => {
    set({ loading: true, error: null });
    try {
      const deal = await apiCreateDeal(data);
      set((state) => ({
        byId: { ...state.byId, [deal.id]: deal },
        ids: [deal.id, ...state.ids],
        loading: false,
        error: null,
      }));
      return deal;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create deal';
      set({ loading: false, error: message });
      throw err;
    }
  },

  update: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const deal = await apiUpdateDeal(id, data);
      set((state) => ({
        byId: { ...state.byId, [deal.id]: deal },
        loading: false,
        error: null,
      }));
      return deal;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update deal';
      set({ loading: false, error: message });
      throw err;
    }
  },

  updateStage: async (id: string, stageId: string, reason?: string) => {
    set({ loading: true, error: null });
    try {
      await updateDealStage(id, { stageId, reason });
      const deal = await fetchDeal(id);
      set((state) => ({
        byId: { ...state.byId, [deal.id]: deal },
        loading: false,
        error: null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update deal stage';
      set({ loading: false, error: message });
      throw err;
    }
  },

  remove: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await deleteDeal(id);
      set((state) => {
        const { [id]: _, ...byId } = state.byId;
        return {
          byId,
          ids: state.ids.filter((i) => i !== id),
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete deal';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getById: (id: string) => get().byId[id],
}));
