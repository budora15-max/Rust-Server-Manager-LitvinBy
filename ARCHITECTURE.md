# Архитектура

Заметки для тех, кто полезет в код. Не претендуют на полноту — просто карта местности.

## Два процесса

Electron-приложение, всё стандартно:

- `electron/` — main: процессы Rust, файлы, планировщик, RCON, трей, уведомления.
- `src/` — renderer: React + Vite, чистый UI.

Рендерер от Node отрезан, всё общение идёт через `preload.ts` (глобал `window.rustManager`). Типы моста — в `src/vite-env.d.ts`, а типы данных дублируются в `electron/types.ts` и `src/types/index.ts`, потому что у бэкенда и рендерера разные tsconfig. Да, это дубль — так и живём.

## Что где лежит

- `main.ts` — точка входа: окна, трей, все IPC-хендлеры.
- `rust-process.ts` — запуск/остановка сервера, лог в `Logs/server-<id>.log`, подхват живых процессов после рестарта менеджера, watchdog (авторестарт при краше/зависании).
- `rcon.ts` — WebRcon: пароль в URL (официальный Facepunch) + фолбэк на `rcon.login`, очередь команд и heartbeat.
- `metrics.ts` / `metrics-history.ts` — телеметрия: pidusage + RCON (`fps`, `serverinfo`), история раз в минуту на 30 дней для графиков.
- `tasks.ts` — планировщик: рестарты, предупреждения, бэкапы, авторазбан. Живёт в main, работает без открытого окна.
- `wipe.ts` / `backup.ts` — чистка `.map`/`.db` + смена сида; бэкапы мира по таймстампу.
- `plugins.ts`, `mods.ts`, `marketplace.ts` — Oxide: установка фреймворка из zip, сканирование плагинов, отключение через `.disabled`, каталог uMod.
- `config.ts` — парсер `server.cfg`: читает/пишет, значения с пробелами заворачивает в кавычки.
- `ports.ts` — занятость портов (netstat/tasklist/ss), firewall Windows (UAC), TCP-пробы наружу.
- `notifications.ts`, `alerts.ts` — алерты: системные пуши + вебхуки Telegram и Discord.
- `locale.ts` — локализация main (трей, уведомления).

## IPC

Правила простые:

1. UI зовёт через `window.rustManager.*`, хендлеры в `registerIpc`, каналы вида `домен:действие` (`server:start`, `ports:firewall-open`).
2. Бэкенд шлёт события через `broadcast()` (обёртка над `webContents.send`); в React подписка через `onEvent(callback)`, возвращает unsubscribe.
3. Типы дублируются: `electron/types.ts` и `src/types/index.ts` — у бэкенда и рендерера разные tsconfig.

> Новый IPC-метод = правки в 4 местах: хендлер в `main.ts`, обёртка в `preload.ts`, типы в `vite-env.d.ts` и структуры в обоих `types.ts`.

## Планировщик

- Задачи в `userData/scheduled-tasks.json`.
- Тик каждые 15 секунд.
- У циклических задач (`restart`, `backup`) `nextRun` пересчитывается на тике, одноразовые (предупреждение в чат, разбан) выпиливаются перед исполнением.
- Действия инжектятся извне (`TaskActions`), чтобы тестировать без Electron.

## UI и данные

- Серверы — в `ServerContext`, список в `localStorage`, статусы синхронизируются через `server:sync-servers`.
- Метрики: живой поток через контекст, история подтягивается при переключении табов (`metrics:history`).
- Переводы: i18next (RU/EN), смена языка шлёт `locale:set` в main.

## Тесты

`tests/` на `node:test`, без Jest/Vitest. Тестируем только чистые модули (config, ports, scheduler, backups), не зависящие от Electron. Запуск: `npm test` (сам компилит бэкенд в `dist-electron`).


