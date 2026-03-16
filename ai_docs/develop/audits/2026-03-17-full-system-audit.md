# Project Audit Report — Full System Audit 2026-03-17

**Date:** 2026-03-17  
**Scope:** Full project (services/, shared/, frontend/app/)  
**Audited by:** senior-reviewer + security-auditor + reviewer

---

## Executive Summary

**Overall Health Score:** 4.0/10

| Severity | Architecture | Security | Code Quality | Total |
|----------|-------------|----------|--------------|-------|
| Critical | 0           | 0        | 0            | **0** (A1 закрыт) |
| High     | 6           | 3        | 6            | **15** |
| Medium   | 6           | 5        | 7            | **18** |
| Low      | 4           | 3        | 7            | **14** |

**Recommendation:** Критичный **[A1]** закрыт (этапы 2–4: edit/delete через API, messaging не пишет/читает bd_account_sync_chats через internal GET sync-chats). Приоритизировать High: A3–A6 (репозиторий, god-модули), S13 (AppError details), Q22–Q28 (sync.ts, useMessagingData, типы, rawBody).

---

## Critical Issues (fix immediately)

### [A1] Shared ownership of `messages` — закрыто (этапы 2–4, 2026-03-17)

**Category:** Architecture  
**Было:** bd-accounts делал прямой DELETE/UPDATE по `messages`; messaging писал и читал `bd_account_sync_chats`.  
**Сделано:** Этап 2 — edit/delete через internal API messaging; bd-accounts event-handlers через MessageDb. Этап 3 — messaging не пишет в `bd_account_sync_chats` при отправке. **Этап 4:** bd-accounts добавлен `GET /internal/sync-chats?bdAccountId=...` (X-Organization-Id); messaging при фильтре по bdAccountId получает список чатов через этот API; `getHistoryExhausted` и `enrichMessagesWithSenderNames` при переданном контексте вызывают тот же API вместо прямого чтения `bd_account_sync_chats`.  
**Остаётся (опционально):** ветки GET /chats без bdAccountId и GET /search по-прежнему JOIN с `bd_account_sync_chats`; accounts.ts при удалении аккаунта — `UPDATE messages SET bd_account_id = NULL` (допустимое исключение по TABLE_OWNERSHIP).

---

## High Priority Issues (fix soon)

### Architecture

- **[A3]** Нет слоя репозитория; в routes смешаны HTTP, валидация и доступ к данным — во всех `services/*/src/routes/*.ts`. Ввести data/repository слой по агрегатам; оставить routes тонкими.
- **[A4]** Tenant isolation — **частично закрыто:** sync.ts (POST sync-folders, sync-folders/custom, PATCH order, PATCH folderRowId, DELETE folder, POST sync-chats) и campaign (templates.ts, sequences.ts) обёрнуты в `withOrgContext`. Оставшиеся мутации (participants, execution start, from-csv и т.д.) — по желанию.
- **[A5]** **Закрыто (сессия 6):** messages разбит на messages-list.ts, messages-send.ts, messages-actions.ts + messages-deps.ts; messages.ts только композиция.
- **[A6]** God-модули в bd-accounts Telegram: chat-sync.ts, telegram-manager.ts (1000+ строк), дублирование delete/edit. Разбить по ответственности; один фасад TelegramManager; централизовать delete/edit (через MessageDb/internal API).
- **[A7]** **Закрыто:** добавлен in-memory кэш с TTL 60 с для `canPermission` в `shared/service-core/src/middleware.ts`.
- **[A8]** **Закрыто для edit/delete:** bd-accounts переводит edit/delete сообщений на MessageDb → internal API messaging (A1 этап 2). Прямая запись остаётся только в accounts.ts при удалении аккаунта (`UPDATE messages SET bd_account_id = NULL`) — допустимое исключение.

### Security

- **[S9]** **Закрыто:** pipeline internal `POST /internal/pipeline/default-for-org` принимает только `X-Organization-Id` (body убран).
- **[S10]** **Закрыто:** withOrgContext добавлен в sync.ts и campaign (templates, sequences) для всех мутаций.
- **[S11]** **Закрыто:** кэш canPermission (A7).

### Code Quality

- **[Q16]** Добавлен `parseOffset` в service-core; **частично закрыто:** discovery-tasks переведён на parseLimit/parseOffset. Остальные list-эндпоинты — по желанию.
- **[Q17]** **Закрыто:** discovery-tasks GET использует `parseLimit(req.query, 50, 100)` и `parseOffset(req.query, 0)`.
- **[Q18]** **Закрыто:** analytics GET /summary использует `validate(PeriodQuerySchema, 'query')` (Zod enum today/week/month/year).
- **[Q19]** Массовое использование `any` и `(e as any).code` в bd-accounts (sync.ts, chat-sync.ts, telegram-manager) при наличии `getErrorCode(e)` в helpers. Заменить на `catch (e: unknown)` и `getErrorCode(e)`.
- **[Q20]** Пустые/тихие catch в telegram-manager (множество мест). Минимум — логировать (log.debug/log.warn).
- **[Q21]** **Частично закрыто:** в dashboard добавлен `reportError()` в bd-accounts/page, error.tsx, team/page, analytics/page. Остальные страницы (campaigns, pipeline, settings, discovery, messaging hooks) — по желанию.

---

## Medium Priority Issues (plan for next sprint)

### Architecture

- **[A9]** Одна общая БД; владение схемами/таблицами не enforced в коде. Документировать; рассмотреть границы по сервисам.
- **[A10]** События без версионирования схемы — `shared/events`. Добавить version/schema id в payload или routing.
- **[A11]** Много синхронного HTTP между сервисами. Предпочитать события для fire-and-forget.
- **[A12]** Frontend dashboard без выделенного API-слоя. Опционально: обёртка с типизированными методами.
- **[A13]** **Закрыто (сессия 4):** bd-accounts передаёт `onShutdown: () => telegramManager?.shutdown()` в createServiceApp; дублирующие process.on('SIGTERM'/'SIGINT') удалены.
- **[A14]** Дублирование логики delete/edit сообщений в event-handlers и telegram-manager. Один путь (MessageDb или internal API после A1).

### Security

- **[S12]** discovery-tasks GET: limit/offset не валидированы (то же, что Q17).
- **[S13]** **Закрыто (сессия 6):** AppError.toJSON() в production не отдаёт details клиенту; errorHandler логирует details на сервере (log.warn).
- **[S14]** analytics period не валидирован (то же, что Q18).
- **[S15]** CSP с `unsafe-inline` для scripts/styles (gateway). Перейти на nonces/hashes.
- **[S16]** Theme script через dangerouslySetInnerHTML в layout. Отдельный файл или nonce-based inline.

### Code Quality

- **[Q22]** **Закрыто (сессия 6):** Zod-схемы вынесены в sync-schemas.ts; sync.ts импортирует их, объём уменьшен.
- **[Q23]** useMessagingData — длинный хук и зависимости. Разбить на меньшие хуки; поправить dependency arrays.
- **[Q24]** **Закрыто (сессия 4):** в useMessagingData переименовано в `chatsFromApi`.
- **[Q25]** **Закрыто (сессия 5):** reportWarning добавлен в notification-sound, auth-store, blob-url-cache, useMessagingData/useMessagingActions (draft), discovery page.
- **[Q26]** **Закрыто (сессия 5):** StageRule.value → unknown; metadata → Record<string, unknown> в shared/types.
- **[Q27]** **Закрыто (сессия 4):** service-app использует `(req as Request).rawBody`; тип задан в middleware (Express.Request).
- **[Q28]** **Закрыто (сессия 5):** в catch toJsonSafe добавлен console.warn в development; @ts-nocheck оставлен из-за типов GramJS.

---

## Low Priority / Suggestions

### Architecture

- **[A15]** RLS/withOrgContext — не везде (auth, analytics и др.). Постепенно включить для всего tenant-scoped доступа.
- **[A16]** Два входа к TelegramManager — telegram/index.ts и telegram-manager.ts. Зафиксировать один публичный экспорт.
- **[A17]** service-app rawBody (дубль Q27).
- **[A18]** Риск over-engineering при введении repository и frontend API layer — делать по необходимости.

### Security

- **[S17]** Pipeline internal org from body — дубль S9 с учётом internal-only.
- **[S18]** MFA secret в ответе 2FA setup — по дизайну; документировать HTTPS.
- **[S19]** QR login password в Redis с TTL — приемлемо; документировать.

### Code Quality

- **[Q29]** **Закрыто (сессия 4):** bd-accounts index: reason/error как `unknown`, использование err/msg/stack.
- **[Q30]** websocket-service: socket/error с `any` → расширить тип Socket; `catch (error: unknown)`.
- **[Q31]** Frontend: `catch (err: any)` и `(err as any)?.response?.data` в нескольких страницах. `unknown` + сужение или `getApiError(err)`.
- **[Q32]** Дублирование маппинга error-code в sync/chat-sync. Использовать `getErrorCode(e)` и общие константы/helper.
- **[Q33]** Пробелы в тестах маршрутов: messaging send/delete/mark-read, pipeline leads, bd-accounts messaging/sync, reminders, discovery-tasks.
- **[Q34]** redis.set value: any → `unknown` или generic.
- **[Q35]** activity-service limit parsing — использовать `parseLimit` для единообразия.

---

## Comparison with Previous Audit (2026-03-16)

### Что закрыто с прошлого аудита (2026-03-16)

- **A2** — Signup отвязан от pipeline (ORGANIZATION_CREATED, асинхронное создание default pipeline).
- **S1–S8** — Refresh rate limit (getClientIp), Stripe webhook rate limit, notes DELETE org_id, Zod для subscription/leads, invite rate limit и валидация токена, документация INTERNAL_AUTH_SECRET.
- **A4** (частично) — withOrgContext в pipeline (leads, stages, pipelines), automation (rules), campaign (campaigns, execution), bd-accounts (accounts.ts).
- **A5, Q1** — Разбиение GET /messages на хелперы (messages-list-helpers).
- **A6, Q2** (частично) — getErrorMessage/getErrorCode, убраны пустые catch, catch(unknown) в части bd-accounts Telegram.
- **Q3** — Общие хелперы для notes/reminders по entity.

### Что остаётся открытым

- **A1** — **Закрыто (сессия 3):** этап 4 реализован — bd-accounts `GET /internal/sync-chats`; messaging при bdAccountId и в messages-list-helpers использует этот API вместо чтения `bd_account_sync_chats`. Критичный пункт снят.
- **A3** — Слой репозитория не введён (High).
- **A4** — Пробелы: sync.ts, campaign templates/sequences/participants (High → S10).
- **A5** — messages.ts всё ещё крупный (~585 строк) (High).
- **A6** — Крупные модули bd-accounts Telegram, дублирование delete/edit (High).
- **A7/S11** — canPermission без кэша (High).
- **S9** — Internal pipeline API: org из body (High, новый явный пункт).
- **S10** — withOrgContext для sync и campaign (High).
- **Q4/Q16** — Единая пагинация/parseLimit не везде (High как Q16).
- **Q17/Q18** — Валидация query в discovery-tasks и analytics period (High).
- **Q19–Q21** — any/пустые catch в bd-accounts, console во frontend (High).
- Средние и низкие пункты из 2026-03-16 в основном сохранены (Zod для части query, CSP, типы, тесты и т.д.).

### Новое в аудите 2026-03-17

- **S9** — Явно выделен приём organizationId из body во internal pipeline API.
- **S10** — Явно: withOrgContext для sync.ts и campaign templates/sequences.
- **Q16** — Единый parseLimit по всем сервисам как отдельный High.
- **Q17–Q18** — Валидация discovery-tasks и analytics period (связка с S12/S14).
- **Q19–Q20** — Оставшиеся `any` и пустые catch в bd-accounts (sync, chat-sync, telegram-manager).
- **Q22** — Длина и структура sync.ts.
- **Q23–Q25** — useMessagingData, именование, проглатывание ошибок во frontend.
- **Q26–Q28** — shared types, rawBody, telegram-serialize.

### Сводка по баллу

- **2026-03-16:** Health Score 2.0/10 (2 Critical, 10 High). После ремедиаций — 1 Critical (A1), часть High закрыта.
- **2026-03-17:** Health Score 4.0/10 (1 Critical, 15 High). Улучшение за счёт закрытия A2 и S1–S8, части A4/A5/Q1–Q3; критичным остаётся только A1.

---

## Priority Matrix

| ID   | Issue | Severity | Effort | Priority |
|------|--------|----------|--------|----------|
| A1   | Завершить владение messages (этапы 2–4) | Critical | High | ✅ закрыто (сессия 3) |
| S9   | Pipeline internal: org только из header | High | Low | P1 — спринт |
| S10  | withOrgContext в sync.ts и campaign (templates/sequences) | High | Medium | P1 — спринт |
| A4   | Tenant isolation (sync, campaign) | High | Medium | P1 — спринт |
| A7/S11 | Кэш canPermission | High | Medium | P1 — спринт |
| A8   | bd-accounts delete/edit через internal API (часть A1) | High | Medium | P1 — спринт |
| Q16  | parseLimit везде | High | Medium | P1 — спринт |
| Q17/S12 | discovery-tasks query Zod | High | Low | P1 — спринт |
| Q18/S14 | analytics period Zod | High | Low | P1 — спринт |
| Q19–Q20 | any и пустые catch в bd-accounts | High | Medium | P1 — спринт |
| Q21  | Frontend: reportError вместо console | High | Low | P1 — спринт |
| A5   | Разбить messages.ts | High | Medium | P2 |
| A6   | Разбить god-модули bd-accounts Telegram | High | High | P2 |
| A3   | Слой репозитория | High | High | P2 |

---

## Новый план работ

### 1. Немедленно (P0) — выполнено

- **[A1]** ✅ Закрыто по [TABLE_OWNERSHIP_A1.md](../TABLE_OWNERSHIP_A1.md): этапы 2–3 (edit/delete через API, messaging не пишет в bd_account_sync_chats); этап 4 (bd-accounts `GET /internal/sync-chats`, messaging chats при bdAccountId и getHistoryExhausted/enrichMessagesWithSenderNames через API).

### 2. Текущий спринт (P1)

- **[S9]** Pipeline internal: в `POST /internal/pipeline/default-for-org` брать organizationId только из `X-Organization-Id`; убрать использование `req.body?.organizationId` или проверять совпадение с header и валидировать Zod.
- **[S10], [A4]** Обернуть в `withOrgContext` все мутации в `bd-accounts-service/src/routes/sync.ts` (sync-folders, sync-chats, PATCH/DELETE папок) и в campaign (templates.ts, sequences.ts; при необходимости participants).
- **[A7], [S11]** Ввести кэш для role_permissions в middleware (Redis или in-memory с TTL); инвалидация при изменении ролей/прав.
- **[Q16]** Во всех list-эндпоинтах использовать общий `parseLimit`/`parseOffset` из service-core (campaign, pipeline, bd-accounts, crm, messaging, activity).
- **[Q17], [S12]** В discovery-tasks GET добавить Zod для query (limit, offset с границами) или использовать parseLimit/parseOffset.
- **[Q18], [S14]** В analytics добавить Zod enum для `period` (или isPeriodKey).
- **[Q19], [Q20]** В bd-accounts (sync.ts, chat-sync.ts, telegram-manager.ts): заменить `catch (e: any)` и `(e as any).code` на `catch (e: unknown)` и `getErrorCode(e)`; в пустых catch добавить логирование.
- **[Q21]** В frontend dashboard заменить `console.error`/`console.warn` на `reportError()` или обёртку логгера.

### 3. Следующий спринт (P2)

- **[A5]** Разбить `messages.ts` на модули по сценариям (list, send, actions).
- **[A6]** Уменьшить god-модули в bd-accounts Telegram: разбить chat-sync и telegram-manager по ответственности; один путь для message delete/edit.
- **[A3]** Ввести слой репозитория для ключевых агрегатов; сделать routes тонкими.
- **[S13]** В production не отдавать validation details в AppError.toJSON; логировать детали только на сервере.
- **[S15], [S16]** Ужесточить CSP (nonces/hashes); вынести theme script из dangerouslySetInnerHTML.
- **[Q22–Q28]** sync.ts хелперы и структура; useMessagingData разбить; именование; ошибки во frontend; типы shared/types и rawBody; telegram-serialize.

### 4. Бэклог (P3)

- **[A9]–[A18], [S17]–[S19], [Q29]–[Q35]** — документирование владения БД, версионирование событий, HTTP vs events, frontend API layer, shutdown bd-accounts, единая точка TelegramManager, типы (reason, socket, redis), дублирование error-code, тесты маршрутов, activity limit.
- Стратегические темы: партиционирование/архив messages, распределённый трейсинг, идемпотентность, дисциплина документации и тестов.

---

## Next Steps

1. **Сделано (сессии 1+2+3):** A1 этапы 2–4 (edit/delete через API; messaging не пишет в bd_account_sync_chats; bd-accounts `GET /internal/sync-chats`, messaging chats + messages-list-helpers через API), S9, S10/A4, A7/S11, Q16–Q18, Q19–Q20, Q21.
2. **Остаётся (опционально):** GET /chats без bdAccountId и GET /search в messaging по-прежнему JOIN с `bd_account_sync_chats` — можно вынести в API при желании.
3. **Следующий спринт:** A5, A6, A3, S13, S15–S16, Q22–Q28.
4. **Бэклог:** telegram-manager.ts (root), остальные пункты из таблицы.

Для структурных изменений использовать `/refactor [file]`. Для фич и безопасности — `/implement` или planner + worker.

---

## Remediation applied (2026-03-17)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **A1** | Этап 2: internal API edit/delete-by-telegram; bd-accounts через MessageDb | ✅ | messaging-service routes/internal.ts (PATCH edit, POST delete); bd-accounts MessageDb.deleteByTelegram/editByTelegram; telegram/event-handlers.ts |
| **A1** | Этап 3: messaging не пишет в bd_account_sync_chats | ✅ | messaging-service routes/messages.ts — удалён INSERT при отправке |
| **S9** | Pipeline internal: org только из X-Organization-Id | ✅ | pipeline-service routes/internal.ts |
| **S10, A4** | withOrgContext в sync.ts и campaign | ✅ | bd-accounts sync.ts (sync-folders, sync-folders/custom, order, folderRowId, DELETE folder, sync-chats); campaign templates.ts, sequences.ts |
| **A7, S11** | Кэш canPermission | ✅ | shared/service-core middleware.ts (in-memory, TTL 60s) |
| **Q16, Q17** | parseLimit/parseOffset, discovery-tasks query | ✅ | shared/service-core query-utils.ts (parseOffset), index export; crm-service discovery-tasks.ts |
| **Q18** | Analytics period Zod | ✅ | analytics-service routes/analytics.ts (PeriodQuerySchema, validate on GET /summary) |
| **Q21** | Frontend reportError вместо console | ✅ | bd-accounts/page, error.tsx, team/page, analytics/page, campaigns/[id], pipeline, settings, discovery, useMessagingData, useBdAccountsConnect |
| **Q19–Q20** | any и пустые catch в bd-accounts | ✅ | sync.ts (getErrorCode/getErrorMessage), telegram/chat-sync.ts (getErrorCode, catch (e: unknown)), telegram/event-handlers.ts, contact-manager.ts; telegram-serialize пустой catch с комментарием. telegram-manager.ts (root) не трогали |
| **A1 этап 4** | Messaging читает bd_account_sync_chats через API | ✅ | bd-accounts routes/internal.ts GET /sync-chats; messaging chatsRouter (при bdAccountId) и messages-list-helpers (getHistoryExhausted, enrichMessagesWithSenderNames с apiOptions) |

---

### Дополнение (сессия 2 — оставшиеся задачи)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **Q19–Q20** | Убрать any и пустые catch в bd-accounts | ✅ | routes/sync.ts: getErrorCode, getErrorMessage, catch (e/err: unknown). telegram/chat-sync.ts: getErrorCode, getErrorMessage, все catch (e: unknown). telegram/event-handlers.ts: getErrorMessage в NewMessage handlers. contact-manager.ts: getErrorMessage. telegram-serialize.ts: пустой catch с комментарием, убран (obj as any).toJSON |
| **Q21** | reportError в остальных страницах dashboard | ✅ | campaigns/[id]/page, pipeline/page, settings/page, discovery/page, useMessagingData.ts, useBdAccountsConnect.ts |

---

### Дополнение (сессия 3 — A1 этап 4)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **A1 этап 4** | bd-accounts internal API для sync-chats; messaging без чтения bd_account_sync_chats (при bdAccountId и в list-helpers) | ✅ | bd-accounts-service: routes/internal.ts (GET /internal/sync-chats), index.ts mount /internal. messaging-service: chatsRouter получает bdAccountsClient, при bdAccountId — вызов API + CTE sync_list; messages-list-helpers getHistoryExhausted/enrichMessagesWithSenderNames с apiOptions; messages.ts передаёт apiOpts |

---

### Дополнение (сессия 4 — оставшиеся правки)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **bd-accounts build** | Исправлены ошибки TS в accounts.ts | ✅ | decryptIfNeeded: isEncrypted = Boolean(row.session_encrypted); connectAccount: orgId/createdBy как string, Number(row.api_id) |
| **A13** | Graceful shutdown через createServiceApp onShutdown | ✅ | bd-accounts index: createServiceApp({ onShutdown: async () => telegramManager?.shutdown() }); удалены дублирующие process.on('SIGTERM'/'SIGINT') |
| **Q24** | Переименование chatsFromDB → chatsFromApi | ✅ | frontend useMessagingData.ts: оба вхождения (fetchChatsImpl и autoFetchChats) |
| **Q27** | rawBody без (req as any) | ✅ | shared/service-core service-app.ts: (req as Request).rawBody = buf; Express.Request уже расширен в middleware.ts |
| **Q29** | bd-accounts index: reason/error типы | ✅ | unhandledRejection (reason: unknown), uncaughtException (error: unknown), использование err/msg/stack |

---

### Дополнение (сессия 5 — Q25, Q26, Q28)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **Q25** | Проглатывание ошибок во frontend — логировать | ✅ | notification-sound.ts: reportWarning в catch и в .catch (resume, beep, WAV play). auth-store.ts: reportWarning в logout, fetchWorkspaces, localStorage setItem. blob-url-cache.ts: reportWarning в revokeObjectURL (eviction и delete). useMessagingData.ts / useMessagingActions.ts: reportWarning в draft save .catch. discovery/page.tsx: reportWarning в poll и fetchDiscoveryTask .catch |
| **Q26** | shared/types: any → unknown | ✅ | StageRule.value: any → unknown. metadata?: Record<string, any> → Record<string, unknown> (PipelineAction, Message, AIDraft) |
| **Q28** | telegram-serialize: в catch логировать | ✅ | toJsonSafe: в catch добавлен console.warn в development при выбросе toJSON |

---

### Дополнение (сессия 6 — S13, A5, Q22)

| ID | Задача | Статус | Где |
|----|--------|--------|-----|
| **S13** | AppError details только на сервере в production | ✅ | shared/service-core errors.ts: toJSON() не добавляет details при NODE_ENV=production. middleware.ts errorHandler: при production и err.details логируем log.warn(details) |
| **A5** | Разбить messages.ts по сценариям | ✅ | messaging-service: messages-deps.ts (Deps), messages-list.ts (GET inbox, messages, messages/:id), messages-send.ts (POST send), messages-actions.ts (delete, patch read/reaction, mark-read, mark-all-read, unfurl), messages.ts — композиция |
| **Q22** | sync.ts — вынести хелперы | ✅ | bd-accounts sync-schemas.ts: все Zod-схемы (SyncChatsBodySchema, SyncFoldersOrderSchema, SyncFolderCustomSchema, SyncFolderPatchSchema, ResolveChatsSchema, ParseResolveSchema, ChatFolderPatchSchema, SyncFoldersBodySchema). sync.ts импортирует из sync-schemas |

---

## Сводка: что сделано / что осталось

**Сделано (сессии 1–6):** A1 (этапы 2–4), S9, S10, A4, A7, S11, Q16–Q18, Q19–Q20, Q21, A13, Q24, Q25, Q26, Q27, Q28, Q29, S13, A5, Q22; исправлена сборка bd-accounts (accounts.ts).

**Осталось (приоритет):** A3 (репозиторий), A6 (god-модули bd-accounts Telegram), S15–S16 (CSP, theme script), Q23 (useMessagingData разбить). Опционально: GET /chats без bdAccountId и GET /search в messaging — переход на API bd-accounts.

---

*Report generated from full system audit 2026-03-17. Remediation: Session 1 — A1 (2–3), S9, S10, A4, A7, S11, Q16–Q18, Q21. Session 2 — Q19–Q20, Q21. Session 3 — A1 этап 4. Session 4 — accounts.ts fix, A13, Q24, Q27, Q29. Session 5 — Q25, Q26, Q28. Session 6 — S13, A5, Q22.*
