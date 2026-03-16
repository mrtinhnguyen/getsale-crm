# Project Audit Report — Full System Audit 2026-03-16

**Date:** 2026-03-16  
**Scope:** Full project (services/, shared/, frontend/app/)  
**Audited by:** senior-reviewer + security-auditor + reviewer

---

## Executive Summary

**Overall Health Score:** 2.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 2           | 0        | 0            | **2** |
| High     | 4           | 3        | 3            | **10** |
| Medium   | 4           | 5        | 6            | **15** |
| Low      | 4           | 5        | 6            | **15** |

**Recommendation:** Address 2 critical architecture issues first (shared DB/table ownership, auth-service sync dependency on pipeline). Then prioritize High findings (repository layer, tenant isolation, god modules, refresh rate limit, gateway header trust, Stripe webhook rate limit, messaging/bd-accounts code quality).

---

## Critical Issues (fix immediately)

### [A1] Shared ownership of `messages` and cross-service table access
**Category:** Architecture  
**Location:** `services/messaging-service` (routes/messages.ts, helpers, conversation-deals, shared-chats), `services/bd-accounts-service` (routes/accounts.ts, telegram/event-handlers.ts, message-db.ts, telegram-manager.ts).  
**Impact:** Two services independently INSERT/UPDATE/DELETE on `messages`; messaging-service also writes to `bd_account_sync_chats` and `conversations`; campaign-service and bd-accounts read/write `conversations` / `bd_account_sync_chats`. No single owner per table → risk of conflicting writes, unclear consistency and migration ownership.  
**Fix:** Assign a single owner per table (e.g. messaging owns `messages` and `conversations`; bd-accounts owns `bd_accounts` and `bd_account_sync_*`). Other services should use events or internal APIs only; avoid direct DB access to another service’s tables.

### [A2] Auth-service synchronously depends on pipeline-service for signup
**Category:** Architecture  
**Location:** `services/auth-service/src/index.ts`, `services/auth-service/src/routes/auth.ts` (signup flow), `services/pipeline-service/src/routes/internal.ts` (POST `/internal/pipeline/default-for-org`).  
**Impact:** Creating a default pipeline is done via HTTP during signup. Pipeline unavailability or slowness blocks or degrades user registration.  
**Fix:** Decouple: e.g. emit `organization.created` (or similar) from auth and have pipeline-service create the default pipeline asynchronously; or make pipeline creation best-effort and retry in background.

---

## High Priority Issues (fix soon)

### Architecture
- **[A3]** No repository layer; routes mix HTTP, validation, and data access — all `services/*/src/routes/*.ts`. Introduce repository/data layer per aggregate; keep routes thin.
- **[A4]** Inconsistent tenant isolation (RLS vs application-level only) — `withOrgContext` used only in crm-service and one helper in messaging; other services rely only on `organization_id` in WHERE. Use RLS and `withOrgContext` for all tenant-scoped DB access.
- **[A5]** God module: `services/messaging-service/src/routes/messages.ts` (~600 lines). Split by use case (list/history, send, status/reactions, delete) into smaller modules.
- **[A6]** Very large modules in bd-accounts-service: `telegram/chat-sync.ts` (~1550 lines), `telegram-manager.ts` (thousands of lines). Split by responsibility; single TelegramManager facade.

### Security
- **[S1]** Refresh token rate limit uses `req.ip` instead of client IP — `services/auth-service/src/routes/auth.ts`. Use `getClientIp(req)` for refresh rate-limit key.
- **[S2]** Backend user context comes only from gateway headers — `shared/service-core/src/middleware.ts`. Keep `INTERNAL_AUTH_SECRET` mandatory; ensure backends are never exposed to internet; optionally verify signed assertion from gateway.
- **[S3]** Stripe webhook path has no rate limiting — `services/api-gateway/src/index.ts`. Add separate, generous rate limit for webhook path (e.g. by Stripe IP or higher limit per IP).

### Code Quality
- **[Q1]** Long handler with duplicated logic in GET `/messages` — `services/messaging-service/src/routes/messages.ts` (~165 lines). Extract helpers (exhausted/history, build query, count); keep route as orchestration.
- **[Q2]** Heavy use of `any` and swallowed errors in bd-accounts-service Telegram code — chat-sync.ts, telegram-manager.ts, event-handlers.ts, etc. Add minimal types; type errors as `unknown` and log in catch blocks.
- **[Q3]** Duplicated entity-scoped routes (contact vs deal) in notes.ts and reminders.ts — `services/crm-service`. Introduce helper or single param route `/:entityType(contact|deal)/:entityId/notes` to avoid duplicate blocks.

---

## Medium Priority Issues (plan for next sprint)

### Architecture
- **[A7]** Single shared database and schema for all services. Document ownership of schemas/tables; avoid cross-service table access (see A1).
- **[A8]** Event schema and evolution not explicitly versioned — `shared/events`, `shared/utils/rabbitmq.ts`. Add version/schema id to payloads or routing; document compatibility.
- **[A9]** Dense mesh of synchronous HTTP between services. Prefer events for fire-and-forget; reserve HTTP for request/response that need immediate answers.
- **[A10]** RLS/withOrgContext not used in pipeline, bd-accounts, automation, campaign, auth. Align with A4: enable RLS and use `withOrgContext` everywhere tenant data is accessed.

### Security
- **[S4]** Notes DELETE relies only on RLS for tenant isolation — `services/crm-service/src/routes/notes.ts`. Add explicit `organization_id` in WHERE for defense-in-depth.
- **[S5]** Subscription upgrade input not validated with Zod — `services/user-service/src/routes/subscription.ts`. Add Zod schema for plan/paymentMethodId.
- **[S6]** Pipeline leads POST has no Zod validation — `services/pipeline-service/src/routes/leads.ts`. Define Zod schema for create-lead body.
- **[S7]** Public invite GET has no rate limiting — gateway and auth-service `GET /:token`. Add rate limiting per IP; validate token format/length.
- **[S8]** Invite and refresh token params/body not schema-validated — `services/auth-service/src/routes/invites.ts`. Validate token via Zod or sanitize before logging.

### Code Quality
- **[Q4]** Inconsistent pagination/query parsing across route files. Use shared `parseLimit`/`parsePageLimit` from service-core or helpers.
- **[Q5]** Pipeline leads POST has no Zod — same as S6; add LeadCreateSchema.
- **[Q6]** GET list endpoints without query validation — e.g. discovery-tasks GET. Use parseLimit and safe offset helper or Zod query schema.
- **[Q7]** Event payload cast to `any` — ai-service drafts.ts, crm-service discovery-tasks. Use correct event type from @getsale/events or extend event type.
- **[Q8]** Frontend: console instead of logger/reporter in dashboard. Use existing `reportError()` or logger wrapper.
- **[Q9]** Row/result typed as `any` — bd-accounts-service routes/accounts.ts. Define interface for selected columns.

---

## Low Priority / Suggestions

### Architecture
- **[A11]** Frontend dashboard API usage not behind a dedicated API layer. Optional: add API module wrapping apiClient with typed methods.
- **[A12]** Permission checks hit DB on every request — `shared/service-core/src/middleware.ts`. Cache role_permissions (e.g. Redis or in-memory with TTL).
- **[A13]** Graceful shutdown inconsistent in bd-accounts-service — manual process.on vs service-core ctx.start(). Use createServiceApp shutdown hook and register telegramManager.shutdown() in onShutdown.
- **[A14]** Possible duplicate TelegramManager entry point — telegram/index.ts vs telegram-manager.ts. Confirm canonical source; single public TelegramManager.

### Security
- **[S9]** CSP allows `unsafe-inline` for scripts and styles — api-gateway. Move to nonces or hashes; remove unsafe-inline where possible.
- **[S10]** Theme script via `dangerouslySetInnerHTML` — frontend layout.tsx. Prefer separate file or nonce-based inline.
- **[S11]** Auth state persisted in localStorage — acceptable; optionally avoid persisting sensitive fields.
- **[S12]** Demo seed logs password to console — migrations/seeds. Log only in development or remove.
- **[S13]** Validation error details returned to client. In production consider generic “Validation failed” and log details server-side.

### Code Quality
- **[Q10]** Notes DELETE has no param schema for id (e.g. UUID). Add route-level param schema.
- **[Q11]** useMessagingData hook length and dependency array — split into smaller hooks; fix dependency arrays.
- **[Q12]** Naming: `chatsFromDB` vs response shape in useMessagingData — rename to chatsFromApi or rawChats.
- **[Q13]** service-app.ts uses `(req as any).rawBody` — extend Express Request with rawBody in shared types.
- **[Q14]** analytics-service period from query unvalidated — use Zod enum or isPeriodKey guard.
- **[Q15]** Test coverage gaps for routes — add route-level tests for messaging send/delete/mark-read, pipeline leads, bd-accounts messaging/sync, reminders, notes, discovery-tasks.

---

## Priority Matrix

| ID | Issue | Severity | Effort | Priority |
|----|-------|----------|--------|----------|
| A1 | Shared ownership of messages / cross-service table access | Critical | High | P0 — now |
| A2 | Auth-service sync dependency on pipeline for signup | Critical | Medium | P0 — now |
| A3 | No repository layer; routes mix concerns | High | High | P1 — sprint |
| A4 | Inconsistent tenant isolation (RLS) | High | Medium | P1 — sprint |
| S1 | Refresh rate limit uses req.ip | High | Low | P1 — sprint |
| S2 | Backend trusts gateway headers only | High | Medium | P1 — sprint |
| S3 | Stripe webhook no rate limiting | High | Low | P1 — sprint |
| A5 | God module messages.ts | High | Medium | P1 — sprint |
| A6 | God modules bd-accounts Telegram | High | High | P1 — sprint |
| Q1 | Long GET /messages handler | High | Medium | P1 — sprint |
| Q2 | any and swallowed errors in bd-accounts | High | Medium | P1 — sprint |
| Q3 | Duplicated notes/reminders contact vs deal | High | Low | P1 — sprint |

---

## Comparison with Audit 2026-03-15

### Closed / Improved since previous audit
- **Observability:** `/ready` endpoints, `event_publish_failed_total` metric, Redis ping for health — in place.
- **Security:** JWT explicit HS256, CSP in API Gateway, Zod on many endpoints (auth, campaign, pipeline, bd-accounts, crm, team, ai, user) — done.
- **Tenant isolation:** `withOrgContext` used in crm (companies, contacts, notes, reminders, deals), messaging (attachLead), pipeline internal API, automation SLA cron — improved.
- **CorrelationId:** BaseEvent and propagation to events across services — done.
- **Reliability:** Retry for HTTP clients (campaign → messaging/bd-accounts, messaging → bd-accounts) — done.
- **Frontend:** Global error boundary with i18n, Sentry @sentry/browser lazy init, bd-accounts useBdAccountsConnect and ConnectModal — done.
- **Types:** Campaign event types in Event union, reduced (req as any) and catch (err: unknown) in crm — done.

### Still open (from REMEDIATION_STATUS 2026-03-15)
- **Zod** on remaining endpoints: pipeline leads POST (still flagged as S6/Q5), user-service subscription upgrade (S5), auth invite token validation (S8), discovery-tasks/analytics query params (Q6, Q14).
- **correlationId** in places without `req` (bd-accounts telegram-manager, message-sync, event-handlers; ai-service on event) — not yet done.
- **RLS:** withOrgContext not used in pipeline, bd-accounts, automation, campaign, auth (A4, A10); notes DELETE explicit org filter (S4).
- **Metrics:** RabbitMQ queue depth metrics and alerts — not in code.
- **CORS:** WebSocket CORS check not tightened.
- **Retry/circuit breaker** for AI and other external API calls outside campaign/messaging — not unified.
- **bd-accounts refactor:** Dialogs modal and useBdAccountsList — backlog.
- **Strategic:** Shared DB ownership (A1), messages table growth/partitioning, alerts/thresholds, documentation and test discipline — still relevant.

### New in this audit (2026-03-16)
- **A2:** Auth-service synchronous dependency on pipeline during signup — explicit critical finding (decouple with events or best-effort).
- **S1:** Refresh token rate limit key (req.ip vs getClientIp) — not in previous report.
- **S2:** Backend trust in gateway headers only — explicit high finding.
- **S3:** Stripe webhook rate limiting — explicit.
- **Security:** Notes DELETE defense-in-depth (S4), subscription/invite validation (S5, S7, S8).
- **Quality:** Long GET /messages handler (Q1), any/swallowed errors in bd-accounts (Q2), duplicated notes/reminders (Q3), pagination/query validation (Q4, Q6), event payload types (Q7), frontend console vs reporter (Q8), test coverage gaps (Q15).
- **Architecture:** Single TelegramManager entry point and shutdown consistency (A13, A14).

### Summary
- **Health Score:** Previous audit (2026-03-15) reported maturity 5.5–6/10 at product level; this run uses the audit-workflow formula (Critical/High/Medium/Low counts) → **2.0/10**, reflecting 2 Critical and 10 High findings in code/structure.
- **Critical:** 2 (both architecture: A1, A2). No critical security in this run.
- **Priorities:** First fix A1 and A2; then High (tenant isolation, rate limits, gateway trust, god modules, code quality in messaging/bd-accounts).

---

## Recommended Plan of Work

### 1. Immediate (P0)
- **[A1]** Define and document table ownership; restrict cross-service DB access to events/internal APIs. Refactor messaging/bd-accounts/campaign to use only owned tables or shared APIs. *Route:* planner + worker (design first), then refactor where structural.
- **[A2]** Decouple signup from pipeline: emit event (e.g. `organization.created`) from auth-service; pipeline-service (or job) creates default pipeline asynchronously; or make HTTP call best-effort with background retry. *Route:* planner + worker.

### 2. This sprint (P1)
- **[S1]** Use `getClientIp(req)` for refresh token rate-limit key in auth-service.
- **[S3]** Add rate limiting for Stripe webhook path in api-gateway.
- **[S2]** Document INTERNAL_AUTH_SECRET requirement and no direct backend exposure; optionally add signed assertion from gateway.
- **[A4]/[A10]** Extend `withOrgContext` (or equivalent) to pipeline, bd-accounts, automation, campaign for tenant-scoped DB access; add RLS where missing.
- **[S4]** Add explicit `organization_id` to notes DELETE WHERE in crm-service.
- **[S5], [S6], [Q5]** Zod for subscription upgrade (user-service), pipeline leads POST (pipeline-service).
- **[S7], [S8]** Rate limit and token validation for invite endpoints.
- **[A5], [Q1]** Split messages route into smaller modules; extract GET /messages helpers.
- **[A6], [Q2]** Reduce any/swallowed errors in bd-accounts Telegram code; split large modules where feasible.
- **[Q3]** Unify notes/reminders entity routes with helper or single param route.

### 3. Next sprint (P2)
- **[A3]** Introduce repository (or data) layer for key aggregates; thin routes.
- **[A7], [A8], [A9]** Document DB/schema ownership; add event versioning; document and trim sync HTTP dependencies.
- **[Q4], [Q6], [Q14]** Shared pagination/query validation (parseLimit, Zod query schemas).
- **[Q7]** Type event payloads; remove `as any` in ai-service and crm-service.
- **[Q8]** Frontend: use reportError() instead of console in dashboard.
- **[Q9]** Type bd-accounts account result rows.
- **Backlog from 2026-03-15:** RabbitMQ queue depth metrics and alerts; CORS WebSocket; retry/circuit breaker for AI; bd-accounts Dialogs/useBdAccountsList.

### 4. Backlog (P3)
- **[A11]–[A14], [S9]–[S13], [Q10]–[Q15]** Low-priority items: frontend API layer, permission caching, shutdown consistency, TelegramManager single entry, CSP nonces, demo seed logging, validation error details, param schemas, hook split, analytics period validation, test coverage.
- **Strategic:** Partitioning/archiving for `messages`, distributed tracing, idempotency keys, documentation and test discipline.

---

## Remediation applied (2026-03-16)

Выполнено в рамках первой сессии исправлений по отчёту.

### Сделано (сессия 1)

| ID | Задача | Где |
|----|--------|-----|
| **S1** | Refresh token rate limit по клиентскому IP | `services/auth-service/src/routes/auth.ts` — в маршруте `POST /refresh` используется `getClientIp(req)` вместо `req.ip` |
| **S3** | Rate limit для Stripe webhook | `services/api-gateway`: добавлен `createWebhookRateLimit(redis)` в `rate-limit.ts`, на путь `/api/users/stripe-webhook` повешен `webhookRateLimit` (60 req/min per IP) |
| **S4** | Явный фильтр по organization_id при удалении заметки | `services/crm-service/src/routes/notes.ts` — `DELETE /notes/:id`: в запрос добавлено `AND organization_id = $2` |
| **S5** | Zod для subscription upgrade | `services/user-service/src/routes/subscription.ts` — схема `UpgradeSchema` (plan, paymentMethodId optional), `validate(UpgradeSchema)` на `POST /subscription/upgrade` |
| **S6 / Q5** | Zod для создания лида | `services/pipeline-service/src/routes/leads.ts` — схема `LeadCreateSchema` (contactId, pipelineId UUID; stageId, responsibleId optional UUID), `validate(LeadCreateSchema)` на `POST /leads` |

### Сделано (сессия 2)

| ID | Задача | Где |
|----|--------|-----|
| **S7** | Rate limit для invite | `services/api-gateway`: `createInviteRateLimit(redis)` в `rate-limit.ts`, на `/api/invite` повешен `inviteRateLimit` (30 req/min per IP) |
| **S8** | Валидация токена invite | `services/auth-service/src/routes/invites.ts` — схема `InviteTokenParamSchema` (token: 1–512 символов, `[a-zA-Z0-9_-]+`), `parseInviteToken(req.params)` в GET `/:token` и POST `/:token/accept` |
| **S2** | Документация INTERNAL_AUTH_SECRET и доступа к бэкендам | `docs/DEPLOYMENT.md` — раздел «Безопасность: gateway и бэкенды» (обязательность секрета в production, запрет прямого доступа к бэкендам); `docs/INTERNAL_API.md` — ссылка на этот раздел |

### Сделано (сессия 3)

| ID | Задача | Где |
|----|--------|-----|
| **Q3** | Объединение маршрутов notes/reminders через хелперы | `services/crm-service`: в `helpers.ts` добавлены `getNotesForEntity`, `insertNote`, `getRemindersForEntity`, `insertReminder` (entityType: contact \| deal). Роуты notes.ts и reminders.ts переведены на эти хелперы; дублирование убрано. В `DELETE /reminders/:id` добавлен явный фильтр `AND organization_id = $2` |
| **A4** (pipeline) | `withOrgContext` для мутаций в pipeline-service | `services/pipeline-service`: в `leads.ts` — POST /leads (insert), PATCH /leads/:id (update), DELETE /leads/:id (soft delete) обёрнуты в `withOrgContext`. В `stages.ts` — POST, PUT, DELETE обёрнуты в `withOrgContext`. В `pipelines.ts` — POST, PUT, DELETE обёрнуты в `withOrgContext` |

### Сделано (сессия 4)

| ID | Задача | Где |
|----|--------|-----|
| **A4** (automation) | `withOrgContext` для создания правила | `services/automation-service/src/routes/rules.ts` — POST /rules (INSERT automation_rules) обёрнут в `withOrgContext` |
| **A4** (campaign) | `withOrgContext` для мутаций в campaign-service | `services/campaign-service`: в `campaigns.ts` — POST / (create campaign), PATCH /:id (update, в т.ч. onlyStop), DELETE /:id (soft delete), POST /presets (create template) обёрнуты в `withOrgContext`. В `execution.ts` — POST /:id/pause обёрнут в `withOrgContext` |

### Сделано (сессия 5)

| ID | Задача | Где |
|----|--------|-----|
| **A4** (bd-accounts) | `withOrgContext` для мутаций в bd-accounts-service | `services/bd-accounts-service/src/routes/accounts.ts`: POST /purchase (INSERT bd_accounts), PATCH /:id (UPDATE с явным organization_id в WHERE), PUT /:id/config (UPDATE), POST /:id/enable (UPDATE is_active с organization_id в WHERE), DELETE /:id (каскадные DELETE и UPDATE messages внутри одной транзакции withOrgContext; DELETE bd_accounts с organization_id в WHERE). В enable убран `as any` у row, добавлена типизация |

### Сделано (сессия 6)

| ID | Задача | Где |
|----|--------|-----|
| **A5, Q1** | Разбиение маршрута messages и хелперы GET /messages | `services/messaging-service`: добавлен `src/messages-list-helpers.ts` с `buildMessagesListWhere`, `runMessagesCount`, `runMessagesListQuery`, `getHistoryExhausted`, `maybeLoadInitialHistory`, `maybeLoadOlderHistoryAndGetTotal`, `enrichMessagesWithSenderNames`. Обработчик GET /messages в `routes/messages.ts` переведён на эти хелперы (~165 строк логики заменены на оркестрацию ~50 строк) |

### Сделано (сессия 7)

| ID | Задача | Где |
|----|--------|-----|
| **A6, Q2** | Меньше `any` и проглатывания ошибок в bd-accounts Telegram | В `services/bd-accounts-service/src/helpers.ts` добавлены `getErrorMessage(err: unknown)` и `getErrorCode(err: unknown)`. Все пустые `catch (_) {}` заменены на логирование: в `event-handlers.ts` — debug-логи при регистрации/выполнении хендлеров; в `contact-manager.ts` — warn при сбое upsert; в `chat-sync.ts` — debug при сбое getInputEntity в пагинации; в `qr-login.ts` — debug при disconnect после ошибки. В `connection-manager.ts`, `message-handler.ts`, `message-sender.ts`, `event-handlers.ts` заменены `catch (e: any)` на `catch (e: unknown)` с использованием `getErrorMessage(e)` для логирования. В `connection-manager.ts` типизирован `result.rows.map((row: { id: string }) => row.id)`. Крупные модули (chat-sync, telegram-manager) не разбивались — остаётся по желанию. |

### Сделано (сессия 8)

| ID | Задача | Где |
|----|--------|-----|
| **A2** | Decoupling signup от pipeline | В `shared/events` добавлены `OrganizationCreatedEvent` и тип в union `Event`. Auth-service: при создании новой организации публикуется `ORGANIZATION_CREATED` (organizationId, name, slug); синхронный вызов pipeline-service удалён, зависимость от `pipelineClient` убрана из auth (index, authRouter, тесты). Pipeline-service: добавлены `default-pipeline.ts` (createDefaultPipelineForOrg, идемпотентно) и `event-handlers.ts` (подписка на `ORGANIZATION_CREATED`); внутренний endpoint `POST /internal/pipeline/default-for-org` переведён на использование createDefaultPipelineForOrg. Регистрация больше не блокируется недоступностью pipeline. |

### Сделано (сессия 9)

| ID | Задача | Где |
|----|--------|-----|
| **A1 (этап 1)** | Владение таблицами messages/conversations: API + вызов из bd-accounts | Документ [TABLE_OWNERSHIP_A1.md](../TABLE_OWNERSHIP_A1.md): назначение владельцев таблиц и поэтапный план миграции. Messaging-service: добавлен внутренний роутер `routes/internal.ts` — `POST /internal/conversations/ensure`, `POST /internal/messages` (Zod-валидация, идемпотентный upsert); монтируется на `/internal`. Bd-accounts-service: в `MessageDb` опциональный параметр `messagingClient`; при его наличии `ensureConversation` и `saveMessageToDb` выполняются через HTTP к messaging-service. В index создаётся `ServiceHttpClient` к `MESSAGING_SERVICE_URL` и передаётся в `TelegramManager` → `MessageDb`. Создание conversation и message при приёме/отправке Telegram идёт через messaging; удаление и редактирование по событиям Telegram пока остаются прямыми запросами к `messages` в bd-accounts (этап 2 в бэклоге). |

### Остаётся сделать

**Немедленно (P0):**
- **[A1]** Этапы 2–4: удаление/редактирование сообщений в bd-accounts перевести на вызовы API messaging; messaging перестать писать/читать `bd_account_sync_*` (через API bd-accounts или иначе). См. [TABLE_OWNERSHIP_A1.md](../TABLE_OWNERSHIP_A1.md).

**Ближайший спринт (P1):**
- **[A4]/[A10]** По отчёту A4 закрыт для pipeline, automation, campaign, bd-accounts (accounts.ts). Оставшиеся мутации: bd-accounts (sync.ts, auth.ts), campaign (execution start, participants-bulk, from-csv, templates, sequences) — по желанию.
- **[A6], [Q2]** (частично закрыто) Разбиение крупных модулей bd-accounts (chat-sync.ts, telegram-manager.ts) — по желанию; типизация GramJS-объектов и оставшиеся `as any` в telegram-serialize/chat-sync — при необходимости.

**Далее (P2/P3):** см. разделы «Next sprint» и «Backlog» в плане выше.

---

*Report generated from full system audit 2026-03-16. Remediation: session 1 — S1, S3, S4, S5, S6/Q5; session 2 — S7, S8, S2 (docs); session 3 — Q3, A4 (pipeline); session 4 — A4 (automation, campaign); session 5 — A4 (bd-accounts accounts.ts); session 6 — A5, Q1 (messages-list-helpers, GET /messages refactor); session 7 — A6, Q2 (getErrorMessage/getErrorCode, no empty catch, catch (unknown) in bd-accounts Telegram); session 8 — A2 (ORGANIZATION_CREATED, pipeline async default); session 9 — A1 этап 1 (internal messaging API, bd-accounts MessageDb → HTTP).*
