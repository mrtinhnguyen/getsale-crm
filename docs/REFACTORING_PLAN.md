# GetSale CRM — Refactoring Plan

> Generated from full system audit. Track progress here.

## Principles

1. **One pattern, everywhere.** No "this service does it differently."
2. **Shared infrastructure first.** Build once in `shared/`, use in all services.
3. **Refactor by replacement.** Don't patch — rewrite to the new standard.
4. **Each service ≤ 400 lines per file.** Split into routes, handlers, middleware.
5. **Each component ≤ 300 lines.** Extract hooks, sub-components, utils.
6. **No `console.log` in services.** Use `@getsale/logger` everywhere.
7. **Validate all inputs.** Zod schemas for every endpoint.
8. **Test critical paths.** Integration tests for lead→deal, message send, campaign.

---

## Phase 1A — Shared Service Infrastructure ✅

> Build `shared/service-core` — the standard foundation for every backend service.

| # | Task | Status |
|---|------|--------|
| 1 | Create `shared/service-core` package | ✅ |
| 2 | Move `AppError` + `ErrorCodes` from crm-service to shared | ✅ |
| 3 | Add `getUser()` middleware (extract from headers, validate) | ✅ |
| 4 | Add `correlationId()` middleware | ✅ |
| 5 | Add `validate(schema)` Zod middleware | ✅ |
| 6 | Add `canPermission()` shared RBAC helper | ✅ |
| 7 | Add `errorHandler()` global Express error handler | ✅ |
| 8 | Add `createPool()` standardized PG pool factory | ✅ |
| 9 | Add `createServiceApp()` factory (sets up express + all middleware) | ✅ |
| 10 | Add `ServiceHttpClient` for service-to-service calls (timeout, retry) | ✅ |
| 11 | Add `requestLogger()` middleware (structured, with correlation) | ✅ |
| 12 | Add standard `/health` and `/metrics` setup | ✅ |

## Phase 1B — Refactor All Backend Services ✅

> Adopt `shared/service-core` in every service. Split large index.ts files.

| # | Service | Lines | Split Into | Status |
|---|---------|-------|------------|--------|
| 1 | crm-service | ~1600 | routes/companies, contacts, deals, notes, reminders, analytics | ✅ |
| 2 | messaging-service | ~2080 | routes/messages, chats, conversations + helpers, event-handlers | ✅ |
| 3 | pipeline-service | ~830 | routes/pipelines, stages, leads | ✅ |
| 4 | auth-service | ~880 | routes/auth, organization, workspaces, invites + helpers | ✅ |
| 5 | campaign-service | ~1930 | routes/campaigns, templates, sequences, execution, participants + helpers, event-handlers, campaign-loop | ✅ |
| 6 | automation-service | ~650 | routes/rules + event-handlers, sla-cron, validation | ✅ |
| 7 | bd-accounts-service | ~1730 | routes/accounts, auth, sync, messaging, media + helpers | ✅ |
| 8 | ai-service | ~360 | routes/drafts, analyze, usage + prompts, rate-limiter | ✅ |
| 9 | analytics-service | ~260 | routes/analytics | ✅ |
| 10 | team-service | ~420 | routes/members, invites, clients + helpers | ✅ |
| 11 | user-service | ~230 | routes/profiles, subscription, team | ✅ |
| 12 | websocket-service | ~300 | keep as-is (already focused) | ✅ |
| 13 | api-gateway | ~300 | keep as-is | ✅ |

## Phase 2 — Messaging Page Decomposition ✅

> Break 4650-line `messaging/page.tsx` into focused modules. Reduced to 532 lines (89% reduction).

| # | Task | Status |
|---|------|--------|
| 1 | Extract `types.ts` (interfaces, types, constants) | ✅ |
| 2 | Extract `utils.ts` (pure helper functions) | ✅ |
| 3 | Extract `hooks/useMessagingState.ts` (all useState + refs) | ✅ |
| 4 | Extract `hooks/useMessagingData.ts` (data fetching + effects) | ✅ |
| 5 | Extract `hooks/useMessagingWebSocket.ts` (WS event handlers) | ✅ |
| 6 | Extract `hooks/useMessagingActions.ts` (handlers + computed) | ✅ |
| 7 | Extract `components/messaging/AccountList.tsx` | ✅ |
| 8 | Extract `components/messaging/ChatList.tsx` | ✅ |
| 9 | Extract `components/messaging/MessageBubble.tsx` | ✅ |
| 10 | Extract `components/messaging/MessageContent.tsx` | ✅ |
| 11 | Extract `components/messaging/BroadcastToGroupsModal.tsx` | ✅ |
| 12 | Extract `components/messaging/ForwardMessageModal.tsx` | ✅ |
| 13 | Extract `components/messaging/ChatAvatar.tsx` + `BDAccountAvatar.tsx` | ✅ |
| 14 | Extract `components/messaging/DownloadLink.tsx` | ✅ |
| 15 | Reduce `page.tsx` to composition (532 lines, from 4649) | ✅ |

## Phase 3 — Frontend Entity Stores & API Layer ✅

| # | Task | Status |
|---|------|--------|
| 1 | Create `stores/contacts-store.ts` (Zustand, normalized cache) | ✅ |
| 2 | Create `stores/companies-store.ts` | ✅ |
| 3 | Create `stores/deals-store.ts` | ✅ |
| 4 | Create `stores/leads-store.ts` | ✅ |
| 5 | Create `stores/pipelines-store.ts` | ✅ |
| 6 | Refactor CRM page to use entity stores | ⬜ (follow-up) |
| 7 | Refactor Pipeline page to use entity stores | ⬜ (follow-up) |
| 8 | Add React.memo to all list item components | ✅ (done in Phase 2) |
| 9 | Add proper error boundaries per section | ⬜ (follow-up) |

## Phase 4 — Test Infrastructure ✅

| # | Task | Status |
|---|------|--------|
| 1 | Add Vitest to root package.json | ✅ |
| 2 | Create test utils (mock DB, mock RabbitMQ, mock Redis) | ✅ |
| 3 | Integration tests: crm-service (company CRUD, 8 tests) | ✅ |
| 4 | Integration tests: pipeline-service (pipeline CRUD, 4 tests) | ✅ |
| 5 | Integration tests: messaging-service | ⬜ (follow-up) |
| 6 | Integration tests: automation-service | ⬜ (follow-up) |
| 7 | E2E test: lead → deal conversion flow | ⬜ (follow-up) |
| 8 | Add test step to CI pipeline | ⬜ (follow-up) |

## Phase 5 — Observability ✅

| # | Task | Status |
|---|------|--------|
| 1 | Replace all `console.log/error/warn` with `@getsale/logger` | ✅ (Phase 1B) |
| 2 | Add request duration logging to all services | ✅ (service-core) |
| 3 | Add Prometheus histograms to all services | ✅ (service-core) |
| 4 | Create Grafana dashboard JSON | ✅ |
| 5 | Add Prometheus alerting rules (5xx, latency p95/p99, service down) | ✅ |
| 6 | Add health check dependency status (DB, Redis, RabbitMQ) | ✅ (service-core) |
| 7 | Prometheus config: scrape all 13 services | ✅ |

## Phase 6 — AI Service Refactor ✅

| # | Task | Status |
|---|------|--------|
| 1 | Add per-org AI usage tracking (Redis counter + hourly window) | ✅ |
| 2 | Add rate limiter: configurable max per org per hour | ✅ |
| 3 | Switch to OpenAI JSON mode (`response_format: { type: "json_object" }`) | ✅ |
| 4 | Extract prompts to `src/prompts/` with version constants | ✅ |
| 5 | Add model config via env vars (AI_MODEL_DRAFT, etc.) | ✅ |
| 6 | Fix `organizationId: ''` in AI draft events | ✅ |
| 7 | Add AI usage endpoint (`GET /api/ai/usage`) | ✅ |
| 8 | Add fallback chain (gpt-4o → gpt-4o-mini on failure) | ⬜ (follow-up) |

## Phase 7 — Database Fixes ✅

| # | Task | Status |
|---|------|--------|
| 1 | Index: messages(org_id, bd_account_id, channel_id) | ✅ |
| 2 | Index: messages(org_id, channel, channel_id, date DESC) | ✅ |
| 3 | Index: notes(entity_type, entity_id) | ✅ |
| 4 | Index: reminders(entity_type, entity_id) | ✅ |
| 5 | Index: leads(org_id, pipeline_id, stage_id, order_index) | ✅ |
| 6 | Index: contacts(org_id, created_at DESC) | ✅ |
| 7 | Index: deals(org_id, pipeline_id, stage_id) | ✅ |
| 8 | Index: conversations(org_id, bd_account_id, channel, channel_id) | ✅ |
| 9 | Index: campaign_participants(campaign_id, status, next_send_at) | ✅ |
| 10 | Index: lead_activity_log(lead_id, created_at DESC) | ✅ |
| 11 | Normalize timestamps to `timestamptz` | ⬜ (follow-up) |
| 12 | Add `deleted_at` soft delete columns | ⬜ (follow-up) |
| 13 | Add PgBouncer to docker-compose | ⬜ (follow-up) |

---

## Progress

- **Started:** 2026-03-04
- **Phase 1A:** ✅ `shared/service-core` — AppError, middleware, ServiceHttpClient, createServiceApp
- **Phase 1B:** ✅ All 13 services refactored (11 rewritten, 2 kept as-is)
- **Phase 2:** ✅ Messaging page decomposed (4649 → 532 lines, 16 focused modules)
- **Phase 3:** ✅ 5 Zustand entity stores created (contacts, companies, deals, leads, pipelines)
- **Phase 4:** ✅ Vitest + test-utils + 12 integration tests
- **Phase 5:** ✅ Prometheus (13 services), Grafana dashboard, 7 alerting rules
- **Phase 6:** ✅ AI rate limiter, structured outputs, prompt versioning, usage tracking
- **Phase 7:** ✅ 10 performance indexes migration (CONCURRENTLY)
- **ALL 7 PHASES COMPLETE** — Follow-up items tracked in each phase table above
