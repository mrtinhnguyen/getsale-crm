# bd-accounts-service: TIMEOUT из GramJS (runbook)

## Что за ошибка

В логах может появляться:

```
Error: TIMEOUT
    at .../node_modules/telegram/client/updates.js:250:85
    at async attempts (.../telegram/client/updates.js:234:20)
    at async _updateLoop (.../telegram/client/updates.js:184:17)
```

**Источник:** библиотека [GramJS](https://github.com/gram-js/gramjs) (пакет `telegram`). Внутренний цикл `_updateLoop` ждёт апдейты от серверов Telegram; если за заданный интервал данные не приходят (тишина на соединении, сетевая задержка, миграция ДЦ), библиотека выбрасывает `Error: TIMEOUT`. Это не баг нашего кода и не обязательно обрыв TCP.

Известные issues: [gram-js/gramjs#302](https://github.com/gram-js/gramjs/issues/302), [gram-js/gramjs#494](https://github.com/gram-js/gramjs/issues/494).

## Что делает сервис

- **Keepalive:** каждую минуту вызывается `updates.GetState()`, чтобы Telegram не переставал слать апдейты.
- **Обработка TIMEOUT:** при TIMEOUT из `updates.js` сервис планирует переподключение всех активных клиентов (debounce 12 с) и перезапускает циклы обновлений.
- **Логирование:** TIMEOUT логируется как **warning** с текстом вроде «Update loop TIMEOUT (GramJS), reconnecting clients — expected under load or idle connection», а не как error.

## Рекомендации

- **Мониторинг/алерты:** не считать TIMEOUT критичной ошибкой; при желании фильтровать по сообщению или уровню (warning).
- **Если таймауты учащаются:** проверить сеть до Telegram, нагрузку на инстанс; при необходимости уменьшить интервал keepalive в `TelegramManager.UPDATE_KEEPALIVE_MS` (сейчас 1 мин).
- **Версия GramJS:** в `package.json` указана `telegram: ^2.26.22`. При обновлении библиотеки сверяться с [changelog](https://github.com/gram-js/gramjs/releases) на тему update loop и таймаутов.
