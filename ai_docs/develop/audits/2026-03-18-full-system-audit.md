# Project Audit Report — Full System Audit 2026-03-18

**Date:** 2026-03-18  
**Scope:** Full project (services/, shared/, frontend/app/)  
**Audited by:** senior-reviewer + security-auditor + reviewer

---

## Executive Summary

**Overall Health Score:** 4.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 1           | 0        | 0            | **1** |
| High     | 4           | 3        | 4            | **11** |
| Medium   | 4           | 3        | 6            | **13** |
| Low      | 3           | 6        | 6            | **15** |

**Recommendation:** Address the remaining Critical item A1 (cross-service table access: bd-accounts writing to messages on account delete; messaging still reading bd_account_sync_chats in some paths). Then prioritize High: A3 (repository layer), A4/A10 (withOrgContext in messaging), A5 (split chats.ts), A6 (god modules bd-accounts), S1–S3, Q1–Q4.

---

## Critical Issues (fix immediately)

### [A1] Cross-service table access / shared table ownership

**Category:** Architecture  
**Location:** `services/bd-accounts-service/src/routes/accounts.ts` (lines 326–331), `services/messaging-service/src/routes/chats.ts` (e.g. 184, 235), `services/messaging-service/src/messages-list-helpers.ts` (93, 173).  
**Impact:** bd-accounts still performs direct `UPDATE messages SET bd_account_id = NULL` and deletes from `bd_account_sync_*` on account delete; messaging-service still reads `bd_account_sync_chats` (JOIN/SELECT) when listing chats without `bdAccountId` and in `getHistoryExhausted` / `enrichMessagesWithSenderNames`. Two services touch each other's logical tables → consistency, migration ownership, and RLS are unclear.  
**Fix:** (1) Move "orphan messages on account delete" to messaging-service (e.g. internal API or event `bd_account.disconnected`); bd-accounts should not write to `messages`. (2) Finish table-ownership migration per [TABLE_OWNERSHIP_A1.md](../TABLE_OWNERSHIP_A1.md): have messaging get chat/sync data only via bd-accounts internal API for all code paths that still read `bd_account_sync_chats`.

---

## High Priority Issues (fix soon)

### Architecture

- **[A3]** No repository layer; routes mix HTTP, validation, and data access — All `services/*/src/routes/*.ts`. **Fix:** Introduce repository (or data) layer per aggregate; keep routes thin.
- **[A4]** Inconsistent tenant isolation — Messaging-service does not use `withOrgContext`; only `organization_id` in WHERE. **Fix:** Use `withOrgContext(pool, req.user.organizationId, ...)` for all tenant-scoped DB access in messaging-service.
- **[A5]** Large messaging route modules — `chats.ts` ~385 lines with many handlers and raw SQL. **Fix:** Split by use case (e.g. chats-list.ts, chats-pinned.ts, chats-stats.ts).
- **[A6]** God class and very large modules in bd-accounts Telegram — `telegram-manager.ts` (thousands of lines), `telegram/chat-sync.ts`. **Fix:** Extract cohesive pieces; keep TelegramManager as facade; split chat-sync by responsibility.

### Security

- **[S1]** Internal API trusts body.organizationId — `services/messaging-service/src/routes/internal.ts`. Callers send `organizationId` in body for `/internal/conversations/ensure` and `/internal/messages`. **Fix:** Use `X-Organization-Id` from gateway where possible, or verify `bd_account_id` belongs to given org.
- **[S2]** bd-accounts writes to `messages` on account delete — `services/bd-accounts-service/src/routes/accounts.ts` (327–331). **Fix:** Move cleanup to messaging-service or formalize single-owner contract.
- **[S3]** INTERNAL_AUTH_SECRET optional outside production — In dev/staging, unset secret can leave internal routes less protected. **Fix:** Set non-default secret in all envs where backends are reachable; document in deployment.

### Code Quality

- **[Q1]** Long handler (GET /chats) — `services/messaging-service/src/routes/chats.ts` (~200 lines). **Fix:** Split into buildSyncListQuery, runSyncListQuery, buildDefaultChatsQuery and short handler.
- **[Q2]** Empty catch blocks — `services/bd-accounts-service/src/telegram-manager.ts` (many locations). **Fix:** Replace with at least log.debug/log.warn or helper that logs and optionally rethrows.
- **[Q3]** Heavy `any` in Telegram integration — telegram-manager, event-handlers, chat-sync, message-sync, file-handler, contact-manager. **Fix:** Introduce minimal types; use `unknown` + type guards instead of `(x as any)`.
- **[Q4]** Repeated "filter to Api.Message" logic — message-sync.ts, telegram-manager.ts. **Fix:** Extract shared helper e.g. `filterToApiMessages(raw: unknown): Api.Message[]`.

---

## Medium Priority Issues (plan for next sprint)

### Architecture

- **[A7]** Single shared database and schema — Table ownership in TABLE_OWNERSHIP_A1.md but not fully enforced (see A1). Document and enforce.
- **[A8]** Event schema not versioned — `shared/events`, rabbitmq. Add version/schema id to payloads or routing.
- **[A9]** Dense synchronous HTTP — Prefer events for fire-and-forget where possible.
- **[A10]** RLS/withOrgContext not used in messaging-service — Align with A4.

### Security

- **[S4]** Messaging edit/delete-by-telegram don't check org — internal.ts. Require or use `X-Organization-Id` and verify message's org.
- **[S5]** Validation errors can leak structure — internal.ts responses include Zod parsed.error.message. In production return generic "Validation failed"; log details server-side only.
- **[S6]** Auth-store in localStorage — Acceptable; avoid storing tokens or extra PII.

### Code Quality

- **[Q5]** Repeated peerType from Telegram chat — Extract getPeerType(chat) in shared telegram helpers.
- **[Q6]** Pagination logic duplicated across services — Move shared parseLimit/parseOffset + response shape to shared or service-core.
- **[Q7]** apiClient used directly in components — Add lib/api/ modules (settings, team, analytics, bd-accounts, messaging); route all API calls through them.
- **[Q8]** Discovery page over 300 lines — Split into subcomponents and hooks (useDiscoveryTasks, useParseFlow).
- **[Q9]** values: any[] in bulk inserts — `services/crm-service/src/routes/contacts.ts`. Type as (string | null)[] or typed tuples.
- **[Q10]** Shared types use `any` — shared/types (TriggerCondition.value, TriggerAction.params). Replace with unknown or concrete types.

---

## Low Priority / Suggestions

### Architecture

- **[A11]** Frontend dashboard API not behind dedicated API layer — Optional: add API module wrapping apiClient with typed methods.
- **[A12]** Permission checks hit DB — Addressed (in-memory cache 1 min TTL).
- **[A13]** Graceful shutdown in bd-accounts — Rely on createServiceApp lifecycle; avoid ad-hoc process handlers where possible.
- **[A14]** Duplicate TelegramManager entry — telegram/index.ts vs telegram-manager.ts; confirm canonical export and document.

### Security

- **[S7]** WebSocket CORS — Prod enforces CORS_ORIGIN.
- **[S8]** Auth rate limiting — In place.
- **[S9]** Stripe webhook — Signature verified.
- **[S10]** Passwords — bcrypt cost 12.
- **[S11]** AppError — Details omitted in production.
- **[S12]** Invite tokens — Validated with Zod + DB + expiry.
- **[S13]** Pipeline internal — Uses X-Organization-Id header only.
- **[S14]** bd-accounts internal sync-chats — Uses header and validates account belongs to org.

### Code Quality

- **[Q11]** err: any / e: any in catch — Use catch (err: unknown) and narrow with type guards (frontend and services).
- **[Q12]** Inline style for progress bar — discovery/page.tsx; prefer Tailwind or ProgressBar component.
- **[Q13]** Settings: window.confirm / alert — Replace with modal/confirm and toast.
- **[Q14]** No route tests for several services — Add at least one integration or route test per critical path.
- **[Q15]** Defensive rows[0] access — Use result.rows[0]?.total or check length before use.
- **[Q16]** Duplicate COALESCE in SQL — chats.ts; extract SQL fragment or DB function.

---

## Documentation Audit (2026-03-18)

### Structure and usage

- **ai_docs/** — Only `develop/audits/` and `develop/TABLE_OWNERSHIP_A1.md` are actively populated. Config paths `plans/`, `reports/`, `issues/`, `architecture/`, `features/`, `api/`, `components/` exist in config but most directories are empty or unused.
- **docs/** — Core docs present: ARCHITECTURE.md, STATE_AND_ROADMAP.md, INTERNAL_API.md, DEPLOYMENT.md, TESTING.md, GETTING_STARTED.md, MESSAGING_ARCHITECTURE.md, CAMPAIGNS.md, STAGES.md, MIGRATIONS.md, EVENT_HANDLER_POLICY.md.

### Findings

- **Single source of truth:** STATE_AND_ROADMAP and FULL_SYSTEM_AUDIT_2026 (in docs/) overlap with PROJECT_AUDIT_REPORT and with audit reports in ai_docs. Recommendation: keep STATE_AND_ROADMAP as product/roadmap state; keep code audits only in ai_docs/develop/audits/; reference "latest code audit" from docs if needed.
- **Accuracy:** TABLE_OWNERSHIP_A1.md is up to date (stages 1–4 done; optional remaining paths). INTERNAL_API.md describes public and cross-service API but **does not list internal-only endpoints**: messaging `POST /internal/conversations/ensure`, `POST /internal/messages`, `PATCH /internal/messages/edit-by-telegram`, `POST /internal/messages/delete-by-telegram`; bd-accounts `GET /internal/sync-chats`; pipeline `POST /internal/pipeline/default-for-org`. **Action:** Add a section "Internal-only endpoints (service-to-service)" in INTERNAL_API.md with method, path, and brief description.
- **Completeness:** Deployment and gateway/backend security are documented in DEPLOYMENT.md. Glossary/terminology is scattered (STATE_AND_ROADMAP, ARCHITECTURE). Optional: add a short glossary (lead, deal, conversation, bd_account, etc.) in GETTING_STARTED or ARCHITECTURE.
- **Cross-references:** REMEDIATION_STATUS_2026-03-15 and audit reports reference each other; 2026-03-17 report references TABLE_OWNERSHIP_A1. Adequate.

### Recommendations

1. Add internal-only endpoints to INTERNAL_API.md (messaging internal, bd-accounts internal, pipeline internal).
2. Remove or shorten duplicate audit docs in docs/ (see section 4 below).
3. Optionally create ai_docs/develop/plans/ and add a single "current improvement plan" file that links to this audit and lists A3, A6, S15, S16, Q23 as next priorities.

---

## Comparison with Previous Audits

| Audit     | Health | Critical | High | Key changes |
|-----------|--------|----------|------|-------------|
| 2026-03-15 | 0.0  | 3 (RLS, /ready, attachLead) | 12 | Baseline fixes |
| 2026-03-16 | 2.0  | 2 (A1, A2) | 10 | S1–S8, A2 decoupling, A4/A5/Q1–Q3, A1 stage 1 |
| 2026-03-17 | 4.0  | 0 (A1 closed) | 15 | A1 stages 2–4, S9–S11, A4–A8, Q16–Q22, A5, S13 |
| **2026-03-18** | **4.0** | **1** (A1 residual) | **11** | Fresh pass; A1 residual gaps (accounts delete, messaging reads sync_chats); S1–S3, Q1–Q4 re-flagged |

### Closed since last audit (2026-03-17)

- A1 stages 2–4 implemented (edit/delete via internal API; messaging does not write to bd_account_sync_chats; bd-accounts GET /internal/sync-chats; messaging uses API when bdAccountId context present). Residual: accounts.ts UPDATE messages on delete; messaging GET /chats without bdAccountId and GET /search still JOIN bd_account_sync_chats.
- A2 (auth→pipeline) — decoupled via ORGANIZATION_CREATED event.
- S9, S10, S11 (pipeline org from header, withOrgContext in sync/campaign, canPermission cache).
- A5 (messages.ts split), A7 (canPermission cache), S13 (AppError details in prod), Q16–Q22, Q24–Q28 from 2026-03-17.

### Still open

- **A1 residual** — Orphan messages on account delete (bd-accounts → messaging); messaging read paths without bdAccountId still using bd_account_sync_chats.
- **A3** — Repository layer (High).
- **A4, A10** — withOrgContext in messaging-service (High).
- **A5** — Split chats.ts (High).
- **A6** — God modules bd-accounts Telegram (High).
- **S1–S3** — Internal API org from body; bd-accounts writes to messages; INTERNAL_AUTH_SECRET in non-prod (High).
- **Q1–Q4** — Long chats handler, empty catch, any in Telegram, duplicated message filter (High).
- **S15, S16** — CSP unsafe-inline, theme script dangerouslySetInnerHTML (Medium).
- **Q23** (useMessagingData split) and remaining Medium/Low from 2026-03-17.

### New in this audit (2026-03-18)

- Explicit **A1 residual** (accounts.ts UPDATE messages; messaging chats/list-helpers reading bd_account_sync_chats in all paths).
- **S1** — Internal API body.organizationId trust (messaging internal routes).
- **S2** — bd-accounts writes to messages on delete (same as A1 residual, security angle).
- **S3** — INTERNAL_AUTH_SECRET optional outside production.
- **Q1** — Long GET /chats handler (chats.ts).
- **Q4** — Repeated filter-to-Api.Message logic.
- Documentation audit section and recommendation to add internal endpoints to INTERNAL_API.md.

---

## Priority Matrix

| ID  | Issue | Severity | Effort | Priority |
|-----|-------|----------|--------|----------|
| A1  | Cross-service table access (accounts delete + messaging read paths) | Critical | Medium | P0 |
| S1  | Internal API: org only from header | High | Low | P1 |
| S2  | bd-accounts → messaging for message cleanup on delete | High | Medium | P1 |
| A3  | Repository layer | High | High | P1 |
| A4/A10 | withOrgContext in messaging | High | Medium | P1 |
| A5  | Split chats.ts | High | Medium | P1 |
| A6  | Split TelegramManager / chat-sync | High | High | P1 |
| Q1  | Long GET /chats handler | High | Medium | P1 |
| Q2–Q4 | Empty catch, any, duplicated filter | High | Medium | P1 |
| S15/S16 | CSP, theme script | Medium | Medium | P2 |
| Q5–Q10 | DRY, API layer, discovery size, types | Medium | Various | P2 |
| Doc | INTERNAL_API internal endpoints | — | Low | P2 |

---

## Next Steps / Plan of Work

### 1. Immediate (P0)

- **[A1]** Complete table ownership: (1) Move "orphan messages on account delete" to messaging-service (internal API or event); (2) For messaging GET /chats without bdAccountId and GET /search, obtain sync-chats data via bd-accounts internal API instead of JOIN with bd_account_sync_chats.

### 2. This sprint (P1)

- **[S1]** Messaging internal routes: use `X-Organization-Id` only (or verify bd_account_id belongs to org).
- **[S2]** Implement message cleanup on account delete in messaging-service; bd-accounts calls it or emits event.
- **[S3]** Document and enforce INTERNAL_AUTH_SECRET in all envs where backends are reachable.
- **[A4, A10]** Use `withOrgContext` for all tenant-scoped DB access in messaging-service.
- **[A5]** Split chats.ts into smaller modules (list, pinned, stats).
- **[Q1]** Extract buildSyncListQuery, runSyncListQuery, buildDefaultChatsQuery from GET /chats handler.
- **[Q2–Q4]** Empty catch → log; reduce any in Telegram code; extract filterToApiMessages helper.

### 3. Next sprint (P2)

- **[A3]** Introduce repository layer for key aggregates; thin routes.
- **[A6]** Split telegram-manager and chat-sync by responsibility; single TelegramManager facade.
- **[S15, S16]** CSP nonces/hashes; theme script out of dangerouslySetInnerHTML.
- **[Q5–Q10]** DRY peerType/pagination; frontend API layer; discovery page split; typed bulk inserts; shared types.
- **Documentation:** Add internal-only endpoints to INTERNAL_API.md; optionally add current improvement plan under ai_docs/develop/plans/.

### 4. Backlog

- A7–A9, A11–A14; S4–S6, S7–S14; Q11–Q16.
- RabbitMQ queue depth metrics and alerts; frontend API layer; TelegramManager single entry; messages partitioning/archive; distributed tracing; documentation and test discipline.

---

## Remediation applied (post-audit)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **S1** | Internal API: предпочитать X-Organization-Id над body | ✅ | messaging-service routes/internal.ts: getOrganizationId(req, bodyOrgId), ensure + POST /messages используют header или body |
| **S2** | Orphan messages при удалении аккаунта — в messaging | ✅ | messaging-service: POST /internal/messages/orphan-by-bd-account (withOrgContext, UPDATE messages SET bd_account_id = NULL). bd-accounts accounts.ts: вызов этого API перед удалением sync/account; UPDATE messages убран из bd-accounts |
| **S3** | INTERNAL_AUTH_SECRET в dev/staging | ✅ | docs/DEPLOYMENT.md: добавлена рекомендация задавать непустой секрет в dev/staging при доступности бэкендов |
| **S4** | Edit/delete-by-telegram: проверка org | ✅ | internal.ts: edit-by-telegram и delete-by-telegram требуют X-Organization-Id, в WHERE добавлен AND organization_id = $orgId. message-db.ts + event-handlers: передача organizationId в контексте вызовов |
| **S5** | Validation errors в production | ✅ | internal.ts: при NODE_ENV=production сообщение "Validation failed" вместо деталей Zod |
| **A1** | bd-accounts не пишет в messages при delete | ✅ | Реализовано через S2 (orphan-by-bd-account) |
| **A4** | withOrgContext в messaging | ✅ | internal.ts: ensure и POST /messages в withOrgContext; chats.ts: GET /chats и GET /search обёрнуты в withOrgContext |
| **Doc** | INTERNAL_API internal endpoints | ✅ | Добавлены orphan-by-bd-account, уточнены edit/delete-by-telegram (X-Organization-Id) |
| **Q1 (баг)** | GET /chats early return внутри withOrgContext | ✅ | messaging-service routes/chats.ts: при channel!==telegram и при !chats?.length возвращаем `[]` из callback, а не res.json([]), чтобы не двойная отправка |
| **Q2** | Пустые catch в bd-accounts Telegram | ✅ | telegram-manager: во всех пустых catch добавлено log.debug (disconnect, регистрация Raw/Short/NewMessage, UpdateUserTyping/ChatUserTyping/UpdateUserStatus/ReadHistoryInbox/ReadChannelInbox/UpdateDraftMessage, contact insert, wrap other handlers) |
| **A5, Q1 (рефактор)** | Вынос запросов списка чатов | ✅ | messaging-service: chats-list-helpers.ts (getSyncListQuery, getDefaultChatsQuery, normalizeChatRows, runSyncListQuery, runDefaultChatsQuery); GET /chats использует их |
| **Shared chat в списке** | После создания общего чата с лидом чат в списке чатов аккаунта | ✅ | bd-accounts-service routes/messaging.ts: после createSharedChat — INSERT в bd_account_sync_chats (telegram_chat_id, title, peer_type=chat); список при bdAccountId идёт из sync-chats |

### Осталось (не сделано в этой сессии)

- **A1 (остаток):** GET /chats без bdAccountId и GET /search по-прежнему читают `bd_account_sync_chats` (JOIN). Перенос на bd-accounts internal API — опционально.
- **A3:** Слой репозитория не вводился.
- **A5, Q1:** Дальнейшее разбиение chats.ts (остальные хендлеры по необходимости) — вынос запросов списка чатов выполнен.
- **A6, Q3–Q4:** Сократить any в bd-accounts Telegram; вынести filterToApiMessages.
- **S15, S16:** CSP и theme script — не делалось.
- **Q5–Q16:** Остальные пункты качества кода — в бэклоге.

---

*Report generated from full system audit 2026-03-18. Remediation applied in post-audit session.*
