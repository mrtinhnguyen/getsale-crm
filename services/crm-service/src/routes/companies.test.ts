import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockPool, createMockRabbitMQ } from '@getsale/test-utils';
import { createLogger } from '@getsale/logger';
import { companiesRouter } from './companies';

const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

const authHeaders = {
  'x-user-id': TEST_USER_ID,
  'x-organization-id': TEST_ORG_ID,
  'x-user-role': 'owner',
  'content-type': 'application/json',
};

describe('Companies Router', () => {
  let pool: ReturnType<typeof createMockPool>;
  let rabbitmq: ReturnType<typeof createMockRabbitMQ>;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = createMockPool();
    rabbitmq = createMockRabbitMQ();
    const log = createLogger('crm-service-test');
    const router = companiesRouter({ pool, rabbitmq, log });
    app = createTestApp(router, { prefix: '/api/crm/companies', log });
  });

  describe('GET /api/crm/companies', () => {
    it('returns companies for org', async () => {
      pool.setQueryResult({
        rows: [{ total: 0 }],
        rowCount: 1,
      });
      pool.query.mockImplementationOnce(async () => ({
        rows: [{ total: 0 }],
        rowCount: 1,
      }));
      pool.query.mockImplementationOnce(async () => ({
        rows: [],
        rowCount: 0,
      }));

      const res = await request(app)
        .get('/api/crm/companies')
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('returns paginated companies', async () => {
      const mockCompanies = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          organization_id: TEST_ORG_ID,
          name: 'Acme Corp',
          industry: 'Tech',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      pool.query.mockImplementationOnce(async () => ({
        rows: [{ total: 1 }],
        rowCount: 1,
      }));
      pool.query.mockImplementationOnce(async () => ({
        rows: mockCompanies,
        rowCount: 1,
      }));

      const res = await request(app)
        .get('/api/crm/companies?page=1&limit=10')
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Acme Corp');
      expect(res.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    });
  });

  describe('POST /api/crm/companies', () => {
    it('creates a company', async () => {
      const created = {
        id: '44444444-4444-4444-4444-444444444444',
        organization_id: TEST_ORG_ID,
        name: 'New Company',
        industry: 'Retail',
        size: null,
        description: null,
        goals: [],
        policies: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      pool.query.mockResolvedValueOnce({ rows: [created], rowCount: 1 });

      const res = await request(app)
        .post('/api/crm/companies')
        .set(authHeaders)
        .send({ name: 'New Company', industry: 'Retail' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Company');
      expect(res.body.industry).toBe('Retail');
      expect(rabbitmq.getPublishedEvents()).toHaveLength(1);
      expect(rabbitmq.getPublishedEvents()[0].event.type).toBe('company.created');
    });
  });

  describe('PUT /api/crm/companies/:id', () => {
    it('updates a company', async () => {
      const companyId = '55555555-5555-5555-5555-555555555555';
      const existing = {
        id: companyId,
        organization_id: TEST_ORG_ID,
        name: 'Old Name',
        industry: 'Tech',
        size: null,
        description: null,
        goals: [],
        policies: {},
      };
      const updated = {
        ...existing,
        name: 'Updated Name',
        updated_at: new Date().toISOString(),
      };
      pool.query.mockImplementationOnce(async () => ({ rows: [existing], rowCount: 1 }));
      pool.query.mockImplementationOnce(async () => ({ rows: [updated], rowCount: 1 }));

      const res = await request(app)
        .put(`/api/crm/companies/${companyId}`)
        .set(authHeaders)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Name');
      expect(rabbitmq.getPublishedEvents()).toHaveLength(1);
    });

    it('returns 404 when company not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request(app)
        .put('/api/crm/companies/55555555-5555-5555-5555-555555555555')
        .set(authHeaders)
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('DELETE /api/crm/companies/:id', () => {
    it('deletes a company', async () => {
      const companyId = '66666666-6666-6666-6666-666666666666';
      pool.query.mockImplementationOnce(async () => ({ rows: [{ id: companyId }], rowCount: 1 }));
      pool.query.mockImplementationOnce(async () => ({ rows: [{ c: 0 }], rowCount: 1 }));
      pool.query.mockResolvedValueOnce(undefined);
      pool.query.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .delete(`/api/crm/companies/${companyId}`)
        .set(authHeaders);

      expect(res.status).toBe(204);
    });

    it('returns 404 when company not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request(app)
        .delete('/api/crm/companies/66666666-6666-6666-6666-666666666666')
        .set(authHeaders);

      expect(res.status).toBe(404);
    });

    it('returns 409 when company has deals', async () => {
      const companyId = '66666666-6666-6666-6666-666666666666';
      pool.query.mockImplementationOnce(async () => ({ rows: [{ id: companyId }], rowCount: 1 }));
      pool.query.mockImplementationOnce(async () => ({ rows: [{ c: 3 }], rowCount: 1 }));

      const res = await request(app)
        .delete(`/api/crm/companies/${companyId}`)
        .set(authHeaders);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('deals');
    });
  });
});
