# week. — настоящие push-уведомления

Ниже настройка с нуля. Важно: **секретные ключи не кладём в `config.js` и GitHub**.

## Шаг 1. SQL

1. Открой Supabase Dashboard и свой проект.
2. Слева: **SQL Editor**.
3. Нажми **New query**.
4. Открой файл `push_setup.sql` из этой папки.
5. Скопируй всё содержимое в SQL Editor.
6. Нажми **Run**.

## Шаг 2. VAPID-ключи

В терминале в папке проекта:

```powershell
npm.cmd install web-push
npx.cmd web-push generate-vapid-keys
```

Сохрани `Public Key` и `Private Key`.

В свой существующий `config.js` добавь только публичный ключ:

```js
window.VAPID_PUBLIC_KEY = "ТВОЙ_PUBLIC_KEY";
```

Не вставляй Private Key в `config.js`.

## Шаг 3. Установить Supabase CLI

Если CLI ещё нет:

```powershell
npm.cmd install -g supabase
```

Проверь:

```powershell
supabase --version
```

## Шаг 4. Создать Edge Function

В папке проекта функция уже находится здесь:

`supabase/functions/send-task-reminders/index.ts`

Авторизация и привязка проекта:

```powershell
supabase login
supabase link --project-ref slxnlvvdwluhszwvwgmo
```

## Шаг 5. Секреты

В Supabase Dashboard открой:

**Edge Functions → Secrets**

Добавь:

- `VAPID_PUBLIC_KEY` = Public Key
- `VAPID_PRIVATE_KEY` = Private Key
- `VAPID_SUBJECT` = `mailto:ТВОЙ_EMAIL`
- `CRON_SECRET` = длинная случайная строка

Не публикуй `VAPID_PRIVATE_KEY` и `CRON_SECRET`.

## Шаг 6. Deploy

Из корня проекта:

```powershell
supabase functions deploy send-task-reminders
```

## Шаг 7. Cron

В Supabase Dashboard открой **Integrations / Cron** (название пункта может отличаться по версии интерфейса).

Создай Job:

- Schedule: `* * * * *`
- Method: `POST`
- URL:
  `https://ТВОЙ_PROJECT_REF.supabase.co/functions/v1/send-task-reminders`
- Header:
  `x-cron-secret: ТВОЙ_CRON_SECRET`
- Body: `{}`

## Шаг 8. Настройка в приложении

1. Открой опубликованный `week.` по HTTPS.
2. Войди в аккаунт.
3. Открой **Настройки**.
4. Включи уведомления.
5. Разреши уведомления браузеру.
6. Выбери 5, 10, 15 или 30 минут.

После этого сервер каждую минуту проверяет задачи и отправляет push-уведомление в выбранный момент.

## Что уже есть в коде

- PWA service worker принимает push.
- Подписка устройства сохраняется в `push_subscriptions`.
- Серверная функция учитывает часовой пояс устройства.
- Напоминание отправляется один раз.
- Удалённые/недействительные push-подписки очищаются автоматически.
- Для обычных браузеров остаются локальные уведомления как запасной вариант.
