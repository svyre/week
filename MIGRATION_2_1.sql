-- week. 2.1: индексы и приватный email для группы до 50 пользователей.
-- Сначала выполни эту миграцию, затем публикуй обновлённый app.js.
-- Миграция не удаляет пользовательские данные.

create index if not exists tasks_owner_date_21_idx on public.tasks(owner_id, date);
create index if not exists tasks_date_21_idx on public.tasks(date);
create index if not exists tasks_open_date_21_idx on public.tasks(date) where status = 'open';
create index if not exists tasks_recurring_date_21_idx on public.tasks(date) where recurrence is not null;
do $$ begin
  if to_regclass('public.notification_events') is not null then
    execute 'create index if not exists notification_events_created_21_idx on public.notification_events(created_at desc)';
  end if;
end $$;
create index if not exists time_logs_user_started_21_idx on public.time_logs(user_id, started_at desc);
create index if not exists task_requests_to_status_21_idx on public.task_requests(to_user_id, status, created_at desc);
create index if not exists task_requests_from_created_21_idx on public.task_requests(from_user_id, created_at desc);

-- В таблице profiles остаются приватные поля владельца, включая email.
-- Поиск друзей использует представление только с публичными полями.
create or replace view public.public_profiles
with (security_barrier = true)
as
  select id, display_name, username
  from public.profiles
  where auth.uid() is not null;
revoke all on public.public_profiles from public, anon;
grant select on public.public_profiles to authenticated;

drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());

-- НЕ менять права на public_profiles на security_invoker=true:
-- владельцы других аккаунтов скрыты RLS у profiles, а поиску нужны их публичные username.

-- Общие задачи: уведомляем участников конкретной задачи, а не случайный аккаунт.
create or replace function public.notify_shared_task_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient uuid;
        actor uuid;
        actor_name text;
begin
  if NEW.visibility <> 'shared' or OLD.status = 'done' or NEW.status <> 'done' then return NEW; end if;
  actor := coalesce(auth.uid(), NEW.owner_id);
  select display_name into actor_name from public.profiles where id = actor;
  for recipient in
    select tm.user_id from public.task_members tm
    where tm.task_id = NEW.id and tm.user_id <> actor
  loop
    perform public.create_week_notification(
      recipient, actor, 'shared_task_done', 'Общая задача выполнена',
      coalesce(actor_name, 'Пользователь') || ' выполнил(а): ' || NEW.title,
      jsonb_build_object('task_id', NEW.id)
    );
  end loop;
  return NEW;
end;
$$;

notify pgrst, 'reload schema';
