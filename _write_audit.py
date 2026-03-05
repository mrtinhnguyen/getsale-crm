import os

content = r"""# Project Audit Report

**Date**: 2026-03-05
**Scope**: Full system — 13 microservices, frontend, shared packages, infrastructure
**Audited by**: senior-reviewer + security-auditor + reviewer
**Evaluation criteria**: Production SaaS readiness, 10k+ conversation scaling, long-term maintainability, AI-driven product evolution

---

## Executive Summary

**Overall Health Score**: 0.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 5           | 4        | 0            | **9** |
| High     | 5           | 6        | 5            | **16** |
| Medium   | 5           | 6        | 10           | **21** |
| Low      | 5           | 3        | 8            | **16** |

**Total findings: 62**

**Health Score Calculation:**
- Start: 10
- Critical: min(9 × 2, 6) = −6
- High: min(16 × 0.5, 3) = −3
- Medium: min(21 × 0.1, 1) = −1
- Score: 10 − 6 − 3 − 1 = **0.0/10**

**Recommendation**: The system is NOT ready for production SaaS deployment. 9 critical issues require immediate remediation before any external user access. The combination of authentication bypass vectors (S1, S4), cross-tenant data corruption (S3), and infrastructure scaling limits (A1, A2) means the system cannot safely serve multiple tenants at any scale.

### System Overview

GetSale CRM is an event-driven microservices platform:
- 13 backend services behind an Express-based API Gateway
- Next.js 14 frontend with Zustand, Socket.IO, Tailwind
- Single shared PostgreSQL database, multi-tenant by `organization_id`
- RabbitMQ topic exchange for async events
- Redis for caching, rate limiting, Socket.IO adapter
- OpenAI integration for drafts, analysis, summarization
- Telegram integration via GramJS for BD accounts

---

## Critical Issues (fix immediately)

### [A1] PostgreSQL Connection Pool Exhaustion — Single DB, 13 Services, No Pooler

**Severity**: Critical | **Category**: Architecture

**Location**: `shared/service-core/src/service-app.ts:109`, `docker-compose.yml`

**Impact**: 11 DB-connected services × 20 max connections = 220 potential connections. PostgreSQL default `max_connections` is 100. Under load, services will get `FATAL: too many connections` errors, causing cascading failures across all services.

**Recommendation**: Deploy PgBouncer in transaction-pooling mode. Reduce per-service pool max to 5–8. Set PostgreSQL `max_connections = 300` as an immediate safety net. Long-term, evaluate per-service databases for messaging and analytics.

---

### [A2] API Gateway Token Verification is an HTTP Roundtrip per Request — No Caching

**Severity**: Critical | **Category**: Architecture

**Location**: `services/api-gateway/src/index.ts:83-139`

**Impact**: Every authenticated request triggers a synchronous HTTP `POST /api/auth/verify`. At 10k+ conversations (~100 req/s), auth-service becomes the bottleneck. If auth-service is down, the entire platform hangs — complete system unavailability.

**Recommendation**: Switch to local JWT verification in the gateway using shared secret or public key. Use Node cluster module or deploy multiple gateway instances behind a load balancer.

---

### [A3] bd-accounts-service TelegramManager is Stateful — Cannot Horizontally Scale

**Severity**: Critical | **Category**: Architecture

**Location**: `services/bd-accounts-service/src/telegram-manager.ts:101-102`

**Impact**: All Telegram connections live in a single process's memory. Cannot run a second instance (session conflicts). At 100+ BD accounts, single point of failure with no failover path.

**Recommendation**: Implement distributed lock (Redis `SETNX`) for account ownership. Store session state in Redis/PostgreSQL. Enable horizontal scaling with account claiming protocol.

---

### [A4] RabbitMQ Consumer nack with Infinite Requeue — Poison Message Loop

**Severity**: Critical | **Category**: Architecture

**Location**: `shared/utils/src/rabbitmq.ts:121`

**Impact**: Failed messages requeue infinitely, creating CPU-spinning loops that block all message processing. Only automation-service uses DLQ. A single malformed event can bring down an entire service's message consumption.

**Recommendation**: Add retry counter via message headers (`x-retry-count`). After N retries, publish to DLQ and ack. Configure dead-letter exchange at queue level. Set `prefetch(1)`.

---

### [A5] JWT Tokens Stored in localStorage — XSS Token Theft

**Severity**: Critical | **Category**: Architecture

**Location**: `frontend/lib/stores/auth-store.ts:186`, `frontend/lib/api/client.ts:26`

**Impact**: Any XSS vulnerability allows stealing access and refresh tokens for full account takeover. localStorage is accessible to all JavaScript on the page including injected scripts.

**Recommendation**: Store tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies set by auth-service. Remove all `localStorage.getItem('token')` patterns from frontend.

---

### [S1] Hardcoded JWT Secret Fallbacks Allow Full Authentication Bypass

**Severity**: Critical | **Category**: Security | **OWASP**: A07:2021 - Identification and Authentication Failures

**Location**: `services/auth-service/src/helpers.ts:6-7`

**Impact**: `JWT_SECRET` falls back to `'dev_secret'`. Anyone with source code access (or who guesses the default) can forge arbitrary JWTs for any user in any organization — complete authentication bypass.

**Recommendation**: Remove fallback values. Crash on startup if `JWT_SECRET` / `JWT_REFRESH_SECRET` are unset. Add startup validation in service-app.ts.

---

### [S2] Server-Side Request Forgery (SSRF) via /unfurl Endpoint

**Severity**: Critical | **Category**: Security | **OWASP**: A10:2021 - Server-Side Request Forgery

**Location**: `services/messaging-service/src/routes/messages.ts:585-637`

**Impact**: Attacker can probe internal services, cloud metadata endpoint (`169.254.169.254`), Redis on Docker network, and any internal hostname. Can be used for internal network reconnaissance and data exfiltration.

**Recommendation**: Implement URL allowlist. Block RFC 1918 ranges, link-local addresses, localhost, and internal Docker hostnames. Validate resolved IP before making the request.

---

### [S3] Cross-Tenant Data Mutation via Missing organization_id Filters

**Severity**: Critical | **Category**: Security | **OWASP**: A01:2021 - Broken Access Control

**Location**: `services/crm-service/src/routes/companies.ts:138-145`, `contacts.ts:223`, `deals.ts:244-275`

**Impact**: Deleting a company nullifies contacts across ALL organizations — cross-tenant data corruption. Any user can corrupt data belonging to other tenants by exploiting missing `organization_id` conditions on cascading UPDATE/DELETE operations.

**Recommendation**: Add `AND organization_id = $N` to every cascading UPDATE/DELETE. Add PostgreSQL Row Level Security (RLS) policies as defense-in-depth. Audit all mutating queries across all services.

---

### [S4] Deprecated Pipeline Proxy Endpoint Bypasses Tenant Isolation

**Severity**: Critical | **Category**: Security | **OWASP**: A01:2021 - Broken Access Control

**Location**: `services/pipeline-service/src/routes/leads.ts:286-315`

**Impact**: Any authenticated user can modify any organization's deals via deal ID without `organization_id` filter — complete tenant isolation bypass for deal mutations.

**Recommendation**: Delete this deprecated endpoint immediately. It serves no current purpose and is an active attack vector.

---

## High Priority Issues (fix before production)

### [A6] WebSocket Room Subscription Has No Ownership Verification

**Severity**: High | **Category**: Architecture

**Location**: `services/websocket-service/src/index.ts:384-398`

**Impact**: Any authenticated user can subscribe to any bd-account or chat room by ID — cross-tenant data leak of real-time messages.

**Recommendation**: Verify resource ownership against database/Redis cache before allowing room subscription. Check that the user's organization owns the requested bd-account or chat.

---

### [A7] No Graceful Shutdown in 11 of 13 Services

**Severity**: High | **Category**: Architecture

**Location**: All service `index.ts` files except bd-accounts-service

**Impact**: On deployment, in-flight requests are dropped, database transactions left in limbo, RabbitMQ messages lost. Causes data inconsistency on every deploy.

**Recommendation**: Add `SIGTERM`/`SIGINT` handlers to `createServiceApp` in `shared/service-core/src/service-app.ts`. Drain HTTP connections, close DB pool, ack/nack pending messages.

---

### [A8] CORS Defaults to `origin: '*'` in Production

**Severity**: High | **Category**: Architecture

**Location**: `services/api-gateway/src/index.ts:39`, `services/websocket-service/src/index.ts:25`

**Impact**: If `CORS_ORIGIN` env var is not set, any origin can make authenticated requests — enables CSRF-like attacks from malicious sites.

**Recommendation**: Remove the `|| '*'` fallback. Require `CORS_ORIGIN` in production. Fail startup if not provided.

---

### [A9] Single RabbitMQ Channel per Service — Head-of-Line Blocking

**Severity**: High | **Category**: Architecture

**Location**: `shared/utils/src/rabbitmq.ts:28`

**Impact**: One slow message blocks all others on the same channel. No `prefetch` set — unlimited unacked messages cause memory spikes and unpredictable processing behavior.

**Recommendation**: Create separate channels for publishing and consuming. Set `channel.prefetch(10)`. Consider per-queue channels for services with multiple consumers.

---

### [A10] automation-service Uses Raw `fetch` Instead of `ServiceHttpClient`

**Severity**: High | **Category**: Architecture

**Location**: `services/automation-service/src/event-handlers.ts:180-194, 486-514`

**Impact**: Bypasses standard retry logic, timeout handling, structured logging, and correlation-id propagation. Failures are harder to debug and may not be retried properly.

**Recommendation**: Use `ServiceHttpClient` instances for crm-service and pipeline-service calls.

---

### [S5] Backend Services Have Zero Authentication — Trust Gateway Headers Blindly

**Severity**: High | **Category**: Security | **OWASP**: A07:2021 - Identification and Authentication Failures

**Location**: `shared/service-core/src/middleware.ts:42-55`

**Impact**: Any network-adjacent attacker (including compromised containers) can forge `X-User-Id` and `X-Organization-Id` headers and impersonate any user with full privileges.

**Recommendation**: Either verify JWTs independently in each service, or implement shared HMAC signing for forwarded headers. Add network policies to restrict inter-service communication.

---

### [S6] No Password Complexity Requirements — 1-Character Passwords Accepted

**Severity**: High | **Category**: Security | **OWASP**: A07:2021 - Identification and Authentication Failures

**Location**: `services/auth-service/src/routes/auth.ts:30`

**Impact**: Combined with no brute-force protection, trivial credential stuffing attacks succeed. Users can set extremely weak passwords.

**Recommendation**: Enforce minimum 8 characters with Zod validation. Consider requiring mixed case, numbers, or special characters.

---

### [S7] Refresh Tokens Stored in Plaintext in Database

**Severity**: High | **Category**: Security | **OWASP**: A02:2021 - Cryptographic Failures

**Location**: `services/auth-service/src/routes/auth.ts:119-120, 143-144`

**Impact**: Database compromise (SQL injection, backup theft, insider threat) exposes all refresh tokens — 7-day account takeover window per token.

**Recommendation**: Store SHA-256 hash of refresh token in the database. Compare hashes during refresh flow. Raw token only exists client-side.

---

### [S8] AI Draft Endpoints Missing Organization Ownership Verification

**Severity**: High | **Category**: Security | **OWASP**: A01:2021 - Broken Access Control

**Location**: `services/ai-service/src/routes/drafts.ts:82-106`

**Impact**: Any authenticated user can read/approve drafts from other organizations by guessing or enumerating draft IDs.

**Recommendation**: Store `organizationId` in draft object. Verify on every access that the requesting user belongs to the same organization.

---

### [S9] Invite Link Creation Lacks Role-Based Permission Check

**Severity**: High | **Category**: Security | **OWASP**: A01:2021 - Broken Access Control

**Location**: `services/team-service/src/routes/invites.ts:86-100`

**Impact**: Any member (even viewer-role) can create invite links with owner role — privilege escalation to full organization control.

**Recommendation**: Add permission check requiring admin+ to create invites. Restrict assignable roles to at-or-below the requester's own role.

---

### [S10] Unauthenticated Internal SLA Cron Endpoint

**Severity**: High | **Category**: Security | **OWASP**: A01:2021 - Broken Access Control

**Location**: `services/automation-service/src/routes/rules.ts:64-71`

**Impact**: Anyone with network access can trigger SLA automation for any organization, potentially sending unwanted notifications or modifying lead states.

**Recommendation**: Add `requireUser()` and `requireRole` middleware, or protect with an internal API key verified via header.

---

### [Q1] Near-Zero Test Coverage Across 13 Services

**Severity**: High | **Category**: Code Quality

**Location**: Only 2 test files exist (`companies.test.ts`, `pipelines.test.ts`)

**Impact**: 11 of 13 services have zero automated tests. Critical business logic (campaign execution, automation rules, message processing) is completely untested. Regressions are discovered only in production.

**Recommendation**: Prioritize tests for `campaign-loop.ts`, `event-handlers.ts`, `messages.ts`, `conversations.ts`. Target 70%+ coverage on critical route files. Use `shared/test-utils` mock infrastructure.

---

### [Q2] messaging/page.tsx is 563 Lines with Inlined Business Logic

**Severity**: High | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/page.tsx:1-563`

**Impact**: Violates 300-line file standard. Contains inline API calls, `alert()` for error handling, `console.error` instead of user-visible errors. Extremely difficult to test or modify safely.

**Recommendation**: Extract modals into separate component files. Move API calls to `useMessagingActions`. Limit page component to layout and composition.

---

### [Q3] useMessagingState Exposes 90+ Individual useState Variables

**Severity**: High | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingState.ts:1-254`

**Impact**: Every state change re-renders the entire messaging tree. No grouping or memoization. Performance degrades with conversation count.

**Recommendation**: Split into domain-specific Zustand stores: `chatListStore`, `messageStore`, `uiStore`. Use selectors for fine-grained re-renders.

---

### [Q4] Duplicated Chat-Mapping Logic in fetchChats and useEffect

**Severity**: High | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:38-109, 225-277`

**Impact**: Same mapping/deduplication logic copy-pasted in two locations. Bug fixes must be applied in both places — divergence is inevitable.

**Recommendation**: Extract `mapAndDeduplicateChats()` as a pure function. Use it in both code paths.

---

### [Q5] Pervasive `any` Typing in Backend Route Files

**Severity**: High | **Category**: Code Quality

**Location**: `services/messaging-service/src/routes/messages.ts`, `conversations.ts`, `services/automation-service/src/event-handlers.ts`, `services/campaign-service/src/campaign-loop.ts`

**Impact**: TypeScript safety defeated across the most critical business logic files. Typos and shape mismatches produce `undefined` at runtime instead of compile-time errors.

**Recommendation**: Define typed interfaces for all database query results and API payloads. Use discriminated unions for event types. Enable `strict: true` in tsconfig.

---

## Medium Priority Issues (plan for next sprint)

### [A11] No Data Access Layer — Raw SQL in Route Handlers

**Severity**: Medium | **Category**: Architecture

**Location**: All service `routes/*.ts` files

**Impact**: SQL scattered across 30+ files. Schema changes require grep-and-fix across the entire codebase. Testing requires a real database connection — no unit testing possible.

**Recommendation**: Extract data access into per-entity repository modules (e.g., `CompanyRepository`, `LeadRepository`). Route handlers call repositories, repositories own SQL.

---

### [A12] campaign-loop Holds DB Connections During External HTTP Calls and Sleep

**Severity**: Medium | **Category**: Architecture

**Location**: `services/campaign-service/src/campaign-loop.ts:50-246`

**Impact**: Holding up to 20 connections for minutes during delays and HTTP calls exhausts the pool, starving other queries in the same service.

**Recommendation**: Restructure to: query batch → release connection → perform HTTP sends → acquire connection → update results.

---

### [A13] No Event Versioning or Schema Registry

**Severity**: Medium | **Category**: Architecture

**Location**: `shared/events/src/index.ts`

**Impact**: No runtime validation, no version field on events. Schema changes require simultaneous deployment of all producers and consumers — zero tolerance for rolling deployments.

**Recommendation**: Add `version` field to `BaseEvent`. Add Zod schemas for runtime validation at consumer boundary. Support multiple versions during migration windows.

---

### [A14] WebSocket Service Connection Tracking is In-Memory

**Severity**: Medium | **Category**: Architecture

**Location**: `services/websocket-service/src/index.ts:273-278`

**Impact**: Connection counts and rate limiting are per-instance — limits don't work across multiple WebSocket instances. Scaling WebSocket service breaks rate limiting.

**Recommendation**: Move connection counts and rate limiting to Redis. Use Redis pub/sub or sorted sets for presence tracking.

---

### [A15] Frontend: No Server-Side Rendering / Data Fetching

**Severity**: Medium | **Category**: Architecture

**Location**: All frontend pages use `'use client'`

**Impact**: Next.js used as a pure SPA — paying the framework complexity cost without using its primary value proposition (SSR, RSC). No SEO benefit, no initial load optimization.

**Recommendation**: Acceptable for dashboard-only app, but add React Query (TanStack Query) for caching, deduplication, and background refetching. Consider SSR for public-facing pages if added later.

---

### [S11] Missing Security Headers (X-Frame-Options, CSP, HSTS)

**Severity**: Medium | **Category**: Security | **OWASP**: A05:2021 - Security Misconfiguration

**Location**: `services/api-gateway/src/index.ts:38-48`

**Impact**: Clickjacking via iframe embedding, content-type sniffing, protocol downgrade attacks all possible.

**Recommendation**: Add `helmet` middleware to the API gateway. Configure CSP, HSTS, X-Frame-Options, X-Content-Type-Options.

---

### [S12] Proxy Error Responses Leak Internal Service Details

**Severity**: Medium | **Category**: Security | **OWASP**: A05:2021 - Security Misconfiguration

**Location**: `services/api-gateway/src/index.ts:191, 326`

**Impact**: Internal hostnames, connection details, and stack traces exposed to API clients in error responses. Aids attacker reconnaissance.

**Recommendation**: Remove `details` field from error responses sent to clients. Log full details server-side only.

---

### [S13] Refresh Rate Limiting Uses In-Memory Map

**Severity**: Medium | **Category**: Security | **OWASP**: A04:2021 - Insecure Design

**Location**: `services/auth-service/src/routes/auth.ts:22-23`

**Impact**: Ineffective in multi-instance deployment (each instance has its own map). Memory leak from unpruned entries over time.

**Recommendation**: Move to Redis with TTL-based keys (e.g., `rate:refresh:{userId}` with 60s TTL).

---

### [S14] No Per-Account Brute-Force Protection on Login

**Severity**: Medium | **Category**: Security | **OWASP**: A07:2021 - Identification and Authentication Failures

**Location**: `services/auth-service/src/routes/auth.ts:128-159`

**Impact**: Gateway's 100 req/min anonymous limit is far too high for credential brute-forcing. Attacker can try ~100 passwords per minute per email.

**Recommendation**: Implement per-email rate limiting: lock account after 5 failed attempts for 15 minutes. Use Redis for distributed tracking.

---

### [S15] JWT Secrets Exported as Named Module Exports

**Severity**: Medium | **Category**: Security | **OWASP**: A02:2021 - Cryptographic Failures

**Location**: `services/auth-service/src/helpers.ts:11`

**Impact**: Supply chain attack on any dependency could access raw secret values via module introspection.

**Recommendation**: Encapsulate secrets in `sign()` and `verify()` functions only. Do not export raw secret strings.

---

### [S16] Excessive console.log of User Data in API Gateway

**Severity**: Medium | **Category**: Security | **OWASP**: A09:2021 - Security Logging and Monitoring Failures

**Location**: `services/api-gateway/src/index.ts:87,100,122,132`

**Impact**: PII (user IDs, organization IDs, email addresses) logged on every authenticated request in unstructured format. Compliance risk (GDPR, SOC 2).

**Recommendation**: Use structured logger with PII redaction. Log only what's necessary for debugging.

---

### [Q6] Duplicated parseCsvLine in Two Services

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/crm-service/src/helpers.ts:54-71`, `services/campaign-service/src/helpers.ts:170-187`

**Impact**: Same CSV parsing function duplicated in two services. Bug fixes or improvements must be applied twice.

**Recommendation**: Move to `shared/utils` as a shared utility function.

---

### [Q7] organization_settings Query Duplicated 5 Times

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/messaging-service/src/routes/conversations.ts:394,467,481,777`

**Impact**: Same query appears 5 times in one file. Up to 2 redundant queries per request path.

**Recommendation**: Extract `getSharedChatSettings(pool, organizationId)` helper that caches per-request.

---

### [Q8] Lead Context SQL Query (20-line JOIN) Repeated 3–4 Times

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/messaging-service/src/routes/conversations.ts:112-252`

**Impact**: Nearly identical 20-line multi-JOIN queries copy-pasted. Schema changes require updating 3–4 copies — guaranteed divergence.

**Recommendation**: Create shared SQL builder function or a database view for lead context retrieval.

---

### [Q9] automation-service Raw fetch() Duplicates ServiceHttpClient Logic

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/automation-service/src/event-handlers.ts:180-238`

**Impact**: Hand-rolled retry logic duplicates what `ServiceHttpClient` already provides, without correlation-id forwarding or structured error handling.

**Recommendation**: Replace with `ServiceHttpClient` instances configured for each downstream service.

---

### [Q10] ServiceCallError Handling Duplicated in Every AI Endpoint

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/messaging-service/src/routes/conversations.ts:311-322, 376-387`

**Impact**: Same catch block pattern copy-pasted 4+ times across AI-related endpoints.

**Recommendation**: Extract `handleServiceCallError(res, error, context)` helper function.

---

### [Q11] Frontend Uses console.error + alert() Instead of Toast System

**Severity**: Medium | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/page.tsx`, `hooks/useMessagingActions.ts`

**Impact**: `alert()` blocks the UI thread. `console.error` is invisible to users. No consistent error feedback pattern.

**Recommendation**: Implement toast notification system using `react-hot-toast` or `sonner`. Replace all `alert()` and user-facing `console.error` calls.

---

### [Q12] MockPool Doesn't Support Per-Query Result Mapping

**Severity**: Medium | **Category**: Code Quality

**Location**: `shared/test-utils/src/mock-pool.ts:18-47`

**Impact**: Tests use `mockImplementationOnce` chains — brittle and order-dependent. Reordering queries in production code breaks tests.

**Recommendation**: Add `whenQuery(pattern, result)` method to `MockPool` for pattern-based result mapping.

---

### [Q13] campaign-loop.ts — 271-Line Single Function with Deep Nesting

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/campaign-service/src/campaign-loop.ts:25-271`

**Impact**: Cyclomatic complexity >20. 6+ levels of nesting. Extremely difficult to test individual paths or debug failures.

**Recommendation**: Break into focused functions: `checkRateLimits()`, `evaluateAndSend()`, `advanceParticipant()`, `handleSendFailure()`.

---

### [Q14] No Alert Rules for DB Pool, RabbitMQ Disconnection, Campaign Failures

**Severity**: Medium | **Category**: Code Quality

**Location**: `infrastructure/prometheus/alert_rules.yml:1-80`

**Impact**: Critical operational scenarios go unmonitored. DB pool exhaustion, RabbitMQ disconnection, and campaign failures are silent.

**Recommendation**: Add alerts for `automation_failed_total`, `automation_dlq_total`, `pg_pool_idle_count < 2`, cron dead-man's-switch.

---

### [Q15] createTask Action Handler is a No-Op Stub in Production

**Severity**: Medium | **Category**: Code Quality

**Location**: `services/automation-service/src/event-handlers.ts:534-536`

**Impact**: Users configure `create_task` automation rules believing they work, but the handler silently does nothing. Data integrity issue — automation appears active but isn't.

**Recommendation**: Either implement task creation (integrate with a task system) or return a 501 error with a clear message that the feature is not yet available.

---

## Low Priority / Suggestions

### [A16] API Gateway Has Massive Code Duplication in Proxy Config

**Severity**: Low | **Category**: Architecture

**Location**: `services/api-gateway/src/index.ts:171-427`

**Impact**: 11 near-identical proxy blocks. Adding a new service requires copying ~25 lines and updating in multiple places.

**Recommendation**: Extract `createAuthenticatedProxy(serviceName, targetUrl, pathPrefix)` factory function. Reduce to a configuration array.

---

### [A17] RabbitMQ Client and API Gateway Use console.log Instead of Structured Logger

**Severity**: Low | **Category**: Architecture

**Location**: `shared/utils/src/rabbitmq.ts`, `services/api-gateway/src/index.ts`, `services/websocket-service/src/index.ts`

**Impact**: Unstructured logs without correlation IDs. Production debugging across services is significantly harder.

**Recommendation**: Use `@getsale/service-core` logger in all services and shared packages.

---

### [A18] Over-decomposition: 13 Microservices for Early-Stage SaaS

**Severity**: Low | **Category**: Architecture

**Location**: All `services/` directories

**Impact**: 13 deployment units create operational overhead disproportionate to team size and traffic. Several services (user-service, team-service) have thin logic that doesn't justify separate processes.

**Recommendation**: Consider consolidating: merge team-service + user-service into identity-service, merge analytics into crm-service. Reduce to ~8 services.

---

### [A19] Duplicate Auth Token Refresh Interceptors

**Severity**: Low | **Category**: Architecture

**Location**: `frontend/lib/stores/auth-store.ts:242-307`, `frontend/lib/api/client.ts:44-90`

**Impact**: Two independent refresh interceptors can race, causing double refresh requests and potential token invalidation.

**Recommendation**: Remove global axios interceptor. Use only `apiClient` for all API calls with a single refresh interceptor.

---

### [A20] @ts-nocheck in telegram-manager.ts (3800+ lines)

**Severity**: Low | **Category**: Architecture

**Location**: `services/bd-accounts-service/src/telegram-manager.ts:1`

**Impact**: The largest file in the system has TypeScript completely disabled. Type errors are not caught at compile time. Refactoring is extremely risky.

**Recommendation**: Remove `@ts-nocheck`. Split into focused modules: `TelegramConnectionPool`, `TelegramMessageHandler`, `TelegramSyncEngine`, `TelegramAuthFlow`.

---

### [S17] 2GB Base64 File Acceptance Risks Memory Exhaustion (DoS)

**Severity**: Low | **Category**: Security

**Location**: `services/messaging-service/src/routes/messages.ts:244-252`

**Impact**: A 2GB base64 string in a message body causes out-of-memory crash, taking down the messaging service for all users.

**Recommendation**: Set `express.json({ limit: '50mb' })`. Use multipart upload for larger files. Add file size validation before base64 decoding.

---

### [S18] Stripe Webhook Signature Verification Not Implemented

**Severity**: Low | **Category**: Security

**Location**: `services/user-service/src/routes/subscription.ts`

**Impact**: Subscription lifecycle events (payment success, cancellation, etc.) cannot be securely received from Stripe. Webhook endpoint is either missing or unprotected.

**Recommendation**: Implement webhook endpoint with `stripe.webhooks.constructEvent()` for signature verification.

---

### [S19] Ownership Transfer Does Not Invalidate Existing Sessions

**Severity**: Low | **Category**: Security

**Location**: `services/auth-service/src/routes/organization.ts:63-88`

**Impact**: Former owner retains owner privileges for up to 15 minutes (JWT expiry) after ownership transfer. Can perform destructive actions during this window.

**Recommendation**: Invalidate all access tokens on role changes. Maintain a token blacklist in Redis checked during JWT verification.

---

### [Q16] useMessagingData Has Duplicate useEffect — Chats Loaded via Two Code Paths

**Severity**: Low | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:38-109, 225-277`

**Impact**: Initial load and refresh use different code paths with copied logic. Subtle behavior differences between the two paths.

**Recommendation**: Consolidate to use `fetchChats` callback in the `useEffect`. Single code path for chat loading.

---

### [Q17] Hardcoded Russian Strings in JSX Despite i18n Setup

**Severity**: Low | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/page.tsx:195, 375, 387-388`

**Impact**: Breaks internationalization for non-Russian users. Inconsistent with the rest of the app which uses `t()` translation keys.

**Recommendation**: Move all hardcoded strings to `locales/ru.json` and `locales/en.json`. Use `t()` translation keys consistently.

---

### [Q18] SLA Cron Only Processes LIMIT 1 Breach Per Run

**Severity**: Low | **Category**: Code Quality

**Location**: `services/automation-service/src/sla-cron.ts:36-43, 74`

**Impact**: With hourly runs, 100 breaching leads across 5 rules takes 100+ hours to fully process. SLA enforcement is effectively broken at scale.

**Recommendation**: Remove `LIMIT 1`. Add batch processing with configurable batch size. Process all breaches per rule per run.

---

### [Q19] Logger Lacks Log Level Control and Sampling

**Severity**: Low | **Category**: Code Quality

**Location**: `shared/logger/src/index.ts:1-41`

**Impact**: No `LOG_LEVEL` env support. All logs written unconditionally. Enormous log volumes at scale increase storage costs and make debugging harder.

**Recommendation**: Add `LOG_LEVEL` env support (debug, info, warn, error). Filter logs in production. Consider log sampling for high-volume debug logs.

---

### [Q20] executeRule Uses Different INSERT Schema Than processLeadStageChanged

**Severity**: Low | **Category**: Code Quality

**Location**: `services/automation-service/src/event-handlers.ts:445-455 vs 262-268`

**Impact**: Two different column sets used for the same `automation_executions` table. Runtime SQL errors or missing data depending on which code path is taken.

**Recommendation**: Standardize the INSERT schema for `automation_executions`. Create a shared `insertAutomationExecution()` function.

---

### [Q21] No Prometheus Metrics in campaign-loop.ts

**Severity**: Low | **Category**: Code Quality

**Location**: `services/campaign-service/src/campaign-loop.ts`

**Impact**: Campaign execution is a monitoring blind spot. No visibility into send rates, failure rates, or processing latency.

**Recommendation**: Add `campaign_messages_sent_total`, `campaign_send_failed_total`, `campaign_loop_duration_seconds` counters.

---

### [Q22] useMessagingData Has 9 useEffect Hooks with Missing Dependencies

**Severity**: Low | **Category**: Code Quality

**Location**: `frontend/app/dashboard/messaging/hooks/useMessagingData.ts:178-457`

**Impact**: Stale closures and fragile `ref` workarounds. Effects may not re-run when dependencies change, causing subtle UI bugs.

**Recommendation**: Use `useCallback` with proper dependency arrays. Consider `react-query` (TanStack Query) for data fetching effects.

---

### [Q23] buildLeadContextPayload Accepts row: any

**Severity**: Low | **Category**: Code Quality

**Location**: `services/messaging-service/src/routes/conversations.ts:769`

**Impact**: No compile-time type safety for complex 20-column query results. Typos in property access produce `undefined` silently.

**Recommendation**: Define `LeadContextRow` interface matching the query's SELECT columns. Type the function parameter accordingly.

---

## Priority Matrix

| ID | Issue | Severity | Effort | Priority |
|----|-------|----------|--------|----------|
| S1 | Hardcoded JWT secret fallbacks | Critical | Low | P0 — now |
| S3 | Cross-tenant data mutation | Critical | Medium | P0 — now |
| S4 | Deprecated endpoint bypasses isolation | Critical | Low | P0 — now |
| A2 | Gateway auth HTTP roundtrip | Critical | Medium | P0 — now |
| A1 | PostgreSQL connection pool exhaustion | Critical | Medium | P0 — now |
| A4 | RabbitMQ poison message loop | Critical | Medium | P0 — now |
| S2 | SSRF via /unfurl | Critical | Low | P0 — now |
| A5 | JWT in localStorage | Critical | High | P0 — sprint |
| A3 | TelegramManager stateful | Critical | High | P0 — sprint |
| S5 | Backend trusts gateway headers | High | Medium | P1 — sprint |
| S9 | Invite link role escalation | High | Low | P1 — sprint |
| S6 | No password complexity | High | Low | P1 — sprint |
| S7 | Refresh tokens plaintext | High | Medium | P1 — sprint |
| S8 | AI drafts org check missing | High | Low | P1 — sprint |
| S10 | Unauthenticated SLA endpoint | High | Low | P1 — sprint |
| A6 | WS room no ownership check | High | Medium | P1 — sprint |
| A7 | No graceful shutdown | High | Medium | P1 — sprint |
| A8 | CORS defaults to * | High | Low | P1 — sprint |
| A9 | Single RabbitMQ channel | High | Medium | P1 — sprint |
| A10 | automation raw fetch | High | Low | P1 — sprint |
| Q1 | Near-zero test coverage | High | High | P1 — sprint |
| Q2 | messaging page 563 lines | High | Medium | P1 — sprint |
| Q3 | 90+ useState variables | High | Medium | P1 — sprint |
| Q4 | Duplicated chat mapping | High | Low | P1 — sprint |
| Q5 | Pervasive any typing | High | High | P1 — sprint |
| A11 | No data access layer | Medium | High | P2 — next sprint |
| A12 | campaign-loop holds connections | Medium | Medium | P2 — next sprint |
| A13 | No event versioning | Medium | Medium | P2 — next sprint |
| A14 | WS connection tracking in-memory | Medium | Medium | P2 — next sprint |
| A15 | No SSR / data fetching | Medium | Medium | P2 — next sprint |
| S11 | Missing security headers | Medium | Low | P2 — next sprint |
| S12 | Proxy error leaks internals | Medium | Low | P2 — next sprint |
| S13 | Refresh rate limit in-memory | Medium | Low | P2 — next sprint |
| S14 | No per-account brute-force protection | Medium | Medium | P2 — next sprint |
| S15 | JWT secrets exported | Medium | Low | P2 — next sprint |
| S16 | Excessive PII logging | Medium | Medium | P2 — next sprint |
| Q6 | Duplicated parseCsvLine | Medium | Low | P2 — next sprint |
| Q7 | organization_settings duplicated 5x | Medium | Low | P2 — next sprint |
| Q8 | Lead context SQL repeated 3-4x | Medium | Medium | P2 — next sprint |
| Q9 | automation raw fetch duplicates | Medium | Low | P2 — next sprint |
| Q10 | ServiceCallError handling duplicated | Medium | Low | P2 — next sprint |
| Q11 | alert() instead of toast | Medium | Medium | P2 — next sprint |
| Q12 | MockPool no per-query mapping | Medium | Medium | P2 — next sprint |
| Q13 | campaign-loop 271-line function | Medium | Medium | P2 — next sprint |
| Q14 | Missing alert rules | Medium | Medium | P2 — next sprint |
| Q15 | createTask is no-op stub | Medium | Medium | P2 — next sprint |
| A16 | Gateway proxy duplication | Low | Low | P3 — backlog |
| A17 | console.log instead of logger | Low | Medium | P3 — backlog |
| A18 | Over-decomposition 13 services | Low | High | P3 — backlog |
| A19 | Duplicate refresh interceptors | Low | Low | P3 — backlog |
| A20 | @ts-nocheck in 3800-line file | Low | High | P3 — backlog |
| S17 | 2GB base64 DoS | Low | Low | P3 — backlog |
| S18 | Stripe webhook unverified | Low | Medium | P3 — backlog |
| S19 | Ownership transfer session leak | Low | Medium | P3 — backlog |
| Q16 | Duplicate useEffect chat loading | Low | Low | P3 — backlog |
| Q17 | Hardcoded Russian strings | Low | Low | P3 — backlog |
| Q18 | SLA cron LIMIT 1 | Low | Low | P3 — backlog |
| Q19 | Logger no level control | Low | Low | P3 — backlog |
| Q20 | Inconsistent INSERT schema | Low | Low | P3 — backlog |
| Q21 | No campaign metrics | Low | Low | P3 — backlog |
| Q22 | 9 useEffects missing deps | Low | Medium | P3 — backlog |
| Q23 | buildLeadContextPayload any | Low | Low | P3 — backlog |

---

## Scalability Assessment for 10k+ Conversations

### Current capacity estimate: ~500 concurrent conversations

**Bottlenecks (in order of impact):**

1. **PostgreSQL connections** — 100 default `max_connections`, 220 service pool total. Under moderate load, connection errors cascade across all services.
2. **Gateway auth roundtrip** — ~10ms per request × 100 req/s = 1 full second of latency budget consumed by auth verification alone.
3. **Single-process API gateway** — No Node.js clustering. Single event loop handles all traffic.
4. **TelegramManager in-memory state** — Cannot scale bd-accounts-service horizontally. Single point of failure for all Telegram integrations.
5. **RabbitMQ single-channel head-of-line blocking** — One slow consumer blocks all messages on the channel.
6. **No query optimization for conversation list** — O(N×M) correlated subqueries for chat listing.

### To reach 10k+ conversations:

1. **Deploy PgBouncer** — Handles 10x more connections with connection reuse and transaction pooling.
2. **Local JWT verification** — Eliminates ~50% of auth-service load. Sub-millisecond verification.
3. **Gateway clustering / multi-instance** — Horizontal scaling via Node.js cluster module or multiple containers behind a load balancer.
4. **Denormalize conversation metadata** — Eliminate correlated subqueries. Maintain materialized view or denormalized table for chat list.
5. **TelegramManager distributed ownership** — Enable multiple bd-accounts-service instances with Redis-based account claiming.
6. **Separate RabbitMQ channels** — Eliminate head-of-line blocking. Per-consumer channels with appropriate prefetch.

---

## AI Integration Evolution Recommendations

### Current state

- OpenAI GPT-4o for drafts, analysis, summarization
- Redis-backed per-org rate limiting (200/hour)
- Event-driven draft generation on `MESSAGE_RECEIVED`
- Prompt versioning (1.0.0) but no A/B testing framework

### Recommendations for AI-driven product evolution

1. **Multi-model strategy**: Add fallback to GPT-4o-mini for non-critical operations (summarization, categorization). Use streaming for real-time draft generation UI.
2. **Prompt management**: Store prompts in database for per-org customization. Add A/B testing framework for prompt variants with conversion tracking.
3. **Context window optimization**: Current conversation analysis sends full message history. Implement sliding window + summarization for long conversations (100+ messages).
4. **AI cost tracking**: Track token usage per org for usage-based billing. Current rate limiter counts requests, not tokens — a 10-token request costs the same as a 10k-token request.
5. **Embedding-based features**: Add vector search (pgvector) for similar conversations, customer context enrichment, smart lead scoring based on conversation patterns.
6. **AI observability**: Add latency, token usage, and error rate metrics per model/prompt combination. Currently no AI-specific Prometheus metrics exist.

---

## Production SaaS Readiness Checklist

| Requirement | Status | Blocking Issues |
|-------------|--------|-----------------|
| Multi-tenant data isolation | **FAIL** | S3, S4, S8, A6 |
| Authentication security | **FAIL** | S1, A5, S5, S6, S7 |
| Authorization / RBAC | **FAIL** | S9, S10, A6 |
| Input validation | **FAIL** | S2, S17 |
| Horizontal scalability | **FAIL** | A1, A2, A3 |
| High availability | **FAIL** | A7, A4, A9 |
| Monitoring & alerting | **PARTIAL** | Q14, Q19, Q21 |
| Test coverage | **FAIL** | Q1 |
| Data encryption at rest | **FAIL** | Not implemented |
| Security headers | **FAIL** | S11 |
| Rate limiting | **PARTIAL** | S13, S14 |
| Graceful degradation | **FAIL** | A7, A4 |

---

## Next Steps

### 1. Immediate (before any external access)

- **[S1]** Remove JWT secret fallbacks — crash if unset
- **[S4]** Delete deprecated pipeline endpoint
- **[S3]** Add `organization_id` filters to all cascading UPDATE/DELETE operations
- **[S2]** Block internal URLs in `/unfurl` endpoint
- **[A2]** Switch to local JWT verification in gateway
- **[A1]** Deploy PgBouncer, set `max_connections = 300`

### 2. This sprint (before beta users)

- **[A4]** Fix RabbitMQ poison message loop — add retry headers and DLQ
- **[A7]** Add graceful shutdown to all services via service-core
- **[S5]** Add internal auth between services (HMAC or JWT forwarding)
- **[S6]** Add password complexity requirements (min 8 chars)
- **[S7]** Hash refresh tokens with SHA-256
- **[S8]** Add organization check to AI draft endpoints
- **[S9]** Add permission check to invite link creation
- **[S10]** Secure SLA cron endpoint with authentication
- **[A8]** Remove CORS wildcard fallback — require explicit origin
- **[Q1]** Write tests for critical paths (campaign-loop, automation, messaging)

### 3. Next sprint (before production launch)

- **[A5]** Move tokens to httpOnly cookies
- **[A3]** Implement distributed TelegramManager with Redis locking
- **[A6]** Add WebSocket room ownership verification
- **[A9]** Separate RabbitMQ publish/consume channels
- **[S11]** Add security headers via helmet
- **[S14]** Add per-account brute-force protection
- **[Q2–Q5]** Frontend refactoring and type safety improvements

### 4. Backlog (continuous improvement)

- All medium and low findings
- Test coverage expansion to 70%+ on critical paths
- Service consolidation (A18)
- React Query migration (A15)
- AI integration evolution
- Data access layer extraction (A11)

---

Use `/refactor [file]` for structural issues.
Use `/implement [fix]` for feature-level security fixes.
"""

filepath = os.path.join("ai_docs", "develop", "audits", "2026-03-05-full-system-audit.md")
os.makedirs(os.path.dirname(filepath), exist_ok=True)
with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
print(f"Written {os.path.getsize(filepath)} bytes to {filepath}")
