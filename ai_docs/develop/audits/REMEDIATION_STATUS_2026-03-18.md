# Статус ремедиации по аудиту 2026-03-18

**Связанный отчёт:** [2026-03-18-full-system-audit.md](2026-03-18-full-system-audit.md)

---

## Что сделано

| ID | Задача | Где |
|----|--------|-----|
| **A1 / S2** | Orphan messages при удалении BD-аккаунта перенесён в messaging-service | messaging-service: `POST /internal/messages/orphan-by-bd-account`; bd-accounts `accounts.ts`: вызов API, убран прямой `UPDATE messages` |
| **S1** | Internal API: приоритет заголовка X-Organization-Id над body | messaging-service `internal.ts`: `getOrganizationId(req, bodyOrgId)` для ensure и POST /messages |
| **S3** | Рекомендация INTERNAL_AUTH_SECRET в dev/staging | docs/DEPLOYMENT.md |
| **S4** | Edit/delete-by-telegram требуют X-Organization-Id и проверка org в WHERE | internal.ts: обязательный header, `AND organization_id = $orgId`; message-db.ts + event-handlers: передача organizationId в контексте |
| **S5** | В production не отдавать детали валидации Zod | internal.ts: при NODE_ENV=production ответ «Validation failed» |
| **A4** | withOrgContext в messaging-service | internal.ts (ensure, POST /messages); chats.ts (GET /chats, GET /search) |
| **Doc** | Internal endpoints в INTERNAL_API.md | Добавлен orphan-by-bd-account; уточнены edit/delete-by-telegram (X-Organization-Id) |
| **Q1 (баг)** | GET /chats внутри withOrgContext | Ранние выходы при channel!==telegram и при !chats?.length возвращают `[]`, а не `res.json([])` (избежание двойной отправки) |
| **Q2** | Пустые catch в bd-accounts Telegram | В telegram-manager во всех пустых catch добавлено логирование (log.debug): disconnect, регистрация Raw/Short/NewMessage, UpdateUserTyping/ChatUserTyping/UpdateUserStatus/UpdateReadHistoryInbox/UpdateReadChannelInbox/UpdateDraftMessage, contact insert, wrap (other handlers) |
| **A5, Q1 (рефактор)** | Вынос запросов списка чатов из chats.ts | messaging-service: создан chats-list-helpers.ts (getSyncListQuery, getDefaultChatsQuery, normalizeChatRows, runSyncListQuery, runDefaultChatsQuery); GET /chats использует эти хелперы |
| **Shared chat в списке** | После создания общего чата с лидом чат появляется в списке чатов аккаунта | bd-accounts-service routes/messaging.ts: после createSharedChat выполняется INSERT в bd_account_sync_chats (peer_type=chat); GET /chats при выборе bdAccountId тянет список из sync-chats, новый чат сразу в списке |

---

## Что осталось

- **A1 (остаток):** GET /chats без bdAccountId и GET /search по-прежнему используют JOIN с `bd_account_sync_chats`. Опционально: получать данные через bd-accounts internal API.
- **A3:** Слой репозитория (High, большой объём).
- **A5, Q1:** Дальнейшее разбиение chats.ts (остальные хендлеры в отдельные модули при необходимости) — базовая выноска запросов сделана.
- **A6, Q3–Q4:** Сократить any в bd-accounts Telegram; вынести filterToApiMessages.
- **S15, S16:** CSP (nonces/hashes), theme script без dangerouslySetInnerHTML.
- **Q5–Q16:** DRY пагинация, frontend API layer, типы, тесты и др. — по плану и бэклогу.

Сводка приоритетов: раздел «Осталось» в [STATE_AND_ROADMAP.md](../../docs/STATE_AND_ROADMAP.md) и раздел «Remediation applied» в отчёте 2026-03-18.
