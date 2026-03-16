# Полный аудит документации и кода проекта

**Дата:** 2026-02 (обновлено 2026-03)  
**Область:** документация (§3–§15, PHASE 2.x), messaging-service, campaign-service, bd-accounts-service, migrations, frontend.  
**Цель:** выявить устаревшую документацию, расхождения между сервисами, технический долг и архитектурные риски. Код не изменялся — только анализ.

**Связанный отчёт:** [FULL_SYSTEM_AUDIT_2026.md](FULL_SYSTEM_AUDIT_2026.md) — полный системный аудит (архитектура, фронт/UX, AI, масштабируемость, governance, конкуренты, вердикт). Ключевые выводы: зрелость 5.5–6/10; критичные риски — общая БД без контрактов, отсутствие retry/circuit breaker при вызовах AI и bd-accounts, рост таблицы messages без партиционирования, отсутствие алертов и DLQ; приоритет — Reliability (retry/circuit breaker, алерты, DLQ), затем Scale и AI expansion. В марте 2026 выполнена очистка документации (единый источник — STATE_AND_ROADMAP, объединённые ARCHITECTURE, GETTING_STARTED, TESTING, STAGES, MESSAGING_ARCHITECTURE, CAMPAIGNS).

---

## 1. Архитектурная карта проекта

### 1.1 Сервисы (релевантные этапу 7)

| Сервис | Порт | Назначение |
|--------|------|------------|
| **api-gateway** | — | Проксирует `/api/messaging` → messaging-service, `/api/campaigns` → campaign-service, `/api/bd-accounts` → bd-accounts-service. Аутентификация, rate limit. |
| **messaging-service** | 3003 | Чаты, сообщения, conversations, lead-context, new-leads, create-shared-chat, mark-won, mark-lost. Единая точка создания conversation (ensureConversation). |
| **campaign-service** | 3012 | Кампании, участники, последовательности, статистика воронки (total_sent, total_read, total_replied, shared, won, revenue). Запуск/пауза, отправка по расписанию. |
| **bd-accounts-service** | 3007 | Telegram-клиенты, синхронизация чатов, **create-shared-chat** (CreateChannel + InviteToChannel). Вызывается messaging-service по HTTP. |
| **pipeline-service** | 3008 | Воронки, стадии, лиды, PATCH stage, lead_activity_log при смене стадии. |

### 1.2 Зависимости между сервисами

```
api-gateway
  ├── messaging-service  (GET/POST /api/messaging/*)
  ├── campaign-service  (GET/POST /api/campaigns/*)
  └── bd-accounts-service (GET/POST /api/bd-accounts/*)

messaging-service
  └── bd-accounts-service (POST /api/bd-accounts/:id/create-shared-chat) — только при создании общего чата

campaign-service
  └── (читает/пишет общую БД: conversations, campaign_*, messages)
```

- **Общая БД:** messaging-service, campaign-service, pipeline-service, bd-accounts-service используют один и тот же PostgreSQL (один DATABASE_URL в docker-compose). Таблицы `conversations`, `messages`, `campaigns`, `campaign_participants`, `campaign_sends`, `leads`, `lead_activity_log` доступны и messaging, и campaign.
- **Cross-service вызов:** только messaging → bd-accounts (create-shared-chat). Остальное — через общую БД.

### 1.3 Основные доменные сущности

| Сущность | Описание |
|----------|----------|
| **Conversation** | Один бизнес-диалог (org, bd_account_id, channel, channel_id). Поля: lead_id, campaign_id, became_lead_at, first_manager_reply_at, shared_chat_created_at, shared_chat_channel_id, won_at, revenue_amount, lost_at, loss_reason. |
| **Lead** | Состояние conversation в воронке (pipeline_id, stage_id, contact_id). |
| **Campaign** | Рассылка (participants, sequences, templates, campaign_sends). |
| **Message** | Сообщение в канале (в т.ч. системные [System] для shared/won/lost). |

### 1.4 Ключевые таблицы (миграции)

| Таблица | Миграция | Назначение |
|---------|----------|------------|
| conversations | 20250615000001 + 20250623000001 (first_manager_reply_at) + 20250624000001 (shared_chat_created_at) + 20250626000001 (shared_chat_channel_id) + 20250627000001 (won_at, revenue_amount, lost_at, loss_reason) | Состояние диалога, воронка, revenue. |
| lead_activity_log | 20250615000002 | Таймлайн лида (lead_created, stage_changed, deal_created, campaign_reply_received). |
| campaign_participants, campaign_sends | 20250217000001 (+ последующие) | Участники кампании и факты отправки. |
| messages | initial + 20250128100000 (telegram), 20250222000001 (reactions) | Сообщения + системные события. |
| organization_settings | 20250625000001 | Настройки shared_chat (titleTemplate, extraUsernames). |

### 1.5 Основные API endpoints (этап 7)

**messaging-service:**
- GET `/api/messaging/chats` — список чатов (conversation_id, lead_id, lead_stage_name, lead_pipeline_name).
- GET `/api/messaging/new-leads` — новые лиды (first_manager_reply_at IS NULL).
- GET `/api/messaging/conversations/:id/lead-context` — полный контракт Lead Panel (включая won_at, lost_at, shared_chat_channel_id).
- POST `/api/messaging/send` — отправка, проставление first_manager_reply_at.
- POST `/api/messaging/create-shared-chat` — создание группы в TG, запись shared_chat_channel_id, системное сообщение.
- POST `/api/messaging/mark-shared-chat` — legacy, только флаг shared_chat_created_at.
- POST `/api/messaging/mark-won` — won_at, revenue_amount, системное сообщение.
- POST `/api/messaging/mark-lost` — lost_at, loss_reason, системное сообщение.

**campaign-service:**
- GET `/api/campaigns` — список с mini-KPI (total_sent, total_read, total_replied, total_converted_to_shared_chat, total_won, total_revenue).
- GET `/api/campaigns/:id/stats` — воронка + конверсии + total_won, total_lost, total_revenue, win_rate, avg_time_to_shared_hours, avg_time_to_won_hours.
- GET `/api/campaigns/:id/participants` — таблица лидов (status_phase, sent_at, replied_at, shared_chat_created_at, filter=all|replied|not_replied|shared).

**bd-accounts-service:**
- POST `/api/bd-accounts/:id/create-shared-chat` — CreateChannel + InviteToChannel, возврат channelId, title.

---

## 2. Актуальные аудиты и состояние

- **Код-аудиты и remediation:** [ai_docs/develop/audits/](../ai_docs/develop/audits/) — последний: [2026-03-18-full-system-audit.md](../ai_docs/develop/audits/2026-03-18-full-system-audit.md). История ремедиации: [REMEDIATION_STATUS_2026-03-15.md](../ai_docs/develop/audits/REMEDIATION_STATUS_2026-03-15.md).
- **Продуктовый и стратегический аудит:** [FULL_SYSTEM_AUDIT_2026.md](FULL_SYSTEM_AUDIT_2026.md).
- **Текущее состояние и дорожная карта:** [STATE_AND_ROADMAP.md](STATE_AND_ROADMAP.md).

Детальные разделы по актуальности документации (§3–§15), реализации по PHASE, расхождениям, техдолгу и рекомендациям ранее входили в этот отчёт; актуальная картина отражена в перечисленных документах и в последнем код-аудите.
