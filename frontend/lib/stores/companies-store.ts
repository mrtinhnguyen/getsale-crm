import { create } from 'zustand';
import {
  type Company,
  type PaginationMeta,
  fetchCompanies,
  fetchCompany,
  createCompany as apiCreateCompany,
  updateCompany as apiUpdateCompany,
  deleteCompany,
} from '@/lib/api/crm';

interface CompaniesState {
  byId: Record<string, Company>;
  ids: string[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;

  fetchAll: (page?: number, limit?: number, search?: string) => Promise<void>;
  fetchOne: (id: string) => Promise<Company>;
  create: (data: Parameters<typeof apiCreateCompany>[0]) => Promise<Company>;
  update: (id: string, data: Parameters<typeof apiUpdateCompany>[1]) => Promise<Company>;
  remove: (id: string) => Promise<void>;
  getById: (id: string) => Company | undefined;
}

const defaultPagination: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  byId: {},
  ids: [],
  pagination: defaultPagination,
  loading: false,
  error: null,

  fetchAll: async (page = 1, limit = 20, search?: string) => {
    set({ loading: true, error: null });
    try {
      const { items, pagination } = await fetchCompanies({
        page,
        limit,
        ...(search && { search }),
      });
      const byId: Record<string, Company> = {};
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
      const message = err instanceof Error ? err.message : 'Failed to fetch companies';
      set({ loading: false, error: message });
      throw err;
    }
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const company = await fetchCompany(id);
      set((state) => ({
        byId: { ...state.byId, [company.id]: company },
        ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
        loading: false,
        error: null,
      }));
      return company;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch company';
      set({ loading: false, error: message });
      throw err;
    }
  },

  create: async (data) => {
    set({ loading: true, error: null });
    try {
      const company = await apiCreateCompany(data);
      set((state) => ({
        byId: { ...state.byId, [company.id]: company },
        ids: [company.id, ...state.ids],
        loading: false,
        error: null,
      }));
      return company;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create company';
      set({ loading: false, error: message });
      throw err;
    }
  },

  update: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const company = await apiUpdateCompany(id, data);
      set((state) => ({
        byId: { ...state.byId, [company.id]: company },
        loading: false,
        error: null,
      }));
      return company;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update company';
      set({ loading: false, error: message });
      throw err;
    }
  },

  remove: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await deleteCompany(id);
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
      const message = err instanceof Error ? err.message : 'Failed to delete company';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getById: (id: string) => get().byId[id],
}));
