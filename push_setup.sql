-- WEEK. / Web Push
-- Выполни ПОСЛЕ основного supabase.sql.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  lead_minutes integer not null default 15 check (lead_minutes in (5,10,15,30)),
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create table if not exists public.push_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  endpoint text not null,
  kind text not null default 'task_reminder',
  sent_for timestamptz not null default now(),
  unique(user_id, task_id, endpoint, kind)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_log enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_notification_log_none" on public.push_notification_log;
-- Лог отправок не нужен клиенту. Edge Function обращается к нему через service role.

create index if not exists push_subscriptions_enabled_idx
  on public.push_subscriptions(enabled, user_id);
create index if not exists push_notification_log_task_idx
  on public.push_notification_log(task_id, user_id);
