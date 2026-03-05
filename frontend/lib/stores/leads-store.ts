import { create } from 'zustand';
import {
  type Lead,
  fetchLeads,
  addLeadToPipeline,
  updateLead,
  removeLead,
} from '@/lib/api/pipeline';

interface LeadsByPipeline {
  items: Lead[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface LeadsState {
  byPipelineId: Record<string, LeadsByPipeline>;
  loading: boolean;
  error: string | null;

  fetchByPipeline: (
    pipelineId: string,
    params?: { stageId?: string; page?: number; limit?: number }
  ) => Promise<void>;
  moveLead: (leadId: string, stageId: string, orderIndex?: number) => Promise<void>;
  create: (data: { contactId: string; pipelineId: string; stageId?: string }) => Promise<Lead>;
  remove: (leadId: string) => Promise<void>;
  getLeadsByPipeline: (pipelineId: string) => Lead[];
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  byPipelineId: {},
  loading: false,
  error: null,

  fetchByPipeline: async (pipelineId, params = {}) => {
    const { stageId, page = 1, limit = 50 } = params;
    set({ loading: true, error: null });
    try {
      const { items, pagination } = await fetchLeads({
        pipelineId,
        ...(stageId && { stageId }),
        page,
        limit,
      });
      set((state) => ({
        byPipelineId: {
          ...state.byPipelineId,
          [pipelineId]: { items, pagination },
        },
        loading: false,
        error: null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch leads';
      set({ loading: false, error: message });
      throw err;
    }
  },

  moveLead: async (leadId: string, stageId: string, orderIndex?: number) => {
    set({ loading: true, error: null });
    try {
      const updated = await updateLead(leadId, {
        stageId,
        ...(orderIndex !== undefined && { orderIndex }),
      });
      set((state) => {
        const newByPipelineId = { ...state.byPipelineId };
        for (const pipelineId of Object.keys(newByPipelineId)) {
          const entry = newByPipelineId[pipelineId];
          if (entry) {
            const idx = entry.items.findIndex((l) => l.id === leadId);
            if (idx >= 0) {
              const items = [...entry.items];
              items[idx] = updated;
              newByPipelineId[pipelineId] = { ...entry, items };
              break;
            }
          }
        }
        return {
          byPipelineId: newByPipelineId,
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to move lead';
      set({ loading: false, error: message });
      throw err;
    }
  },

  create: async (data) => {
    set({ loading: true, error: null });
    try {
      const lead = await addLeadToPipeline(data);
      set((state) => {
        const entry = state.byPipelineId[lead.pipeline_id] ?? {
          items: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        };
        const items = [lead, ...entry.items];
        const pagination = {
          ...entry.pagination,
          total: entry.pagination.total + 1,
        };
        return {
          byPipelineId: {
            ...state.byPipelineId,
            [lead.pipeline_id]: { items, pagination },
          },
          loading: false,
          error: null,
        };
      });
      return lead;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create lead';
      set({ loading: false, error: message });
      throw err;
    }
  },

  remove: async (leadId: string) => {
    set({ loading: true, error: null });
    try {
      await removeLead(leadId);
      set((state) => {
        const newByPipelineId = { ...state.byPipelineId };
        for (const pipelineId of Object.keys(newByPipelineId)) {
          const entry = newByPipelineId[pipelineId];
          if (entry) {
            const idx = entry.items.findIndex((l) => l.id === leadId);
            if (idx >= 0) {
              const items = entry.items.filter((l) => l.id !== leadId);
              const pagination = {
                ...entry.pagination,
                total: Math.max(0, entry.pagination.total - 1),
              };
              newByPipelineId[pipelineId] = { items, pagination };
              break;
            }
          }
        }
        return {
          byPipelineId: newByPipelineId,
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove lead';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getLeadsByPipeline: (pipelineId: string) => {
    return get().byPipelineId[pipelineId]?.items ?? [];
  },
}));
