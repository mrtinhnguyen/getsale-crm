# Project Audit Report — GetSale CRM

**Date:** 2026-03-11  
**Scope:** Full project (services/, shared/, frontend/, migrations/) — focus on critical ~20–30%  
**Audited by:** senior-reviewer + security-auditor + reviewer

---

## Executive Summary

**Overall Health Score:** 2.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 2           | 0        | 0            | **2** |
| High     | 4           | 5        | 4            | **13** |
| Medium   | 5           | 4        | 8            | **17** |
| Low      | 4           | 4        | 6            | **14** |

**Recommendation:** Fix the 2 critical issues (admin route 404, analytics closed/won stage mismatch) before next release. Then address high-priority security and architecture items (internal auth policy, gateway error leak, auth rate limits, gateway structure).

---

## Critical Issues (fix immediately)

### [A1] Admin route has no handler — all requests 404
**Category:** Architecture  
**Location:** `services/api-gateway/src/index.ts` — `/api/admin` mounted with auth and rate limit only; no router or proxy.  
**Impact:** Admin features are unusable; every `/api/admin/*` request returns 404.  
**Fix:** Mount an admin router or proxy to a backend, or remove the route if not used.

### [A2] Analytics "closed/won" stage filter never matches default pipeline
**Category:** Architecture  
**Location:** `services/analytics-service/src/routes/analytics.ts` (e.g. lines 51, 195) — filter uses `name = 'closed' OR name = 'won'`. Default pipeline uses stage names `"Closed Won"` and `"Closed Lost"`.  
**Impact:** Summary and team-performance endpoints return zero for revenue-in-period and leads-closed for orgs using default stages.  
**Fix:** Align filter with actual stage names (e.g. `name IN ('Closed Won', 'Closed Lost')`) or use a shared constant; document the contract.

---

## High Priority Issues (fix soon)

### Architecture
- **[A3]** API Gateway god module — Split into modules (auth, proxies, SSE, rate-limit).
- **[A4]** Auth-service rate limiting not horizontally scalable — Use Redis.
- **[A5]** Duplicate and divergent `canPermission` — Unify to single source of truth.
- **[A6]** API Gateway does not use shared logger — Add `@getsale/logger`.

### Security
- **[S1]** Admin route has no handler — same as A1.
- **[S2]** Internal auth accepts user headers without X-Internal-Auth secret — Require valid `X-Internal-Auth`.
- **[S3]** Dependency vulnerabilities — Run `npm audit fix`; upgrade deps.
- **[S4]** Auth rate limits in-memory — Use Redis.
- **[S5]** API Gateway 500 can leak internal error message — Return generic message; log server-side only.

### Code Quality
- **[Q1]** Heavy use of `any` in bd-accounts-service — Introduce proper types.
- **[Q2]** Swallowed errors in empty catch blocks — Add logging or feedback.
- **[Q3]** Frontend components far over 300-line guideline — Split bd-accounts/page, pipeline/page.
- **[Q4]** Very long backend modules — Extract from sync.ts, conversations.ts, telegram-manager.ts.

---

## Medium Priority Issues (plan for next sprint)

Architecture: [A7]–[A11]. Security: [S6]–[S9]. Code Quality: [Q5]–[Q12].  
(See full report in `.cursor/workspace/audits/` if saved there, or in this file’s extended version.)

---

## Low Priority / Suggestions

Architecture: [A12]–[A15]. Security: [S10]–[S13]. Code Quality: [Q13]–[Q18].

---

## Priority Matrix

| ID | Issue | Severity | Effort | Priority |
|----|-------|----------|--------|----------|
| A1 | Admin route has no handler | Critical | Low | P0 — now |
| A2 | Analytics closed/won stage name mismatch | Critical | Low | P0 — now |
| S5 | Gateway 500 leaks error message | High | Low | P1 — sprint |
| S2 | Internal auth accepts headers without secret | High | Medium | P1 — sprint |
| S3 | Dependency vulnerabilities | High | Low–Medium | P1 — sprint |
| A4/S4 | Auth rate limits in-memory | High | Medium | P1 — sprint |
| A5 | Duplicate canPermission | High | Medium | P1 — sprint |
| A6 | Gateway no logger | High | Low | P1 — sprint |

---

## Next Steps

1. **Immediate:** Fix [A1] (admin route), [A2] (analytics stage filter).
2. **This sprint:** [S5], [S3], [A4/S4], [A5], [A6], [S2].
3. **Next sprint:** [A3], [Q2], [Q3/Q4], plus medium items.
4. **Backlog:** Low-priority items.

Use `/refactor [file]` for structural issues. Use `/implement [fix]` for security/feature fixes.

---

## Remediation Applied (2026-03-11)

**Critical:** [A1] Admin route — added placeholder router returning 501 until admin backend exists. [A2] Analytics — stage filter aligned to `Closed Won` / `Closed Lost`.

**High:** [S5] Gateway 500 — generic "Authentication failed" response; full error logged server-side. [S2] Internal auth — service-core now requires valid `X-Internal-Auth`; user headers alone no longer accepted. [S3] Dependencies — `npm audit fix` + nodemailer upgraded to ^8.0.2; 0 vulnerabilities. [A4/S4] Auth rate limits — moved to Redis via `RedisClient.incr()`; shared/utils extended with `incr()`. [A5] canPermission — unified in service-core (owner + admin except transfer_ownership); auth-service organization routes use service-core. [A6] Gateway — added `@getsale/logger`, all console.* replaced with structured log.

**Code quality (partial):** [Q2] Empty catch in discovery-loop and bd-accounts ensureFoldersFromSyncChats — added logging. [S6] Signup/signin — email format validation (regex). [S7] Pipeline leads — LIMIT/OFFSET use query parameters.

**Done in follow-up:** [A3] API Gateway split into modules: `config.ts`, `types.ts`, `cors.ts`, `auth.ts`, `rate-limit.ts`, `proxy-helpers.ts`, `proxies.ts`, `sse.ts`; `index.ts` now only wires middleware and routes (~95 lines).

**Follow-up (this session):** [Q1] bd-accounts helpers + accounts route: added `FolderRow`, `TelegramDialogLike`, replaced `any`/`err: any` with typed interfaces and `unknown`; [Q5] added `getAccountOr404()` in helpers, used in accounts GET /:id; [Q2] parse.ts SSE keepalive/close catch now log; RightWorkspacePanel sessionStorage catch log; layout theme catch commented; [S9] service-core: in production, startup fails if INTERNAL_AUTH_SECRET is unset or equals `dev_internal_auth_secret`.

**Latest (Q5 + Q2):** [Q5] `getAccountOr404` used in **media** (3 handlers), **auth** (2), **messaging** (8 handlers); [Q2] frontend: events-stream-context (3 catches), bd-accounts page, discovery page, pipeline page — all now log with `console.warn`. Media/auth/messaging: removed duplicate account fetch + 404; media catch `error: any` → `unknown`.

**Q6 (done):** [Q6] DRY conversation_id in messaging-service — added `getLeadConversationOrThrow(pool, conversationId, organizationId, columns)` in `conversations.ts`; create-shared-chat, mark-shared-chat, mark-won, mark-lost now use it (validation + fetch in one place).

**Deferred/backlog:** [Q1] remaining bd-accounts (sync, telegram-manager). [Q3/Q4] Splitting long files. Low-priority items.
