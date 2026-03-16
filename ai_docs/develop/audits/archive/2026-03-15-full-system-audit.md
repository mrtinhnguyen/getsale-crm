# Project Audit Report — Full System Audit

**Date**: 2026-03-15  
**Scope**: Full project (services/, shared/, frontend/, migrations/, infrastructure/)  
**Audited by**: senior-reviewer + security-auditor + reviewer

---

## Executive Summary

**Overall Health Score**: 0.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 2           | 1        | 0            | **3** |
| High     | 3           | 3        | 6            | **12** |
| Medium   | 4           | 4        | 8            | **16** |
| Low      | 4           | 2        | 6            | **12** |

**Recommendation**: Address all 3 critical issues before next release. Then systematically fix High-severity findings (validation, CSP, logging, tenant-scoping, types, i18n, error reporting, component size).

---

## Critical Issues (fix immediately)

### [A1/S2] RLS tenant isolation never applied

**Category**: Architecture / Security  
**Location**: `shared/service-core/src/rls.ts` (withOrgContext defined); no usages in `services/**`  
**Impact**: No defense-in-depth; tenant isolation relies only on application-level `WHERE organization_id`. A single missing filter can leak or corrupt data across tenants.  
**Fix**: Gradually migrate routes to use `withOrgContext(pool, req.user.organizationId, async (client) => { ... })` for all tenant-scoped queries so RLS policies enforce isolation.

### [A2/S5/Q1] `/ready` endpoint missing

**Category**: Architecture / Security / Code Quality  
**Location**: `.cursor/rules/backend-standards.mdc` (requires /ready); `shared/service-core/src/service-app.ts` (only /health); `services/api-gateway/src/index.ts` (only /health)  
**Impact**: K8s/load balancers cannot distinguish "process up" from "dependencies ready"; rolling deploys may route traffic to not-ready instances.  
**Fix**: Add `GET /ready` in `createServiceApp()` that checks DB (if not skipDb), RabbitMQ (if not skipRabbitMQ), and optionally Redis; return 200 only when all are healthy. Add `/ready` on API gateway that checks Redis (and optionally downstream health) if needed.

### [S1/A3] Messaging `attachLead` does not scope by tenant

**Category**: Security / Architecture  
**Location**: `services/messaging-service/src/helpers.ts` (lines 28–37); called from `event-handlers.ts`  
**Impact**: `attachLead()` updates `conversations` by `id` and lead_id only, without verifying the conversation belongs to `event.organizationId`. If `LEAD_CREATED_FROM_CAMPAIGN` is forged or misrouted, cross-tenant data modification is possible.  
**Fix**: Add `AND organization_id = $N` to the UPDATE using `event.organizationId` (or from a validated lead/conversation lookup). Validate that conversation and lead belong to the same organization before updating.

---

## High Priority Issues (fix soon)

### [S3] Many state-changing endpoints lack Zod validation

**Category**: Security  
**Location**: bd-accounts-service messaging routes (`services/bd-accounts-service/src/routes/messaging.ts`), auth organization PATCH and transfer-ownership (`auth-service/src/routes/organization.ts`), pipeline stages (`pipeline-service/src/routes/stages.ts`), team members/clients (`team-service/src/routes/`), and others using `asyncHandler` without `validate(Schema)`  
**Fix**: Add Zod schemas for all request bodies/query params and use `validate(Schema)` (or `validate(Schema, 'query')`) on every public and internal endpoint that accepts input.

### [S4] Gateway disables CSP and COEP

**Category**: Security  
**Location**: `services/api-gateway/src/index.ts` — `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })`  
**Fix**: Enable CSP with a strict policy (e.g. default-src 'self'; script-src/style-src as needed) and COEP where feasible, or document why disabled and add a minimal CSP.

### [A4] Event publish failure metric only in pipeline-service

**Category**: Architecture  
**Location**: `services/pipeline-service/src/index.ts`; other publishers (auth, crm, automation, campaign, etc.) do not expose `event_publish_failed_total`  
**Fix**: Either add the same metric (and optional alert) in shared publish path (e.g. `shared/utils/rabbitmq.ts` or a wrapper), or add per-service metrics so alerting and dashboards cover all publishers.

### [A5/Q2] Console logging in production

**Category**: Architecture / Code Quality  
**Location**: `shared/utils/src/redis.ts` (lines 16, 20); fatal startup in `user-service`, `team-service`, `activity-service`, `crm-service`, `bd-accounts-service`, `pipeline-service`, `auth-service`, `analytics-service`, `ai-service`  
**Fix**: Replace all `console.log`/`console.error`/`console.warn` with `@getsale/logger`; pass logger into RedisClient or use a module-level logger for connection events; use logger in service bootstrap before app is created.

### [S6/Q3/Q5] Internal endpoint and cron trust body/header organizationId

**Category**: Security / Code Quality  
**Location**: `services/pipeline-service/src/routes/internal.ts` (POST default-for-org uses `req.body.organizationId`); `services/automation-service/src/routes/rules.ts` (SLA cron uses `req.body?.organizationId` or `x-organization-id`)  
**Fix**: For internal pipeline creation, require organizationId from a signed internal context or from the authenticated caller's header set by gateway; do not trust body for tenant scope. For SLA cron, use only server-derived context (e.g. from job payload signed by scheduler or from `req.user`).

### [Q4] `(req as any).user` and untyped `post<any>` in discovery-tasks

**Category**: Code Quality  
**Location**: `services/crm-service/src/routes/discovery-tasks.ts` (lines 75, 153, 155)  
**Fix**: Use typed `req.user` from middleware (extend Express Request type); define a response type for campaign client `post<T>()` instead of `post<any>`.

### [Q6] Hardcoded user-facing strings in root error UI

**Category**: Code Quality  
**Location**: `frontend/app/global-error.tsx` (lines 55–74) — Russian strings  
**Fix**: Move all user-facing strings to `locales/` and use i18n in `global-error.tsx`.

### [Q7/A10] Error reporter / Sentry not integrated

**Category**: Code Quality / Architecture  
**Location**: `frontend/lib/error-reporter.ts` (TODO for Sentry)  
**Fix**: Integrate Sentry (or equivalent) in frontend and optionally backend; replace `reportError`/`reportWarning` implementation to send to Sentry with user/org context (sanitized).

### [Q8] Oversized bd-accounts page component

**Category**: Code Quality  
**Location**: `frontend/app/dashboard/bd-accounts/page.tsx` (~1,427 lines)  
**Fix**: Split into subcomponents, custom hooks, and/or feature modules to meet the 300-line rule.

---

## Medium Priority Issues (plan for next sprint)

- [A6] BaseEvent has no top-level correlationId — `shared/events/src/index.ts`
- [A7] Service-to-service clients with retries: 0 — campaign-service, messaging-service index
- [A8] No RabbitMQ queue depth metrics — `shared/utils/src/rabbitmq.ts`
- [A9] AI service calls without full context — `messaging-service/src/routes/conversation-ai.ts`
- [S7] WebSocket CORS fallback to '*' in non-production — websocket-service
- [S8] dangerouslySetInnerHTML in root layout — `frontend/app/layout.tsx`
- [Q9] Messaging POST /send has no Zod — `messaging-service/src/routes/messages.ts`
- [Q10] AI and other routes without Zod — ai-service, bd-accounts, pipeline, notes, reminders, analytics
- [Q11] Notes and reminders POST bodies unvalidated — crm-service routes
- [Q12] Long handler and any[] in contacts import-from-telegram-group — crm-service contacts.ts
- [Q13] Frontend API types any in discovery — `frontend/lib/api/discovery.ts`
- [Q14] Swallowed errors and console in messaging hooks — useMessagingData.ts
- [Q15] Hardcoded strings on bd-accounts page
- [Q16] DRY: repeated CSV/import and batch-insert logic — contacts, campaign campaigns

---

## Low Priority / Suggestions

- [A10/A11] Sentry and OpenTelemetry not integrated
- [A12] No DB partitioning for messages/conversations
- [A13] API Gateway has no /ready
- [S9] JWT algorithm not fixed in verify/sign
- [S10] 2FA recovery codes bcrypt cost 10
- [Q17–Q22] Handler lengths, query validation, error boundaries, WebSocket/Redis types

---

## Priority Matrix

| ID        | Issue                          | Severity | Effort | Priority   |
|-----------|--------------------------------|----------|--------|------------|
| A1/S2     | RLS never applied              | Critical | High   | P0 — now   |
| A2/S5/Q1  | /ready missing                 | Critical | Low    | P0 — now   |
| S1/A3     | attachLead tenant scope        | Critical | Low    | P0 — now   |
| S3        | Many endpoints lack Zod        | High     | High   | P1 — sprint|
| S4        | CSP/COEP disabled              | High     | Medium | P1 — sprint|
| A4        | Event metric only pipeline     | High     | Medium | P1 — sprint|
| A5/Q2     | Console logging                | High     | Medium | P1 — sprint|
| S6/Q3/Q5  | Body/header organizationId     | High     | Medium | P1 — sprint|
| Q4        | any in discovery-tasks         | High     | Low    | P1 — sprint|
| Q6        | global-error i18n              | High     | Low    | P1 — sprint|
| Q7/A10    | Sentry not integrated          | High     | Medium | P1 — sprint|
| Q8        | Oversized bd-accounts page     | High     | High   | P1 — sprint|

---

## Next Steps

1. **Immediate**: Add `/ready`; fix `attachLead` tenant scope; start migrating routes to `withOrgContext()`.
2. **This sprint**: Zod on all state-changing endpoints; enable CSP/COEP; replace console with logger; fix body orgId trust; fix any types, i18n, Sentry; split bd-accounts page.
3. **Next sprint**: Medium findings (correlationId, retries, queue metrics, AI context, Zod for messaging/notes, types, DRY).
4. **Backlog**: Low-priority items.

Use `/refactor [file]` for structural fixes. Use `/implement [fix]` or planner + worker for security/feature fixes.
