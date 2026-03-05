import { create } from 'zustand';
import {
  type Pipeline,
  type Stage,
  fetchPipelines,
  fetchStages,
} from '@/lib/api/pipeline';

interface PipelinesState {
  pipelines: Pipeline[];
  stagesByPipelineId: Record<string, Stage[]>;
  loading: boolean;
  error: string | null;

  fetchPipelines: () => Promise<void>;
  fetchStages: (pipelineId: string) => Promise<void>;
  getPipeline: (id: string) => Pipeline | undefined;
  getStages: (pipelineId: string) => Stage[];
}

export const usePipelinesStore = create<PipelinesState>((set, get) => ({
  pipelines: [],
  stagesByPipelineId: {},
  loading: false,
  error: null,

  fetchPipelines: async () => {
    set({ loading: true, error: null });
    try {
      const pipelines = await fetchPipelines();
      set({
        pipelines,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch pipelines';
      set({ loading: false, error: message });
      throw err;
    }
  },

  fetchStages: async (pipelineId: string) => {
    set({ loading: true, error: null });
    try {
      const stages = await fetchStages(pipelineId);
      set((state) => ({
        stagesByPipelineId: {
          ...state.stagesByPipelineId,
          [pipelineId]: stages,
        },
        loading: false,
        error: null,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch stages';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getPipeline: (id: string) => get().pipelines.find((p) => p.id === id),

  getStages: (pipelineId: string) => get().stagesByPipelineId[pipelineId] ?? [],
}));
