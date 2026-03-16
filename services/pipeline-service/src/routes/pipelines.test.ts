import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockPool } from '@getsale/test-utils';
import { createLogger } from '@getsale/logger';
import { pipelinesRouter } from './pipelines';

const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

const authHeaders = {
  'x-user-id': TEST_USER_ID,
  'x-organization-id': TEST_ORG_ID,
  'x-user-role': 'owner',
  'content-type': 'application/json',
};

describe('Pipelines Router', () => {
  let pool: ReturnType<typeof createMockPool>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = createMockPool();
    const log = createLogger('pipeline-service-test');
    const router = pipelinesRouter({ pool, log });
    app = createTestApp(router, { prefix: '/api/pipeline', log });
  });

  describe('GET /api/pipeline', () => {
    it('returns pipelines for org', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const res = await request(app)
        .get('/api/pipeline')
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns pipelines list', async () => {
      const mockPipelines = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          organization_id: TEST_ORG_ID,
          name: 'Sales Pipeline',
          description: 'Main sales flow',
          is_default: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      pool.query.mockResolvedValueOnce({
        rows: mockPipelines,
        rowCount: 1,
      });

      const res = await request(app)
        .get('/api/pipeline')
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Sales Pipeline');
    });
  });

  describe('POST /api/pipeline', () => {
    it('creates pipeline with default stages', async () => {
      const created = {
        id: '44444444-4444-4444-4444-444444444444',
        organization_id: TEST_ORG_ID,
        name: 'New Pipeline',
        description: null,
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // withOrgContext: BEGIN, set_config, then callback (INSERT pipeline + 7 INSERT stage), then COMMIT
      pool.query.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 })); // BEGIN
      pool.query.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 })); // set_config
      pool.query.mockImplementationOnce(async () => ({ rows: [created], rowCount: 1 })); // INSERT pipeline
      pool.query.mockResolvedValue(undefined); // 7 stage inserts + COMMIT

      const res = await request(app)
        .post('/api/pipeline')
        .set(authHeaders)
        .send({ name: 'New Pipeline' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Pipeline');
      expect(res.body.id).toBe(created.id);
      // withOrgContext: BEGIN + set_config + INSERT pipeline + 7 stages + COMMIT = 11
      expect(pool.query).toHaveBeenCalledTimes(11);
    });

    it('creates pipeline with custom name and description', async () => {
      const created = {
        id: '55555555-5555-5555-5555-555555555555',
        organization_id: TEST_ORG_ID,
        name: 'Custom Pipeline',
        description: 'For testing',
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // withOrgContext: BEGIN, set_config, then callback (UPDATE is_default, INSERT pipeline, 7 INSERT stage), then COMMIT
      pool.query.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 })); // BEGIN
      pool.query.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 })); // set_config
      pool.query.mockImplementationOnce(async () => ({})); // UPDATE is_default
      pool.query.mockImplementationOnce(async () => ({ rows: [created], rowCount: 1 })); // INSERT pipeline
      pool.query.mockResolvedValue(undefined); // 7 stage inserts + COMMIT

      const res = await request(app)
        .post('/api/pipeline')
        .set(authHeaders)
        .send({ name: 'Custom Pipeline', description: 'For testing', isDefault: true });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Custom Pipeline');
      expect(res.body.description).toBe('For testing');
      expect(res.body.is_default).toBe(true);
    });
  });
});
