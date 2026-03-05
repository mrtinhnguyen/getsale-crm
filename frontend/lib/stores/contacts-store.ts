import { create } from 'zustand';
import {
  type Contact,
  type PaginationMeta,
  fetchContacts,
  fetchContact,
  createContact as apiCreateContact,
  updateContact as apiUpdateContact,
  deleteContact,
} from '@/lib/api/crm';

interface ContactsState {
  byId: Record<string, Contact>;
  ids: string[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string | null;

  fetchAll: (page?: number, limit?: number, search?: string) => Promise<void>;
  fetchOne: (id: string) => Promise<Contact>;
  create: (data: Parameters<typeof apiCreateContact>[0]) => Promise<Contact>;
  update: (id: string, data: Parameters<typeof apiUpdateContact>[1]) => Promise<Contact>;
  remove: (id: string) => Promise<void>;
  getById: (id: string) => Contact | undefined;
}

const defaultPagination: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

export const useContactsStore = create<ContactsState>((set, get) => ({
  byId: {},
  ids: [],
  pagination: defaultPagination,
  loading: false,
  error: null,

  fetchAll: async (page = 1, limit = 20, search?: string) => {
    set({ loading: true, error: null });
    try {
      const { items, pagination } = await fetchContacts({
        page,
        limit,
        ...(search && { search }),
      });
      const byId: Record<string, Contact> = {};
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
      const message = err instanceof Error ? err.message : 'Failed to fetch contacts';
      set({ loading: false, error: message });
      throw err;
    }
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const contact = await fetchContact(id);
      set((state) => ({
        byId: { ...state.byId, [contact.id]: contact },
        ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
        loading: false,
        error: null,
      }));
      return contact;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch contact';
      set({ loading: false, error: message });
      throw err;
    }
  },

  create: async (data) => {
    set({ loading: true, error: null });
    try {
      const contact = await apiCreateContact(data);
      set((state) => ({
        byId: { ...state.byId, [contact.id]: contact },
        ids: [contact.id, ...state.ids],
        loading: false,
        error: null,
      }));
      return contact;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create contact';
      set({ loading: false, error: message });
      throw err;
    }
  },

  update: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const contact = await apiUpdateContact(id, data);
      set((state) => ({
        byId: { ...state.byId, [contact.id]: contact },
        loading: false,
        error: null,
      }));
      return contact;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update contact';
      set({ loading: false, error: message });
      throw err;
    }
  },

  remove: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await deleteContact(id);
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
      const message = err instanceof Error ? err.message : 'Failed to delete contact';
      set({ loading: false, error: message });
      throw err;
    }
  },

  getById: (id: string) => get().byId[id],
}));
