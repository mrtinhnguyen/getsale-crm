# Project Audit Report

**Date**: 2026-03-05
**Scope**: Full system — 13 microservices, frontend, shared packages, infrastructure
**Audited by**: senior-reviewer + security-auditor + reviewer
**Evaluation criteria**: Production SaaS readiness, 10k+ conversation scaling, long-term maintainability, AI-driven product evolution

---

## Executive Summary

**Overall Health Score: 0.0/10**

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 5           | 4        | 0            | **9** |
| High     | 5           | 6        | 5            | **16** |
| Medium   | 5           | 6        | 10           | **21** |
| Low      | 5           | 3        | 8            | **16** |

**Total findings: 62**

**Recommendation**: The system is NOT ready for production SaaS deployment. 9 critical issues require immediate remediation before any external user access. The combination of authentication bypass vectors (S1, S4), cross-tenant data corruption (S3), and infrastructure scaling limits (A1, A2) means the system cannot safely serve multiple tenants at any scale.

---

## Critical Issues (fix immediately)

### [A1] PostgreSQL Connection Pool Exhaustion — Single DB, 13 Services, No Pooler
**Category**: Architecture
**Location**: `shared/service-core/src/service-app.ts:109`, `docker-compose.yml`
**Impact**: 11 DB-connected services x 20 max connections = 220 potential connections. PostgreSQL default max_connections is 100. Under load, services will get `FATAL: too many connections` errors, causing cascading failures across the entire platform. The campaign-loop acquires a new connection per iteration in a batch of 20, making this worse.
**Fix**: Deploy PgBouncer in transaction-pooling mode between services and PostgreSQL. Reduce per-service pool max to 5-8 and set PgBouncer total max to 80-90. Long-term, evaluate per-service databases for messaging and analytics. Set PostgreSQL `max_connections = 300` as immediate safety net.

### [A2] API Gateway Token Verification is an HTTP Roundtrip per Request — No Caching
**Category**: Architecture
**Location**: `services/api-gateway/src/index.ts:83-139`
**Impact**: Every single authenticated API request triggers a synchronous HTTP `POST /api/auth/verify` to auth-service. At 10k active conversations generating ~100 req/s, auth-service becomes the bottleneck. If auth-service is slow or down, the entire platform hangs with a 10-30s timeout.
**Fix**: Switch to local JWT verification in the gateway using a shared secret or public key. Auth-service should only be called for token refresh/issuance. Use Node `cluster` module or deploy multiple gateway instances behind a load balancer.

### [A3] bd-accounts-service TelegramManager is Stateful — Cannot Horizontally Scale
**Category**: Architecture
**Location**: `services/bd-accounts-service/src/telegram-manager.ts:101-102`
**Impact**: All Telegram connections live in a single process's memory. Cannot run a second instance because accounts would connect twice, causing Telegram session conflicts. At 100+ BD accounts this becomes a single point of failure.
**Fix**: Implement a distributed lock (Redis SETNX) so each account is owned by exactly one instance. Store session state in Redis/PostgreSQL. On startup, each instance claims unclaimed accounts. On crash, accounts are re-claimed by survivors.

### [A4] RabbitMQ Consumer nack with Infinite Requeue — Poison Message Loop
**Category**: Architecture
**Location**: `shared/utils/src/rabbitmq.ts:121`
**Impact**: When a message handler throws, the message is requeued and immediately redelivered — creating an infinite retry loop. A single malformed event will spin at full CPU, blocking the consumer from processing any other messages. Only automation-service uses DLQ; all others have this vulnerability.
**Fix**: Add a retry counter via message headers. After N retries (e.g., 3), publish to a DLQ and ack the original message. Configure RabbitMQ dead-letter exchange at the queue level. Set `prefetch(1)` to prevent starvation.

### [A5] JWT Tokens Stored in localStorage — XSS Token Theft
**Category**: Architecture / Security
**Location**: `frontend/lib/stores/auth-store.ts:186`, `frontend/lib/api/client.ts:26`
**Impact**: Any XSS vulnerability (e.g., unsanitized user-generated content in messaging) allows an attacker to steal both access and refresh tokens via `localStorage.getItem('auth-storage')`. This gives full account takeover with token persistence.
**Fix**: Store tokens in httpOnly, Secure, SameSite=Strict cookies set by the auth-service. The frontend should never see the token.

### [S1] Hardcoded JWT Secret Fallbacks Allow Full Authentication Bypass
**Category**: Security
**Location**: `services/auth-service/src/helpers.ts:6-7`
**Impact**: JWT_SECRET falls back to `'dev_secret'` and JWT_REFRESH_SECRET to `'dev_refresh_secret'` when env vars are not set. Docker-compose uses predictable values. Anyone with source access can forge arbitrary JWTs, impersonating any user in any organization.
**OWASP**: A07:2021 - Identification and Authentication Failures
**Fix**: Remove fallback values entirely; crash the process on startup if JWT_SECRET/JWT_REFRESH_SECRET are unset. Rotate current secrets immediately if defaults were ever used in a deployed environment.

### [S2] Server-Side Request Forgery (SSRF) via /unfurl Endpoint
**Category**: Security
**Location**: `services/messaging-service/src/routes/messages.ts:585-637`, `services/messaging-service/src/helpers.ts:43`
**Impact**: The `/unfurl` endpoint accepts any URL and makes a server-side fetch. An attacker can probe internal services (`http://auth-service:3001/`), cloud metadata (`http://169.254.169.254/`), or Redis on the Docker network.
**OWASP**: A10:2021 - Server-Side Request Forgery
**Fix**: Implement a URL allowlist. Block RFC 1918 ranges, link-local, localhost, and internal Docker hostnames. Use DNS resolution check before fetching.

### [S3] Cross-Tenant Data Mutation via Missing organization_id Filters
**Category**: Security
**Location**: `services/crm-service/src/routes/companies.ts:138-145`, `contacts.ts:223`, `deals.ts:244-275`
**Impact**: When a user in Org A deletes a company, all contacts in EVERY organization that reference that company_id have their company_id nullified. Similarly for contacts and deals. Cross-tenant data corruption.
**OWASP**: A01:2021 - Broken Access Control
**Fix**: Add `AND organization_id = $N` to every cascading UPDATE/DELETE/SELECT. Enforce database-level RLS policies as defense-in-depth.

### [S4] Deprecated Pipeline Proxy Endpoint Bypasses Tenant Isolation
**Category**: Security
**Location**: `services/pipeline-service/src/routes/leads.ts:286-315`
**Impact**: The `PUT /clients/:clientId/stage` endpoint looks up a deal by ID without organization_id filter, extracts the organization_id from the deal itself, then makes an authenticated CRM call using that org's credentials. Any authenticated user can modify any organization's deals.
**OWASP**: A01:2021 - Broken Access Control
**Fix**: Delete this deprecated endpoint immediately.

---

## High Priority Issues (fix before production)

### [A6] WebSocket Room Subscription Has No Ownership Verification
**Category**: Architecture
**Location**: `services/websocket-service/src/index.ts:384-398`
**Impact**: Room patterns `bd-account:` and `chat:` are validated only by prefix — any authenticated user can subscribe to any BD account or chat regardless of ownership. Cross-tenant data leak.
**Fix**: On `subscribe`, verify the resource belongs to the user's organization by checking against database/Redis cache.

### [A7] No Graceful Shutdown in 11 of 13 Services
**Category**: Architecture
**Location**: All service `index.ts` files except `services/bd-accounts-service/src/index.ts`
**Impact**: On deployment, in-flight HTTP requests are dropped, database transactions left in limbo, RabbitMQ messages lost.
**Fix**: Add SIGTERM/SIGINT handlers to `createServiceApp` in `shared/service-core/src/service-app.ts`.

### [A8] CORS Defaults to `origin: '*'` in Production
**Category**: Architecture
**Location**: `services/api-gateway/src/index.ts:39`, `services/websocket-service/src/index.ts:25`
**Impact**: If `CORS_ORIGIN` env var is not set, any origin can make authenticated requests.
**Fix**: Remove the `|| '*'` fallback. Require `CORS_ORIGIN` in production. Fail startup if not provided when `NODE_ENV=production`.

### [A9] Single RabbitMQ Channel per Service — Head-of-Line Blocking
**Category**: Architecture
**Location**: `shared/utils/src/rabbitmq.ts:28`
**Impact**: One slow message blocks all others on the same channel. No prefetch set — unlimited unacked messages cause memory spikes.
**Fix**: Create separate channels for publishing and consuming. Set `channel.prefetch(10)` on consumer channels.

### [A10] automation-service Uses Raw `fetch` Instead of `ServiceHttpClient`
**Category**: Architecture
**Location**: `services/automation-service/src/event-handlers.ts:180-194, 486-514`
**Impact**: Bypasses standard retry, timeout, logging, and correlation-id propagation.
**Fix**: Inject ServiceHttpClient instances for crm-service and pipeline-service.

### [S5] Backend Services Have Zero Authentication — Trust Gateway Headers Blindly
**Category**: Security
**Location**: `shared/service-core/src/middleware.ts:42-55`
**Impact**: Every backend service reads X-User-Id, X-Organization-Id, X-User-Role headers without verification. Any compromised service or network-adjacent attacker can forge headers and impersonate any user.
**OWASP**: A07:2021 - Identification and Authentication Failures
**Fix**: Either have each service verify JWTs independently, or implement shared HMAC to sign forwarded headers, or enforce network policies so only the gateway can reach service ports.

### [S6] No Password Complexity Requirements — 1-Character Passwords Accepted
**Category**: Security
**Location**: `services/auth-service/src/routes/auth.ts:30`
**Impact**: Combined with no per-account brute-force protection, trivial credential stuffing.
**OWASP**: A07:2021 - Identification and Authentication Failures
**Fix**: Enforce minimum 8 characters with Zod validation on signup.

### [S7] Refresh Tokens Stored in Plaintext in Database
**Category**: Security
**Location**: `services/auth-service/src/routes/auth.ts:119-120, 143-144`
**Impact**: Database compromise exposes all refresh tokens — 7-day account takeover window.
**OWASP**: A02:2021 - Cryptographic Failures
**Fix**: Store SHA-256 hash of refresh token. Compare hashes during refresh flow.

### [S8] AI Draft Endpoints Missing Organization Ownership Verification
**Category**: Security
**Location**: `services/ai-service/src/routes/drafts.ts:82-106`
**Impact**: Any authenticated user can read and approve drafts belonging to other organizations, leaking AI-generated content and customer context.
**OWASP**: A01:2021 - Broken Access Control
**Fix**: Store organizationId in draft object and verify it matches `req.user.organizationId` before returning.

### [S9] Invite Link Creation Lacks Role-Based Permission Check
**Category**: Security
**Location**: `services/team-service/src/routes/invites.ts:86-100`
**Impact**: Any member (even viewer) can create invite links with `role: 'owner'`. Privilege escalation path.
**OWASP**: A01:2021 - Broken Access Control
**Fix**: Add permission check and restrict assignable roles to at-or-below requester's own role level.

### [S10] Unauthenticated Internal SLA Cron Endpoint
**Category**: Security
**Location**: `services/automation-service/src/routes/rules.ts:64-71`
**Impact**: Anyone with network access can trigger SLA automation runs for any organization.
**OWASP**: A01:2021 - Broken Access Control
**Fix**: Add `requireUser()` and `requireRole('admin', 'owner')`, or protect with internal API key.

### [Q1] Near-Zero Test Coverage Across 13 Services
**Category**: Code Quality
**Location**: Only 2 test files exist: `services/crm-service/src/routes/companies.test.ts`, `services/pipeline-service/src/routes/pipelines.test.ts`
**Impact**: 11 of 13 services have zero automated tests. Critical business logic (campaign sending, automation rules, SLA enforcement, messaging flows) is completely untested. The shared test-utils infrastructure is well-built but barely used.
**Fix**: Prioritize integration tests for: campaign-loop.ts, event-handlers.ts, messages.ts, conversations.ts. Target 70%+ coverage on critical routes.

### [Q2] messaging/page.tsx is 563 Lines with Inlined Business Logic
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/page.tsx:1-563`
**Impact**: Violates 300-line standard. Contains inline `apiClient.post()` calls, `alert()` for error handling, `console.error` for logging.
**Fix**: Extract modals into separate component files. Move inline API calls to `useMessagingActions`. Replace `alert()` with toast notifications.

### [Q3] useMessagingState Exposes 90+ Individual useState Variables
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingState.ts:1-254`
**Impact**: Every state change triggers a re-render of the entire messaging page tree. No grouping, memoization, or store optimization.
**Fix**: Split into domain-specific Zustand stores: useMessagingChatStore, useMessagingUIStore, useLeadPanelStore.

### [Q4] Duplicated Chat-Mapping Logic in fetchChats and useEffect
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:38-109, 225-277`
**Impact**: Same mapping/deduplication logic copy-pasted between callback and useEffect.
**Fix**: Extract `mapAndDeduplicateChats()` pure function in `utils.ts`.

### [Q5] Pervasive `any` Typing in Backend Route Files and Event Handlers
**Category**: Code Quality
**Location**: `services/messaging-service/src/routes/messages.ts`, `conversations.ts`, `services/automation-service/src/event-handlers.ts`, `services/campaign-service/src/campaign-loop.ts`, `services/bd-accounts-service/src/routes/sync.ts`
**Impact**: TypeScript safety defeated. Typos in property access produce `undefined` at runtime. Event handlers accept `event: any` and `rule: any` throughout.
**Fix**: Define typed interfaces. Use discriminated unions for event types. Extend `@getsale/events` package.

---

## Medium Priority Issues (plan for next sprint)

### [A11] No Data Access Layer — Raw SQL in Route Handlers
**Category**: Architecture
**Location**: All service `routes/*.ts` files
**Impact**: SQL scattered across 30+ route files. Schema changes require grep-and-fix across the entire codebase. Testing requires real DB. The conversations query has O(N*M) correlated subqueries.
**Fix**: Extract data access into per-entity repository modules. Denormalize unread_count, last_message_at onto conversations table.

### [A12] campaign-loop Holds DB Connections During External HTTP Calls and Sleep
**Category**: Architecture
**Location**: `services/campaign-service/src/campaign-loop.ts:50-246`
**Impact**: Holding 20 connections for minutes during delays and HTTP calls exhausts the pool.
**Fix**: Query batch, release connection, perform HTTP sends, then update results in new connection.

### [A13] No Event Versioning or Schema Registry
**Category**: Architecture
**Location**: `shared/events/src/index.ts`
**Impact**: No runtime validation, no version field. Schema changes require simultaneous deployment of all consumers.
**Fix**: Add `version` field to BaseEvent. Add Zod schemas for runtime validation at consumer boundary.

### [A14] WebSocket Service Connection Tracking is In-Memory
**Category**: Architecture
**Location**: `services/websocket-service/src/index.ts:273-278`
**Impact**: connectionCounts is a local Map — rate limiting and connection limits are per-instance only.
**Fix**: Move connection counts and rate limiting to Redis.

### [A15] Frontend: No Server-Side Rendering / Data Fetching
**Category**: Architecture
**Location**: All frontend pages use `'use client'`
**Impact**: Next.js used as SPA. Higher time-to-interactive, loading spinners on every navigation.
**Fix**: Add React Query/TanStack Query for caching, deduplication, and optimistic updates.

### [S11] Missing Security Headers (X-Frame-Options, CSP, HSTS, X-Content-Type-Options)
**Category**: Security
**Location**: `services/api-gateway/src/index.ts:38-48`
**Impact**: Clickjacking, content sniffing, protocol downgrade attacks possible.
**OWASP**: A05:2021 - Security Misconfiguration
**Fix**: Add `helmet` middleware.

### [S12] Proxy Error Responses Leak Internal Service Details
**Category**: Security
**Location**: `services/api-gateway/src/index.ts:191, 326`
**Impact**: Internal hostnames, connection details exposed to clients.
**OWASP**: A05:2021 - Security Misconfiguration
**Fix**: Remove `details` field from error responses. Log server-side only.

### [S13] Refresh Rate Limiting Uses In-Memory Map
**Category**: Security
**Location**: `services/auth-service/src/routes/auth.ts:22-23`
**Impact**: Ineffective in multi-instance deployment. Memory leak from unpruned entries.
**OWASP**: A04:2021 - Insecure Design
**Fix**: Move to Redis with TTL-based keys.

### [S14] No Per-Account Brute-Force Protection on Login
**Category**: Security
**Location**: `services/auth-service/src/routes/auth.ts:128-159`
**Impact**: Gateway's 100 req/min anonymous limit is far too high to prevent targeted credential brute-forcing.
**OWASP**: A07:2021 - Identification and Authentication Failures
**Fix**: Implement per-email rate limiting (5 failed attempts per 15 minutes) with exponential backoff.

### [S15] JWT Secrets Exported as Named Module Exports
**Category**: Security
**Location**: `services/auth-service/src/helpers.ts:11`
**Impact**: Raw secret values importable by any module. Supply chain attack vector.
**OWASP**: A02:2021 - Cryptographic Failures
**Fix**: Encapsulate secrets in sign/verify functions only. Do not export.

### [S16] Excessive console.log of User Data in API Gateway
**Category**: Security
**Location**: `services/api-gateway/src/index.ts:87,100,122,132`
**Impact**: Full user JSON (id, email, orgId, role) logged on every authenticated request via unstructured console.log.
**OWASP**: A09:2021 - Security Logging and Monitoring Failures
**Fix**: Use structured logger with PII redaction.

### [Q6] Duplicated parseCsvLine in Two Services
**Category**: Code Quality
**Location**: `services/crm-service/src/helpers.ts:54-71`, `services/campaign-service/src/helpers.ts:170-187`
**Impact**: Exact same CSV parsing function duplicated.
**Fix**: Move to `shared/utils/`.

### [Q7] organization_settings Query Duplicated 5 Times
**Category**: Code Quality
**Location**: `services/messaging-service/src/routes/conversations.ts:394,467,481,777`
**Impact**: Same query appears 5 times. Up to 2 executions per request.
**Fix**: Extract `getSharedChatSettings(pool, orgId)` helper.

### [Q8] Lead Context SQL Query (20-line JOIN) Repeated 3-4 Times
**Category**: Code Quality
**Location**: `services/messaging-service/src/routes/conversations.ts:112-252`
**Impact**: Nearly identical 20-line queries copy-pasted. Schema changes need 4 updates.
**Fix**: Create shared SQL builder helper or database view.

### [Q9] automation-service Raw fetch() Duplicates ServiceHttpClient Logic
**Category**: Code Quality
**Location**: `services/automation-service/src/event-handlers.ts:180-238`
**Impact**: Hand-rolled retry logic duplicates ServiceHttpClient without correlation-id forwarding.
**Fix**: Replace with ServiceHttpClient instances.

### [Q10] ServiceCallError Handling Duplicated in Every AI Endpoint
**Category**: Code Quality
**Location**: `services/messaging-service/src/routes/conversations.ts:311-322, 376-387`
**Impact**: Same catch block copy-pasted 4+ times.
**Fix**: Extract `handleServiceCallError()` helper.

### [Q11] Frontend Uses console.error + alert() Instead of Toast System
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/page.tsx`, `hooks/useMessagingActions.ts`
**Impact**: `alert()` blocks UI. `console.error` invisible to users. Violates frontend standards.
**Fix**: Implement toast notification system (react-hot-toast or sonner).

### [Q12] MockPool Doesn't Support Per-Query Result Mapping
**Category**: Code Quality
**Location**: `shared/test-utils/src/mock-pool.ts:18-47`
**Impact**: Tests use `mockImplementationOnce` chains — brittle and order-dependent.
**Fix**: Add `whenQuery(pattern, result)` method to MockPool.

### [Q13] campaign-loop.ts — 271-Line Single Function with Deep Nesting
**Category**: Code Quality
**Location**: `services/campaign-service/src/campaign-loop.ts:25-271`
**Impact**: Cyclomatic complexity >20. Extremely difficult to test or debug in isolation.
**Fix**: Break into focused functions: `checkRateLimits()`, `evaluateAndSend()`, `advanceParticipant()`, `completeCampaign()`.

### [Q14] No Alert Rules for DB Pool, RabbitMQ Disconnection, Campaign Failures
**Category**: Code Quality
**Location**: `infrastructure/prometheus/alert_rules.yml:1-80`
**Impact**: Critical operational scenarios unmonitored: DB pool saturation, RabbitMQ disconnection, campaign failures, DLQ growth, cron not running.
**Fix**: Add alerts for `automation_failed_total`, `automation_dlq_total`, pg_pool idle, cron dead-man's-switch.

### [Q15] createTask Action Handler is a No-Op Stub in Production
**Category**: Code Quality
**Location**: `services/automation-service/src/event-handlers.ts:534-536`
**Impact**: Users believe automation works but `create_task` silently does nothing.
**Fix**: Either implement task creation or throw `AppError(501, 'Task creation not yet implemented')`.

---

## Low Priority / Suggestions

### [A16] API Gateway Has Massive Code Duplication in Proxy Config
**Category**: Architecture
**Location**: `services/api-gateway/src/index.ts:171-427`
**Impact**: 11 near-identical proxy blocks. Adding new service requires copying 25 lines.
**Fix**: Extract `createAuthenticatedProxy()` factory function with declarative config.

### [A17] RabbitMQ Client and API Gateway Use console.log Instead of Structured Logger
**Category**: Architecture
**Location**: `shared/utils/src/rabbitmq.ts`, `services/api-gateway/src/index.ts`, `services/websocket-service/src/index.ts`
**Impact**: Unstructured logs without correlation IDs. Production debugging significantly harder.
**Fix**: Use `@getsale/service-core` logger in all services.

### [A18] Over-decomposition: 13 Microservices for Early-Stage SaaS
**Category**: Architecture
**Location**: All `services/` directories
**Impact**: 13 deployment units create operational overhead. Several services have thin logic.
**Fix**: Consider consolidating: merge team+user into identity-service, analytics into crm-service.

### [A19] Duplicate Auth Token Refresh Interceptors
**Category**: Architecture
**Location**: `frontend/lib/stores/auth-store.ts:242-307`, `frontend/lib/api/client.ts:44-90`
**Impact**: Two independent refresh interceptors can race, causing double refresh requests.
**Fix**: Remove global axios interceptor. Use only apiClient for all API calls.

### [A20] @ts-nocheck in telegram-manager.ts (3800+ lines)
**Category**: Architecture
**Location**: `services/bd-accounts-service/src/telegram-manager.ts:1`
**Impact**: Largest file in the system has TypeScript disabled. Type errors not caught at compile time.
**Fix**: Remove @ts-nocheck. Split into: TelegramConnectionPool, TelegramMessageHandler, TelegramSyncEngine, TelegramAuthFlow.

### [S17] 2GB Base64 File Acceptance Risks Memory Exhaustion (DoS)
**Category**: Security
**Location**: `services/messaging-service/src/routes/messages.ts:244-252`
**Impact**: 2GB base64 string in JSON body causes OOM.
**Fix**: Set `express.json({ limit: '50mb' })`. Use multipart upload for larger files.

### [S18] Stripe Webhook Signature Verification Not Implemented
**Category**: Security
**Location**: `services/user-service/src/routes/subscription.ts`
**Impact**: Subscription lifecycle events cannot be securely received.
**Fix**: Implement webhook endpoint with `stripe.webhooks.constructEvent()`.

### [S19] Ownership Transfer Does Not Invalidate Existing Sessions
**Category**: Security
**Location**: `services/auth-service/src/routes/organization.ts:63-88`
**Impact**: Former owner retains owner privileges for up to 15 minutes.
**Fix**: Invalidate/revoke all access tokens on role changes.

### [Q16] useMessagingData Has Duplicate useEffect — Chats Loaded via Two Code Paths
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:38-109, 225-277`
**Impact**: Initial load and refresh use different code paths with copied logic.
**Fix**: Consolidate to use `fetchChats` callback in the useEffect.

### [Q17] Hardcoded Russian Strings in JSX Despite i18n Setup
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/page.tsx:195, 375, 387-388`
**Impact**: Breaks internationalization for non-Russian users.
**Fix**: Move strings to `locales/ru.json` and `locales/en.json`, use `t()` keys.

### [Q18] SLA Cron Only Processes LIMIT 1 Breach Per Run
**Category**: Code Quality
**Location**: `services/automation-service/src/sla-cron.ts:36-43, 74`
**Impact**: With hourly runs, 100 breaching leads across 5 rules takes 100+ hours to process.
**Fix**: Remove `LIMIT 1`. Add batch processing.

### [Q19] Logger Lacks Log Level Control and Sampling
**Category**: Code Quality
**Location**: `shared/logger/src/index.ts:1-41`
**Impact**: No `LOG_LEVEL` env support. All logs written unconditionally. Enormous volumes at scale.
**Fix**: Add `LOG_LEVEL` env support. Filter in production.

### [Q20] executeRule Uses Different INSERT Schema Than processLeadStageChanged
**Category**: Code Quality
**Location**: `services/automation-service/src/event-handlers.ts:445-455 vs 262-268`
**Impact**: Two different column sets for same table. Runtime SQL errors or missing data.
**Fix**: Standardize INSERT schema for `automation_executions`.

### [Q21] No Prometheus Metrics in campaign-loop.ts
**Category**: Code Quality
**Location**: `services/campaign-service/src/campaign-loop.ts`
**Impact**: Campaign execution is a monitoring blind spot.
**Fix**: Add `campaign_messages_sent_total`, `campaign_send_failed_total` counters.

### [Q22] useMessagingData Has 9 useEffect Hooks with Missing Dependencies
**Category**: Code Quality
**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:178-457`
**Impact**: Stale closures and fragile ref workarounds.
**Fix**: Use `useCallback` with proper deps. Consider react-query for data fetching.

### [Q23] buildLeadContextPayload Accepts row: any
**Category**: Code Quality
**Location**: `services/messaging-service/src/routes/conversations.ts:769`
**Impact**: No compile-time type safety for complex 20-column query results.
**Fix**: Define `LeadContextRow` interface.

---

## Priority Matrix

| ID | Issue | Severity | Effort | Priority |
|----|-------|----------|--------|----------|
| S1 | Hardcoded JWT secret fallbacks | Critical | Low | P0 — now |
| S4 | Deprecated endpoint bypasses tenant isolation | Critical | Low | P0 — now |
| S3 | Cross-tenant data mutation (missing org_id) | Critical | Medium | P0 — now |
| S2 | SSRF via /unfurl | Critical | Low | P0 — now |
| A2 | Gateway auth HTTP roundtrip per request | Critical | Medium | P0 — now |
| A1 | PostgreSQL connection pool exhaustion | Critical | Medium | P0 — now |
| A4 | RabbitMQ poison message loop | Critical | Medium | P0 — now |
| A5 | JWT in localStorage | Critical | High | P0 — sprint |
| A3 | TelegramManager stateful | Critical | High | P0 — sprint |
| S5 | Backend trusts gateway headers blindly | High | Medium | P1 — sprint |
| S9 | Invite link role escalation | High | Low | P1 — sprint |
| S6 | No password complexity | High | Low | P1 — sprint |
| S7 | Refresh tokens plaintext | High | Medium | P1 — sprint |
| S8 | AI drafts org check missing | High | Low | P1 — sprint |
| S10 | Unauthenticated SLA cron endpoint | High | Low | P1 — sprint |
| A6 | WS room no ownership check | High | Medium | P1 — sprint |
| A7 | No graceful shutdown (11 services) | High | Medium | P1 — sprint |
| A8 | CORS defaults to '*' | High | Low | P1 — sprint |
| A9 | Single RabbitMQ channel blocking | High | Medium | P1 — sprint |
| A10 | automation-service raw fetch | High | Low | P1 — sprint |
| Q1 | Near-zero test coverage | High | High | P1 — sprint |
| Q2 | messaging page 563 lines | High | Medium | P1 — sprint |
| Q3 | 90+ useState variables | High | Medium | P1 — sprint |
| Q4 | Duplicated chat mapping logic | High | Low | P1 — sprint |
| Q5 | Pervasive any typing | High | High | P1 — ongoing |
| A11 | No data access layer | Medium | High | P2 — next sprint |
| A12 | campaign-loop holds DB connections | Medium | Medium | P2 — next sprint |
| A13 | No event versioning | Medium | Medium | P2 — next sprint |
| A14 | WS connection tracking in-memory | Medium | Low | P2 — next sprint |
| A15 | No SSR / data fetching | Medium | High | P2 — backlog |
| S11 | Missing security headers | Medium | Low | P2 — next sprint |
| S12 | Proxy error leaks internals | Medium | Low | P2 — next sprint |
| S13 | Refresh rate limiting in-memory | Medium | Low | P2 — next sprint |
| S14 | No brute-force protection | Medium | Medium | P2 — next sprint |
| S15 | JWT secrets exported | Medium | Low | P2 — next sprint |
| S16 | Excessive PII logging | Medium | Low | P2 — next sprint |
| Q6 | Duplicated parseCsvLine | Medium | Low | P2 — next sprint |
| Q7 | org_settings query x5 | Medium | Low | P2 — next sprint |
| Q8 | Lead context query x4 | Medium | Low | P2 — next sprint |
| Q9 | automation raw fetch duplicates | Medium | Low | P2 — next sprint |
| Q10 | ServiceCallError handling duplicated | Medium | Low | P2 — next sprint |
| Q11 | alert() instead of toast | Medium | Medium | P2 — next sprint |
| Q12 | MockPool query mapping | Medium | Medium | P2 — next sprint |
| Q13 | campaign-loop 271-line function | Medium | Medium | P2 — next sprint |
| Q14 | Missing alert rules | Medium | Medium | P2 — next sprint |
| Q15 | createTask is no-op stub | Medium | Low | P2 — next sprint |
| A16 | Gateway proxy config duplication | Low | Medium | P3 — backlog |
| A17 | console.log in rabbitmq/gateway/ws | Low | Low | P3 — backlog |
| A18 | Over-decomposition 13 services | Low | High | P3 — backlog |
| A19 | Duplicate refresh interceptors | Low | Low | P3 — backlog |
| A20 | @ts-nocheck in 3800-line file | Low | High | P3 — backlog |
| S17 | 2GB base64 DoS | Low | Low | P3 — backlog |
| S18 | No Stripe webhook verification | Low | Medium | P3 — backlog |
| S19 | Session invalidation on role change | Low | Medium | P3 — backlog |
| Q16 | Duplicate useEffect for chats | Low | Low | P3 — backlog |
| Q17 | Hardcoded Russian strings | Low | Low | P3 — backlog |
| Q18 | SLA cron LIMIT 1 | Low | Low | P3 — backlog |
| Q19 | Logger no log levels | Low | Low | P3 — backlog |
| Q20 | executeRule INSERT schema mismatch | Low | Low | P3 — backlog |
| Q21 | No campaign metrics | Low | Low | P3 — backlog |
| Q22 | useEffect missing dependencies | Low | Medium | P3 — backlog |
| Q23 | buildLeadContextPayload any type | Low | Low | P3 — backlog |

---

## Scalability Assessment for 10k+ Conversations

### Current capacity estimate: ~500 concurrent conversations

**Bottlenecks (in order of impact):**

1. **PostgreSQL connections** — 100 default max_connections, 220 service pool total = immediate failure under load
2. **Gateway auth roundtrip** — ~10ms per request x 100 req/s = 1 full second of latency budget consumed
3. **Single-process API gateway** — no clustering, no multi-instance
4. **TelegramManager in-memory state** — cannot scale horizontally for BD accounts
5. **RabbitMQ single-channel** — head-of-line blocking limits event throughput
6. **No query optimization** — conversation list uses O(N*M) correlated subqueries

### To reach 10k+ conversations:

1. **Deploy PgBouncer** — handles 10x more connections with connection reuse
2. **Local JWT verification** — eliminates ~50% of auth-service load
3. **Gateway clustering / multi-instance** — horizontal scaling for HTTP traffic
4. **Denormalize conversation metadata** — eliminate correlated subqueries on messages table
5. **TelegramManager distributed ownership** — enable multiple bd-accounts instances
6. **Separate RabbitMQ channels** — eliminate head-of-line blocking
7. **Redis caching** — cache frequently accessed data (conversation lists, contact info)
8. **Read replicas** — route analytics and read-heavy queries to PostgreSQL replicas

---

## AI Integration Evolution Recommendations

### Current state

- OpenAI GPT-4o for drafts, analysis, summarization
- Redis-backed per-org rate limiting (200/hour)
- Event-driven draft generation on MESSAGE_RECEIVED
- Prompt versioning (1.0.0) but no A/B testing framework

### Recommendations for AI-driven product evolution

1. **Multi-model strategy**: Add fallback to GPT-4o-mini for non-critical operations. Use streaming for real-time draft generation. Consider self-hosted models for cost optimization at scale.
2. **Prompt management**: Store prompts in database for per-org customization. Add A/B testing framework for prompt variants. Track prompt performance metrics.
3. **Context window optimization**: Current conversation analysis sends full message history. Implement sliding window + summarization for long conversations to control token costs.
4. **AI cost tracking**: Track token usage per org for usage-based billing. Current rate limiter counts requests, not tokens. Add per-request token counting via OpenAI response headers.
5. **Embedding-based features**: Add vector search (pgvector) for similar conversations, customer context enrichment, smart lead scoring, and semantic search across all conversations.
6. **AI observability**: Add latency, token usage, and error rate metrics per model/prompt. Currently no AI-specific Prometheus metrics beyond rate limit hits.
7. **Real-time AI features**: Implement streaming responses for chat assistant. Add real-time sentiment analysis during conversations. Auto-suggest next best actions based on conversation context.

---

## Production SaaS Readiness Checklist

| Requirement | Status | Blocking Issues |
|-------------|--------|-----------------|
| Multi-tenant data isolation | FAIL | S3, S4, S8, A6 |
| Authentication security | FAIL | S1, A5, S5, S6, S7 |
| Authorization / RBAC | FAIL | S9, S10, A6 |
| Input validation | FAIL | S2, S17 |
| Horizontal scalability | FAIL | A1, A2, A3 |
| High availability | FAIL | A7, A4, A9 |
| Monitoring and alerting | PARTIAL | Q14, Q19, Q21 |
| Test coverage | FAIL | Q1 |
| Data encryption at rest | FAIL | Not implemented |
| Security headers | FAIL | S11 |
| Rate limiting | PARTIAL | S13, S14 |
| Graceful degradation | FAIL | A7, A4 |
| Backup and recovery | UNKNOWN | Not assessed |
| GDPR / data privacy | FAIL | No data deletion, no export |

---

## Next Steps

### 1. Immediate (before any external access)

- **[S1]** Remove JWT secret fallbacks — crash if unset
- **[S4]** Delete deprecated pipeline endpoint
- **[S3]** Add organization_id filters to all cascading operations
- **[S2]** Block internal URLs in /unfurl endpoint
- **[A2]** Switch to local JWT verification in gateway
- **[A1]** Deploy PgBouncer, set max_connections = 300

### 2. This sprint (before beta users)

- **[A4]** Fix RabbitMQ poison message loop with retry + DLQ
- **[A7]** Add graceful shutdown to all services via service-core
- **[S5]** Add internal auth between gateway and services
- **[S6]** Add password complexity requirements
- **[S7]** Hash refresh tokens in database
- **[S8]** Add org check to AI draft endpoints
- **[S9]** Add permission check to invite link creation
- **[S10]** Secure SLA cron endpoint
- **[A8]** Remove CORS wildcard fallback
- **[Q1]** Write tests for critical business logic paths

### 3. Next sprint (before production launch)

- **[A5]** Move tokens to httpOnly cookies
- **[A3]** Implement distributed TelegramManager
- **[A6]** Add WebSocket room ownership verification
- **[A9]** Separate RabbitMQ channels for pub/sub
- **[S11]** Add security headers via helmet
- **[S14]** Add per-account brute-force protection
- **[Q2-Q5]** Frontend refactoring and type safety improvements
- **[A11]** Begin extracting data access layers

### 4. Backlog (continuous improvement)

- All medium and low findings
- Test coverage expansion to 70%+ on critical paths
- Service consolidation evaluation (A18)
- React Query migration (A15)
- AI integration evolution
- Data encryption at rest
- GDPR compliance (data deletion, export)

---

Use `/refactor [file]` for structural issues.
Use `/implement [fix]` for feature-level security fixes.
Use `/orchestrate` for larger remediation plans.
