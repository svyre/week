# Настоящие push-уведомления для week.

В проект добавлена схема Web Push: браузер сохраняет push-подписку в Supabase, а Edge Function раз в минуту проверяет задачи и отправляет напоминания.

## 1. SQL

В Supabase → SQL Editor выполни:

`push_setup.sql`

## 2. VAPID-ключи

В терминале выполни:

```powershell
npx.cmd web-push generate-vapid-keys
```

Получишь `publicKey` и `privateKey`.

- `publicKey` вставь в `config.js`:
  `window.VAPID_PUBLIC_KEY = "..."`
- `privateKey` **не добавляй в GitHub**.

## 3. Секреты Supabase

В Supabase → Edge Functions → Secrets добавь:

- `VAPID_PUBLIC_KEY` = publicKey
- `VAPID_PRIVATE_KEY` = privateKey
- `VAPID_SUBJECT` = `mailto:твой-email@example.com`

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Edge Function использует из окружения проекта.

## 4. Секреты Edge Function

В Supabase → Edge Functions → Secrets добавь:

- `VAPID_PUBLIC_KEY` = publicKey
- `VAPID_PRIVATE_KEY` = privateKey
- `VAPID_SUBJECT` = `mailto:твой-email@example.com`
- `CRON_SECRET` = придумай длинную случайную строку

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Edge Function использует из окружения проекта.

## 5. Edge Function

Нужен Supabase CLI. Из папки проекта:

```powershell
supabase login
supabase link --project-ref slxnlvvdwluhszwvwgmo
supabase functions deploy send-task-reminders
```

## 6. Запуск каждую минуту

В Supabase → Cron создай Job с расписанием `* * * * *` и HTTP-запросом:

- URL: `https://slxnlvvdwluhszwvwgmo.supabase.co/functions/v1/send-task-reminders`
- Method: `POST`
- Header: `x-cron-secret: <тот же CRON_SECRET>`
- Body: `{}`

Supabase Cron умеет вызывать Edge Functions по расписанию; это позволяет проверять задачи примерно раз в минуту.

После этого пользователь включает «Уведомления» в week., разрешает push — и сервер сможет присылать напоминания за 5/10/15/30 минут до задачи.

Важно: не добавляй `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` или `CRON_SECRET` в `config.js` и GitHub.
