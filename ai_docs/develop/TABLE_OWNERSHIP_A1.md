# Владение таблицами и миграция A1

**Цель:** Один владелец на таблицу; остальные сервисы обращаются к данным только через API или события (без прямого доступа к чужим таблицам).

## Назначенное владение

| Таблицы | Владелец | Примечание |
|---------|----------|------------|
| `messages`, `conversations` | **messaging-service** | Единственный сервис, который пишет/читает эти таблицы. |
| `bd_accounts`, `bd_account_sync_*` | **bd-accounts-service** | Синк чатов, папок, аккаунты. |
| `pipelines`, `stages`, `pipeline_leads` | **pipeline-service** | Уже изолированы. |
| `organizations`, `users`, `refresh_tokens`, … | **auth-service** | Уже изолированы. |

## Текущие нарушения (до миграции)

- **bd-accounts-service** пишет в `messages` и `conversations` (message-db, event-handlers, telegram-manager): создание сообщений, ensure conversation, удаление по событиям Telegram, правка по edit.
- **messaging-service** пишет в `bd_account_sync_chats` в одном месте (messages.ts при отправке) и читает `bd_account_sync_chats` для списков чатов и истории.

## План миграции (этапы)

### Этап 1 (реализован)
- **Messaging** предоставляет внутренний API:
  - `POST /internal/conversations/ensure` — создание/обновление conversation.
  - `POST /internal/messages` — создание/upsert сообщения (по bd_account_id, channel_id, telegram_message_id); тело: organizationId, bdAccountId, contactId, channel, channelId, direction, status, unread, serialized, metadata, reactions?, our_reactions?.
- **bd-accounts** при сохранении входящего/исходящего сообщения вызывает этот API вместо прямой записи в БД. `MessageDb` принимает опциональный `messagingClient`; при его наличии `ensureConversation` и `saveMessageToDb` идут через HTTP к messaging-service. В bd-accounts index создаётся `ServiceHttpClient` к `MESSAGING_SERVICE_URL` и передаётся в `TelegramManager` → `MessageDb`. Удаление и редактирование сообщений по событиям Telegram по-прежнему выполняются в bd-accounts прямыми запросами к `messages` (этап 2).

### Этап 2 (реализован 2026-03-17)
- **Messaging** добавлены внутренние операции:
  - `PATCH /internal/messages/edit-by-telegram` — правка по (bdAccountId, channelId, telegramMessageId, content, telegram_entities?, telegram_media?).
  - `POST /internal/messages/delete-by-telegram` — удаление по (bdAccountId, channelId?, telegramMessageIds[]), возврат `{ deleted: [{ id, organization_id, channel_id, telegram_message_id }] }`.
- **bd-accounts** в `telegram/event-handlers.ts` удаление и редактирование переведены на `MessageDb.deleteByTelegram` и `MessageDb.editByTelegram` (при наличии messagingClient — вызов API messaging; иначе прямой запрос к БД). Активный путь: `telegram/index.ts` → EventHandlerSetup.

### Этап 3 (частично реализован 2026-03-17)
- **Messaging** перестал писать в `bd_account_sync_chats`: при отправке сообщения в Telegram блок INSERT в `bd_account_sync_chats` удалён; чаты добавляются только из UI синка (POST sync-chats в bd-accounts).
- **bd-accounts** внутренний endpoint для «добавить чат в синк» по запросу messaging — в бэклоге (не обязателен при текущем сценарии).

### Этап 4 (реализован 2026-03-17)
- **bd-accounts** добавлен внутренний роутер `routes/internal.ts`: `GET /internal/sync-chats?bdAccountId=...` с заголовком `X-Organization-Id`; возвращает `{ chats: [{ telegram_chat_id, title, peer_type, history_exhausted, folder_id, folder_ids }] }`. Роутер смонтирован по пути `/internal`.
- **Messaging** переведён на чтение данных о чатах через этот API:
  - `chats.ts`: при запросе списка чатов с `bdAccountId` — вызов bd-accounts `GET /internal/sync-chats`, затем сборка ответа по CTE `sync_list` из JSON (без чтения `bd_account_sync_chats`).
  - `messages-list-helpers.ts`: `getHistoryExhausted` и `enrichMessagesWithSenderNames` принимают опциональный `apiOptions: { bdAccountsClient, organizationId }`; при передаче — запрос к `GET /internal/sync-chats` и выбор нужного чата по `telegram_chat_id`. В `messages.ts` при наличии bdAccountId и organizationId в API передаётся этот контекст.
- Оставшееся чтение `bd_account_sync_chats` в messaging: ветка GET /chats без фильтра по bdAccountId (общий список по каналам) и GET /search — по-прежнему используют JOIN с `bd_account_sync_chats`; при необходимости можно вынести в отдельный внутренний endpoint (по одному вызову на bd_account_id из `latest_per_chat`).

## Контракты внутреннего API

- Все внутренние вызовы защищены заголовком `X-Internal-Auth` (INTERNAL_AUTH_SECRET). Контекст организации/пользователя передаётся в заголовках `X-Organization-Id`, `X-User-Id` при необходимости.
- См. также [INTERNAL_API.md](../../docs/INTERNAL_API.md) и [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) (безопасность gateway и бэкендов).

## Сводка: что сделано / что осталось

| Этап | Статус | Примечание |
|------|--------|------------|
| 1 | ✅ | ensure + create message через internal API; bd-accounts MessageDb с messagingClient |
| 2 | ✅ | edit/delete через PATCH и POST internal; event-handlers используют MessageDb |
| 3 | ✅ | messaging не пишет в bd_account_sync_chats при отправке |
| 4 | ✅ | bd-accounts GET /internal/sync-chats; messaging chats (при bdAccountId) и messages-list-helpers используют API; оставшиеся ветки GET /chats (без bdAccountId) и GET /search — в бэклоге при желании |
