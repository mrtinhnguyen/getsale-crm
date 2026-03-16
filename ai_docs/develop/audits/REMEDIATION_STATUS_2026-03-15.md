# Статус ремедиации по аудиту (2026-03-15)

Сводка: что сделано по результатам полного системного аудита и последующих сессий ремедиации, и что остаётся в бэклоге.

**Связанные документы:** [FULL_SYSTEM_AUDIT_2026.md](FULL_SYSTEM_AUDIT_2026.md), [STATE_AND_ROADMAP.md](STATE_AND_ROADMAP.md)

---

## 1. Сделано

### 1.1 Наблюдаемость и здоровье

| Задача | Статус | Где |
|--------|--------|-----|
| Endpoint `/ready` для проверки готовности к трафику | ✅ | service-core (DB + RabbitMQ), api-gateway (Redis) |
| Метрика `event_publish_failed_total` для сбоев публикации в RabbitMQ | ✅ | shared/utils (rabbitmq.ts), регистрация в registry в service-app |
| Redis: `ping()` для health/readiness, логирование через @getsale/logger | ✅ | shared/utils (redis.ts) |

### 1.2 Безопасность

| Задача | Статус | Где |
|--------|--------|-----|
| JWT: явный алгоритм HS256 при sign/verify | ✅ | auth-service (helpers), api-gateway (auth), websocket-service (socket-auth) |
| CSP включён в API Gateway (минимальный набор директив) | ✅ | api-gateway (index.ts, helmet) |
| Валидация ввода через Zod на критичных эндпоинтах | ✅ | См. раздел 1.4 |

### 1.3 Tenant isolation (RLS)

| Задача | Статус | Где |
|--------|--------|-----|
| `withOrgContext` для операций с данными организации | ✅ | messaging (attachLead), crm (companies POST/PUT, contacts POST/PUT, notes POST/DELETE, reminders POST/PATCH/DELETE), **deals POST/PUT** |
| Внутренний API pipeline: приоритет `X-Organization-Id` над body | ✅ | pipeline-service (internal.ts) |
| Automation SLA cron: фильтр только по `req.user.organizationId` | ✅ | automation-service (rules.ts) |

### 1.4 Валидация (Zod)

| Сервис / область | Эндпоинты с Zod | Примечание |
|------------------|-----------------|------------|
| auth-service | signup, signin, verify, organization PATCH/POST transfer, workspaces switch, 2FA verify/disable/validate | Схемы для полей и лимитов |
| campaign-service | campaigns (create, patch, presets, audience, participants-bulk), **sequences** (POST, PATCH), **templates** (POST, PATCH) | |
| pipeline-service | pipelines (POST, PUT), stages (POST, PUT), leads (create) | |
| bd-accounts-service | accounts: purchase, enrich-contacts, PATCH, PUT config; **auth**: send-code, verify-code, qr-login-password, connect; **sync**: sync-chats, **sync-folders** (POST), sync-folders/order, sync-folders/custom, PATCH folder, resolve-chats, parse/resolve, chats/:chatId/folder; **messaging**: send, send-bulk, forward, draft, delete-message, create-shared-chat, reaction, typing, read | |
| messaging-service | send message (SendMessageSchema) | |
| crm-service | contacts (create, update), companies (create, update), notes (create), reminders (create, update), deals (create, update, stage) — через validation/ | |
| user-service | profile PUT, stripe-webhook (через deps) | |
| team-service | members (invite, role), clients (assign), invites (create) | |
| ai-service | search-queries, drafts (generate) | |

### 1.5 Трассировка (correlationId)

| Задача | Статус | Где |
|--------|--------|-----|
| Поле `correlationId` в BaseEvent и проброс в события | ✅ | shared/events (BaseEvent), auth (USER_CREATED), crm (CONTACT_*, COMPANY_*, DEAL_*, discovery DISCOVERY_TASK_STARTED), pipeline (LEAD_*, STAGE_CREATED), campaign (CAMPAIGN_*, execution), messaging (MESSAGE_SENT/DELETED), automation (AUTOMATION_RULE_*, TRIGGER_*), user (Stripe webhook), ai (AI_DRAFT_*), team (TEAM_MEMBER_ADDED), bd-accounts auth (BD_ACCOUNT_CONNECTED) |
| Convert lead → deal: DEAL_CREATED и LEAD_CONVERTED с correlationId | ✅ | crm-service (deals.ts, createDealFromLead) |
| Контекст (organizationId, correlationId) в вызовах aiClient из messaging | ✅ | conversation-ai.ts |

### 1.6 Надёжность

| Задача | Статус | Где |
|--------|--------|-----|
| Retry для HTTP-клиентов к messaging и bd-accounts из campaign-service | ✅ | campaign-service (index.ts, retries: 2) |
| Retry для bd-accounts из messaging-service | ✅ | messaging-service (index.ts) |

### 1.7 Фронтенд

| Задача | Статус | Где |
|--------|--------|-----|
| Глобальный error boundary: тексты из локалей (i18n) | ✅ | frontend (global-error.tsx, ru.json) |
| Sentry: переход на @sentry/browser, ленивая инициализация в error-reporter | ✅ | frontend (package.json, lib/error-reporter.ts) |
| Рефакторинг bd-accounts: хук useBdAccountsConnect, компонент ConnectModal | ✅ | frontend (bd-accounts/hooks, components/ConnectModal.tsx), страница упрощена |

### 1.8 Типы и качество кода

| Задача | Статус | Где |
|--------|--------|-----|
| Типы событий: CampaignStartedEvent, CampaignPausedEvent в Event union | ✅ | shared/events |
| Убраны лишние (req as any), типизация ответов и catch (err: unknown) | ✅ | crm (discovery-tasks и др.) |

---

## 2. Не сделано / бэклог

### 2.1 Высокий приоритет

- **Zod** на оставшихся эндпоинтах: bd-accounts (часть sync/messaging без схем), другие сервисы по точечным маршрутам.
- **correlationId** в местах без `req` (bd-accounts telegram-manager, message-sync, event-handlers; ai-service index при событийном вызове) — передавать из входящего события или генерировать консистентно.
- **Рефакторинг bd-accounts (продолжение):** модалка «Диалоги» в отдельный компонент, хук `useBdAccountsList` для списка аккаунтов и действий.

### 2.2 Средний приоритет

- **RLS:** перевести на `withOrgContext()` оставшиеся мутирующие операции (например PATCH stage в deals, другие DELETE в crm при необходимости).
- **Метрики глубины очередей RabbitMQ** и алерты по ним.
- **Проверка/ужесточение CORS** для WebSocket.
- **Retry/circuit breaker** для вызовов AI и внешних API из других сервисов (унификация с campaign/messaging).

### 2.3 Низкий приоритет

- Переход на **@sentry/nextjs** после поддержки Next 16.
- **Партиционирование/архивация** таблицы `messages` и стратегия тяжёлых запросов.
- **Distributed tracing** (OpenTelemetry/Jaeger).
- Унификация **идемпотентности** (idempotency keys) для HTTP API.

### 2.4 Из аудита (стратегические риски, без точечной ремедиации)

- Общая БД без явного ownership и контрактов схемы между сервисами.
- Рост таблицы `messages` без партиционирования и политики архивации.
- Алерты и пороги по метрикам (latency, error rate, queue depth) не заданы в коде/конфиге.
- Документация и тесты — дисциплина обновления и покрытия.

---

## 3. Что делать дальше (рекомендация)

1. **Ближайшие шаги:** закрыть оставшиеся эндпоинты Zod в bd-accounts и других сервисах; добавить correlationId во все места публикации событий, где есть контекст (req или входящее событие).
2. **Далее:** метрики очередей RabbitMQ, алерты по /health и /ready, при необходимости — рефакторинг bd-accounts (Dialogs, useBdAccountsList).
3. **Стратегия:** по мере роста — партиционирование/архивы для `messages`, политика контрактов схемы и, при необходимости, read replicas и отдельная очередь джобов.

---

## 4. Сессия 2026-03-16 (дополнительные исправления)

По отчёту [2026-03-16-full-system-audit.md](2026-03-16-full-system-audit.md) выполнено:

**Сессия 1:** S1 (getClientIp для refresh), S3 (rate limit Stripe webhook), S4 (notes DELETE + organization_id), S5 (Zod subscription upgrade), S6/Q5 (Zod pipeline leads POST).

**Сессия 2:** S7 — на `/api/invite` в api-gateway добавлен rate limit 30 req/min на IP. S8 — в auth-service для маршрутов invite (GET `/:token`, POST `/:token/accept`) добавлена валидация токена через Zod (длина 1–512, символы `[a-zA-Z0-9_-]+`). S2 — в `docs/DEPLOYMENT.md` добавлен раздел «Безопасность: gateway и бэкенды» (обязательность INTERNAL_AUTH_SECRET в production, запрет прямого доступа к бэкендам); в `docs/INTERNAL_API.md` добавлена ссылка на этот раздел.

**Сессия 3:** Q3 — в crm-service добавлены хелперы `getNotesForEntity`, `insertNote`, `getRemindersForEntity`, `insertReminder` в `helpers.ts`; маршруты notes и reminders переведены на них (устранено дублирование contact/deal). В `DELETE /reminders/:id` добавлен явный фильтр по `organization_id`. A4 (pipeline) — в pipeline-service все мутирующие операции (leads: POST/PATCH/DELETE; stages: POST/PUT/DELETE; pipelines: POST/PUT/DELETE) обёрнуты в `withOrgContext`.

**Сессия 4:** A4 (automation) — в automation-service POST /rules (INSERT automation_rules) обёрнут в `withOrgContext`. A4 (campaign) — в campaign-service обёрнуты в `withOrgContext`: campaigns POST (create), PATCH (update/onlyStop), DELETE (soft delete), POST /presets; execution POST /:id/pause.

**Сессия 5:** A4 (bd-accounts) — в bd-accounts-service `accounts.ts` обёрнуты в `withOrgContext`: POST /purchase, PATCH /:id, PUT /:id/config, POST /:id/enable, DELETE /:id (все мутации с явным organization_id в WHERE где применимо). В enable убран `as any`, добавлена типизация для row.

**Сессия 6:** A5, Q1 — в messaging-service добавлен `messages-list-helpers.ts` с хелперами для GET /messages: `buildMessagesListWhere`, `runMessagesCount`, `runMessagesListQuery`, `getHistoryExhausted`, `maybeLoadInitialHistory`, `maybeLoadOlderHistoryAndGetTotal`, `enrichMessagesWithSenderNames`. Обработчик GET /messages в `messages.ts` переписан на оркестрацию через эти хелперы (устранено дублирование и длинный монолитный блок).

**Сессия 7:** A6, Q2 — в bd-accounts-service: в `helpers.ts` добавлены `getErrorMessage(err: unknown)` и `getErrorCode(err: unknown)`. Все пустые `catch (_) {}` заменены на логирование (event-handlers, contact-manager, chat-sync, qr-login). В connection-manager, message-handler, message-sender, event-handlers заменены `catch (e: any)` на `catch (e: unknown)` с `getErrorMessage(e)` для логов. Крупные модули (chat-sync, telegram-manager) не разбивались.

**Сессия 8:** A2 — Decoupling signup от pipeline: в `shared/events` добавлен тип `OrganizationCreatedEvent`. Auth-service при создании новой организации публикует `ORGANIZATION_CREATED`; синхронный вызов pipeline-service и зависимость от `pipelineClient` удалены. Pipeline-service: добавлены `default-pipeline.ts` (createDefaultPipelineForOrg) и подписка на `ORGANIZATION_CREATED` в `event-handlers.ts`; внутренний endpoint использует ту же функцию. Регистрация не блокируется pipeline.

**Сессия 9:** A1 (этап 1) — Владение таблицами messages/conversations: добавлен документ `ai_docs/develop/TABLE_OWNERSHIP_A1.md` (назначение владельцев и план миграции). Messaging-service: внутренний API `POST /internal/conversations/ensure`, `POST /internal/messages`. Bd-accounts: `MessageDb` с опциональным `messagingClient`; при заданном клиенте создание conversation и message идёт через HTTP к messaging-service. Удаление/редактирование по событиям Telegram в bd-accounts пока остаются прямыми запросами к БД (этап 2 в бэклоге).

Из бэклога п. 2.2: RLS/withOrgContext внедрён в pipeline, automation, campaign, bd-accounts (accounts). Остаются: withOrgContext в bd-accounts sync.ts и auth.ts; в campaign (execution start, participants-bulk, from-csv, templates, sequences); Zod на прочих эндпоинтах, correlationId без req, рефакторинг bd-accounts (Dialogs, useBdAccountsList), метрики очередей RabbitMQ, CORS WebSocket, retry/circuit breaker для AI. По A6/Q2: пустые catch и типизация ошибок в ключевых модулях Telegram закрыты; разбиение chat-sync/telegram-manager и оставшиеся `as any` в telegram-serialize — по желанию. По A2: signup больше не зависит от pipeline; дефолтный пайплайн создаётся асинхронно по событию ORGANIZATION_CREATED. По A1: этап 1 выполнен (messaging — единственный писатель в messages/conversations для потока «создание сообщения»; bd-accounts вызывает внутренний API messaging). Этапы 2–4 (delete/edit через API; отказ messaging от записи в bd_account_sync_*; чтение через API) — в бэклоге.

---

*Документ обновлён по состоянию ремедиации после полного системного аудита 2026-03-15 и сессий 2026-03-16.*
