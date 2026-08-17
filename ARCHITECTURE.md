# Архитектура

## Обзор

Electron-приложение с двумя процессами:

- **main** (`electron/`) — вся работа с системой: процессы Rust, RCON, файлы, планировщик, уведомления, IPC.
- **renderer** (`src/`) — React SPA (Vite): страницы, вкладки сервера, контексты состояния.

Рендерер **никогда** не имеет доступа к Node — только через безопасный мост
`preload.ts` (`window.rustManager`). Типы моста описаны в `src/vite-env.d.ts`.

## Main-процесс: модули

| Модуль | Ответственность |
|---|---|
| `main.ts` | Инициализация, окно/трей, регистрация всех IPC-хендлеров |
| `rust-process.ts` | Запуск/остановка процесса, watchdog, лог-файл `Logs/server-<id>.log`, определение внешних серверов |
| `rcon.ts` | WebRcon-клиент (URL-пароль + фолбэк `rcon.login`), очередь команд, heartbeat |
| `metrics.ts` | Сбор телеметрии (pidusage + RCON `serverinfo`/`fps`) |
| `metrics-history.ts` | Персистентная история метрик (1 точка/мин, ~30 дней) |
| `tasks.ts` | Общий планировщик: перезапуски, предупреждения, автобэкапы, авторазбаны |
| `wipe.ts` | Выполнение вайпа (`.map`/`.db`, новый сид) |
| `backup.ts` | Бэкапы мира (создание/список/восстановление/удаление) |
| `plugins.ts` | Сканирование Oxide, обновление с uMod, вкл/выкл, конфиги |
| `marketplace.ts` | Каталог и поиск по uMod (search.json + точный slug) |
| `mods.ts` | Установка/удаление фреймворка Oxide (uMod) (ZIP, adm-zip) |
| `config.ts` | Чтение/запись/санитизация `server.cfg` |
| `steamcmd.ts` | Обновление серверной части через SteamCMD |
| `ports.ts` | Статусы портов (netstat/tasklist), Windows Firewall (UAC), TCP-пробы |
| `notifications.ts` | Центр уведомлений + системные тосты Windows |
| `telegram.ts`, `discord.ts` | Внешние уведомления |
| `locale.ts` | Язык main-процесса (для трея и текстов уведомлений) |

## IPC-контракт

- Хендлеры регистрируются в `main.ts` (`registerIpc`), имена вида `domain:action`
  (`server:start`, `rcon:player-action`, `wipes:scheduled-add`, `ports:firewall-open`, …).
- Мост: `preload.ts` → `ipcRenderer.invoke`, экспонируется как `window.rustManager`.
- Типы: `electron/types.ts` (main) и `src/types/index.ts` (renderer) — дублируются
  намеренно, т.к. компиляция идёт отдельными tsconfig.
- События (push): `broadcast(channel, payload)` → `wc.send(...)`; подписки рендерера
  оформлены как `on<Event>(callback): unsubscribe` в preload.

Правило: **любой новый IPC-метод** должен быть добавлен в четыре места —
`main.ts` (хендлер), `preload.ts` (мост), `vite-env.d.ts` (тип), а типы данных — в оба `types.ts`.

## Планировщик (`tasks.ts`)

Задачи хранятся в `userData/scheduled-tasks.json`; тик каждые 15 с.
Повторяющиеся (`restart`, `backup`) пересчитывают `nextRun` сразу в тике,
одноразовые (`restartwarn`, `unban`) удаляются перед выполнением.
Действия инжектируются из `main.ts` (колбэки `TaskActions`) — модуль остаётся тестируемым.

## Данные рендерера

- `ServerContext` — список серверов (localStorage) + статусы, синхронизация с main (`server:sync-servers`).
- `MetricsContext` — поток метрик; история для графиков тянется через `metrics:history`.
- i18n — `i18next` (RU/EN), язык синхронизируется с main (`locale:set`).

## Тесты

`tests/` — модульные тесты на `node:test` для чистых модулей
(`tasks`, `backup`, `wipe`, `config`, `ports`, `logtail`). Запуск: `npm test`
(сначала компилируется electron в `dist-electron`).
