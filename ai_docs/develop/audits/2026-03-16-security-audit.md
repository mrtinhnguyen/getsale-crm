# Security Audit — GetSale CRM Monorepo

**Date:** 2026-03-16  
**Scope:** `services/`, `shared/`, `frontend/app/`, `api-gateway`  
**Context:** Architecture findings A1 (cross-service table access), A4/A10 (messaging without withOrgContext/RLS), internal API trust.

---

## Security Findings

### Critical

- **None.** No critical security vulnerabilities that must block deployment were identified. Architecture issues (A1 cross-service writes, tenant isolation) are tracked separately.

### High

- **[S1] Internal API trusts body.organizationId for tenant scope** — `services/messaging-service/src/routes/internal.ts` (EnsureConversationSchema, CreateMessageSchema) — **Impact:** Callers to `/internal/conversations/ensure` and `/internal/messages` supply `organizationId` in the request body. If a trusted service (e.g. bd-accounts) were compromised or had a bug, it could write messages/conversations for another tenant. **Fix:** Prefer `X-Organization-Id` header set by gateway for user-bound calls; for service-to-service (bd-accounts → messaging), either (a) have messaging verify that `bd_account_id` belongs to the given `organizationId` via a quick lookup or (b) have the gateway/internal caller set `X-Organization-Id` and have messaging use that instead of body for tenant scope.

- **[S2] bd-accounts directly writes to `messages` and deletes from sync tables on account delete** — `services/bd-accounts-service/src/routes/accounts.ts` (lines 327–331) — **Impact:** Aligns with architecture finding A1: bd-accounts-service performs `UPDATE messages SET bd_account_id = NULL` and deletes from `bd_account_sync_chats` / `bd_account_sync_chat_folders` / `bd_account_sync_folders`. Cross-service table ownership increases risk of mistakes (e.g. missing org check in a future change). **Fix:** Move message/sync cleanup to messaging-service (e.g. internal endpoint “on account deleted” that messaging owns), or document ownership and add a shared contract/tests so only one service mutates these tables.

- **[S3] INTERNAL_AUTH_SECRET optional in non-production** — `services/api-gateway/src/config.ts` (line 12), `shared/service-core/src/service-app.ts` (lines 102–107) — **Impact:** If `INTERNAL_AUTH_SECRET` is not set, gateway does not send the header and service-app applies internalAuth only when the env is set; when set, every request (except /health, /metrics) requires X-Internal-Auth. In production both gateway and service-core throw if secret is missing or default. In dev/staging, leaving it unset could allow direct backend access without the secret. **Fix:** Ensure dev/staging also set a non-default `INTERNAL_AUTH_SECRET` where backends are reachable; document in deployment/README.

### Medium

- **[S4] Messaging internal edit/delete-by-telegram do not validate organization** — `services/messaging-service/src/routes/internal.ts` (PATCH `/messages/edit-by-telegram`, POST `/messages/delete-by-telegram`) — **Impact:** Endpoints identify messages only by `bd_account_id` + `channel_id` + `telegram_message_id`. They do not accept or check `organization_id`. Access is gated by internal auth; if the secret were leaked, an attacker could edit/delete messages for any bd_account. **Fix:** Add defense in depth: require or use `X-Organization-Id` and verify that the message’s `organization_id` matches before updating/deleting.

- **[S5] Validation error messages may leak structure** — `services/messaging-service/src/routes/internal.ts` (e.g. lines 76, 92, 192, 219) — **Impact:** Responses use `'Invalid body: ' + parsed.error.message`. Zod error messages can be verbose and expose field names or constraints. **Fix:** In production, return a generic “Validation failed” and log `parsed.error` server-side only (align with `AppError`/`toJSON` behavior in service-core that omits details in production).

- **[S6] Auth-store persists user object to localStorage** — `frontend/lib/stores/auth-store.ts` (persist with `user`, `isAuthenticated`) — **Impact:** User id, email, organizationId, role are stored in localStorage for rehydration. Tokens are correctly in httpOnly cookies. localStorage is still readable by XSS; an attacker could learn current user/org. **Fix:** Acceptable for UX; ensure no tokens or sensitive PII beyond id/email/org/role. Consider short TTL or clearing on inactivity if risk is higher.

### Low

- **[S7] WebSocket CORS** — `services/websocket-service/src/index.ts` (lines 30–32) — **Impact:** Production already throws if `CORS_ORIGIN` is not set. Dev defaults to `*`. **Fix:** Document that production must set `CORS_ORIGIN` (already enforced).

- **[S8] Rate limiting on auth** — **Impact:** Auth endpoints use Redis-backed rate limiting (signin, signup, refresh, 2FA). Gateway applies per-user/per-IP limits. No issues found; noted as positive.

- **[S9] Stripe webhook signature verification** — `services/user-service/src/routes/stripe-webhook.ts` — **Impact:** Uses `req.rawBody` and `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`. Correct. **Fix:** None.

- **[S10] Password hashing** — `services/auth-service/src/routes/auth.ts` — **Impact:** bcrypt (bcryptjs) with cost 12 for password hash and compare. **Fix:** None.

- **[S11] Error details in production** — `shared/service-core/src/errors.ts` — **Impact:** `AppError.toJSON()` omits `details` in production (S13). **Fix:** None.

- **[S12] Invite token validation** — `services/auth-service/src/routes/invites.ts` — **Impact:** Token from URL is validated with Zod (`InviteTokenParamSchema`), then looked up in DB; expiry checked. **Fix:** None.

- **[S13] Pipeline internal uses header for org** — `services/pipeline-service/src/routes/internal.ts` — **Impact:** `POST /pipeline/default-for-org` uses `X-Organization-Id` header only (no body trust). **Fix:** None.

- **[S14] bd-accounts internal sync-chats** — `services/bd-accounts-service/src/routes/internal.ts` — **Impact:** Requires `X-Organization-Id` and validates `bd_account_id` belongs to that org. **Fix:** None.

---

## Checklist Summary

| Area | Status |
|------|--------|
| Authentication (JWT, refresh, cookies) | ✅ bcrypt, httpOnly cookies, 15m access / 7d refresh, rate limits |
| Internal auth (gateway → backend) | ✅ X-Internal-Auth required when secret set; production enforces non-default secret |
| Input validation (Zod, injection) | ✅ Parameterized queries; Zod used; S5 for internal validation message leakage |
| Hardcoded secrets | ✅ None; env vars / example placeholders only |
| OWASP / API (rate limit, CORS) | ✅ Gateway rate limits; CORS whitelist in production; WebSocket CORS enforced in prod |
| Sensitive data (PII, tokens) | ✅ Tokens in cookies; S6 notes localStorage for user/org only |
| Error leakage | ✅ AppError omits details in prod; S5 for internal Zod messages |
| Internal API (X-Organization-Id, body vs header) | ⚠️ S1 (messaging internal trusts body org); S4 (edit/delete no org check); pipeline/bd-accounts internal use header correctly |

---

## Recommendations

1. **S1/S4:** Prefer header-based `X-Organization-Id` for internal messaging routes and add org check for edit/delete-by-telegram.
2. **S2:** Resolve A1 ownership (single service for messages/sync tables) or formalize contract and tests.
3. **S3:** Set `INTERNAL_AUTH_SECRET` in all environments where backends are reachable; document in deployment.
4. **S5:** Use generic “Validation failed” for internal Zod parse errors in production and log details server-side only.
