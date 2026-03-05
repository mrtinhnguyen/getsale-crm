import { vi } from 'vitest';

/**
 * Creates a mock Redis client for testing.
 * - get, set, del use an in-memory Map for storage
 * - Useful for testing caching or rate-limiting logic
 */
export function createMockRedis(): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  getStorage: () => Map<string, string>;
  clearStorage: () => void;
} {
  const storage = new Map<string, string>();

  const get = vi.fn(async (key: string): Promise<string | null> => {
    return storage.get(key) ?? null;
  });

  const set = vi.fn(async (key: string, value: string): Promise<void> => {
    storage.set(key, value);
  });

  const del = vi.fn(async (key: string): Promise<void> => {
    storage.delete(key);
  });

  return {
    get,
    set,
    del,
    getStorage: () => storage,
    clearStorage: () => storage.clear(),
  };
}
