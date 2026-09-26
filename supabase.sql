-- WEEK. / Supabase schema
-- Выполни этот SQL в Supabase SQL Editor.
-- Важно: после создания таблиц включены RLS-политики.
 
create extension if not exists pgcrypto;
 
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Пользователь',
  email text,
  created_at timestamptz not null default now()
);
 
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  date date not null,
  start_time time,
  duration integer not null default 60 check (duration > 0),
  deadline timestamptz,
  category text not null default 'Другое',
  priority text not null default 'mandatory' check (priority in ('mandatory','desirable','optional')),
  fixed_time boolean not null default false,
  recurrence text,
  visibility text not null default 'private' check (visibility in ('private','shared')),
  status text not null default 'open' check (status in ('open','done','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
 
create table if not exists public.task_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  date date not null,
  start_time time,
  duration integer not null default 60,
  deadline timestamptz,
  category text not null default 'Другое',
  priority text not null default 'desirable' check (priority in ('mandatory','desirable','optional')),
  fixed_time boolean not null default false,
  recurrence text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now()
);
 
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'Другое',
  duration integer not null default 60,
  priority text not null default 'mandatory' check (priority in ('mandatory','desirable','optional')),
  created_at timestamptz not null default now()
);
 
create table if not exists public.time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
 
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_requests enable row level security;
alter table public.task_templates enable row level security;
alter table public.time_logs enable row level security;
 
-- Profiles: this is a two-person app, so any signed-in user needs to be able
-- to see both profiles (the app uses this to find "the other person" when
-- proposing shared tasks). Only the owner can insert/update their own row.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select using (auth.uid() is not null);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
 
-- Tasks:
-- Own private tasks are visible to owner.
-- Shared tasks are visible to both members of the two-person app.
-- For a real production app, replace the two-person check below with a memberships table.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select using (
  owner_id = auth.uid()
  or visibility = 'shared'
);
 
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert with check (owner_id = auth.uid());
 
-- Either person can update a shared task (e.g. mark it done); only the
-- owner can update their own private tasks.
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  owner_id = auth.uid() or visibility = 'shared'
);
 
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete using (owner_id = auth.uid());
 
-- Requests: sender can create/read their sent requests; recipient can read/update incoming requests.
drop policy if exists "requests_select" on public.task_requests;
create policy "requests_select" on public.task_requests for select using (
  from_user_id = auth.uid() or to_user_id = auth.uid()
);
drop policy if exists "requests_insert" on public.task_requests;
create policy "requests_insert" on public.task_requests for insert with check (from_user_id = auth.uid());
drop policy if exists "requests_update_recipient" on public.task_requests;
create policy "requests_update_recipient" on public.task_requests for update using (to_user_id = auth.uid());
 
-- Templates
drop policy if exists "templates_all_own" on public.task_templates;
create policy "templates_all_own" on public.task_templates for all using (user_id = auth.uid()) with check (user_id = auth.uid());
 
-- Time logs
drop policy if exists "logs_own" on public.time_logs;
create policy "logs_own" on public.time_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
 
-- Auto-create profile on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    new.email,
    lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)) || '_' || substr(new.id::text,1,6), '[^a-zA-Z0-9_а-яА-ЯёЁ-]', '', 'g'))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
 
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
 
-- Realtime: enable the tables you want to sync live.
-- Wrapped so re-running this whole script doesn't error if already added.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.task_requests;
exception when duplicate_object then null;
end $$;
-- Notification center / push events
create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.push_notification_event_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  endpoint text not null,
  sent_at timestamptz not null default now(),
  unique(event_id, endpoint)
);

alter table public.notification_events enable row level security;
alter table public.push_notification_event_log enable row level security;

drop policy if exists "notification_events_own" on public.notification_events;
create policy "notification_events_own"
on public.notification_events for select
using (recipient_id = auth.uid());

drop policy if exists "notification_events_no_client_write" on public.notification_events;
create policy "notification_events_no_client_write"
on public.notification_events for insert with check (false);
drop policy if exists "notification_events_no_client_update" on public.notification_events;
create policy "notification_events_no_client_update"
on public.notification_events for update using (false) with check (false);
drop policy if exists "notification_events_no_client_delete" on public.notification_events;
create policy "notification_events_no_client_delete"
on public.notification_events for delete using (false);

drop policy if exists "push_notification_event_log_none" on public.push_notification_event_log;
create policy "push_notification_event_log_none"
on public.push_notification_event_log for all using (false) with check (false);

create index if not exists notification_events_recipient_idx
on public.notification_events(recipient_id, created_at desc);

create or replace function public.create_week_notification(
  p_recipient uuid,
  p_actor uuid,
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  insert into public.notification_events(recipient_id, actor_id, type, title, body, data)
  values(p_recipient,p_actor,p_type,p_title,p_body,coalesce(p_data,'{}'::jsonb));
end;
$$;

create or replace function public.notify_task_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare actor_name text;
begin
  select display_name into actor_name from public.profiles where id=NEW.from_user_id;
  perform public.create_week_notification(
    NEW.to_user_id, NEW.from_user_id, 'request_created',
    'Новое предложение',
    coalesce(actor_name,'Кто-то') || ' предлагает задачу: ' || NEW.title,
    jsonb_build_object('request_id',NEW.id)
  );
  return NEW;
end;
$$;

drop trigger if exists task_request_created_notification on public.task_requests;
create trigger task_request_created_notification
after insert on public.task_requests
for each row execute function public.notify_task_request_created();

create or replace function public.notify_task_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare actor_name text; body_text text;
begin
  if OLD.status = NEW.status then return NEW; end if;
  select display_name into actor_name from public.profiles where id=NEW.to_user_id;
  if NEW.status = 'accepted' then
    body_text := coalesce(actor_name,'Пользователь') || ' принял(а) предложение: ' || NEW.title;
  elsif NEW.status = 'rejected' then
    body_text := coalesce(actor_name,'Пользователь') || ' отклонил(а) предложение: ' || NEW.title;
  else
    body_text := coalesce(actor_name,'Пользователь') || ' изменил(а) предложение: ' || NEW.title;
  end if;
  perform public.create_week_notification(
    NEW.from_user_id, NEW.to_user_id, 'request_' || NEW.status,
    case NEW.status when 'accepted' then 'Предложение принято' when 'rejected' then 'Предложение отклонено' else 'Предложение обновлено' end,
    body_text,
    jsonb_build_object('request_id',NEW.id,'status',NEW.status)
  );
  return NEW;
end;
$$;

drop trigger if exists task_request_status_notification on public.task_requests;
create trigger task_request_status_notification
after update of status on public.task_requests
for each row execute function public.notify_task_request_status();

create or replace function public.notify_shared_task_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient uuid; actor_name text;
begin
  if NEW.visibility <> 'shared' or OLD.status = 'done' or NEW.status <> 'done' then return NEW; end if;
  select id into recipient from public.profiles where id <> NEW.owner_id order by created_at limit 1;
  select display_name into actor_name from public.profiles where id=NEW.owner_id;
  perform public.create_week_notification(
    recipient, NEW.owner_id, 'shared_task_done',
    'Общая задача выполнена',
    coalesce(actor_name,'Пользователь') || ' выполнил(а): ' || NEW.title,
    jsonb_build_object('task_id',NEW.id)
  );
  return NEW;
end;
$$;

drop trigger if exists shared_task_done_notification on public.tasks;
create trigger shared_task_done_notification
after update of status on public.tasks
for each row execute function public.notify_shared_task_done();

do $$ begin
  alter publication supabase_realtime add table public.notification_events;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- Friends / multi-user support
-- ============================================================
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;
alter table public.profiles add column if not exists studies_at_school boolean;

-- Give existing accounts a stable username before adding uniqueness.
update public.profiles
set username = lower(regexp_replace(coalesce(nullif(display_name,''),'user') || '_' || substr(id::text,1,6), '[^a-zA-Z0-9_а-яА-ЯёЁ-]', '', 'g'))
where username is null or trim(username)='';

create unique index if not exists profiles_username_unique_idx on public.profiles(username);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id)
);

create index if not exists friend_requests_to_idx on public.friend_requests(to_user_id,status,created_at desc);
create index if not exists friend_requests_from_idx on public.friend_requests(from_user_id,status,created_at desc);
create unique index if not exists friend_requests_one_pending_per_pair_idx
on public.friend_requests (least(from_user_id,to_user_id),greatest(from_user_id,to_user_id))
where status='pending';

create table if not exists public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a,user_b),
  check (user_a < user_b)
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('school','extra')),
  day_of_week integer not null check (day_of_week between 0 and 6),
  title text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists schedule_items_user_day_idx on public.schedule_items(user_id,day_of_week,start_time);
alter table public.schedule_items enable row level security;
drop policy if exists "schedule_items_all_own" on public.schedule_items;
create policy "schedule_items_all_own" on public.schedule_items for all using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.task_members (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id,user_id)
);
create index if not exists task_members_user_idx on public.task_members(user_id,task_id);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.task_members enable row level security;

-- Profiles are searchable by username. The client only asks for public columns.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select using (auth.uid() is not null);

-- Friend requests
drop policy if exists "friend_requests_select" on public.friend_requests;
create policy "friend_requests_select" on public.friend_requests for select using (from_user_id=auth.uid() or to_user_id=auth.uid());
drop policy if exists "friend_requests_insert" on public.friend_requests;
create policy "friend_requests_insert" on public.friend_requests for insert with check (from_user_id=auth.uid() and from_user_id<>to_user_id);
drop policy if exists "friend_requests_update_recipient" on public.friend_requests;
create policy "friend_requests_update_recipient" on public.friend_requests for update using (to_user_id=auth.uid()) with check (to_user_id=auth.uid());

-- Friendships are read-only from the client; accepted requests create them via trigger.
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships for select using (user_a=auth.uid() or user_b=auth.uid());
drop policy if exists "friendships_no_client_insert" on public.friendships;
create policy "friendships_no_client_insert" on public.friendships for insert with check (false);
drop policy if exists "friendships_no_client_update" on public.friendships;
create policy "friendships_no_client_update" on public.friendships for update using (false) with check (false);
-- Любая из двух сторон дружбы может её разорвать ("удалить друга").
drop policy if exists "friendships_no_client_delete" on public.friendships;
drop policy if exists "friendships_delete_own" on public.friendships;
create policy "friendships_delete_own" on public.friendships for delete using (user_a=auth.uid() or user_b=auth.uid());

-- Отправитель может отменить свою ещё не рассмотренную заявку в друзья.
drop policy if exists "friend_requests_delete_sender" on public.friend_requests;
create policy "friend_requests_delete_sender" on public.friend_requests for delete using (from_user_id=auth.uid() and status='pending');

-- A task member can only be added by the task owner, and only if the other
-- person is that owner's friend. This prevents arbitrary cross-account access.
drop policy if exists "task_members_select_own" on public.task_members;
create policy "task_members_select_own" on public.task_members for select using (
  user_id=auth.uid()
  or exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid())
);
drop policy if exists "task_members_insert_owner_friend" on public.task_members;
create policy "task_members_insert_owner_friend" on public.task_members for insert with check (
  exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid())
  and (
    user_id=auth.uid()
    or exists(
      select 1 from public.friendships f
      where (f.user_a=least(auth.uid(),user_id) and f.user_b=greatest(auth.uid(),user_id))
    )
  )
);
drop policy if exists "task_members_delete_owner" on public.task_members;
create policy "task_members_delete_owner" on public.task_members for delete using (
  exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid())
);

-- Replace the old two-person task visibility rule.
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select using (
  owner_id=auth.uid()
  or exists(select 1 from public.task_members tm where tm.task_id=tasks.id and tm.user_id=auth.uid())
);
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  owner_id=auth.uid()
  or exists(select 1 from public.task_members tm where tm.task_id=tasks.id and tm.user_id=auth.uid())
);

-- Friend request acceptance creates a canonical friendship and notifies the sender.
create or replace function public.accept_friend_request()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if OLD.status='accepted' or NEW.status<>'accepted' then return NEW; end if;
  insert into public.friendships(user_a,user_b)
  values(least(NEW.from_user_id,NEW.to_user_id),greatest(NEW.from_user_id,NEW.to_user_id))
  on conflict do nothing;
  perform public.create_week_notification(
    NEW.from_user_id,NEW.to_user_id,'friend_accepted','Новый друг',
    coalesce((select display_name from public.profiles where id=NEW.to_user_id),'Пользователь') || ' принял(а) твою заявку в друзья',
    jsonb_build_object('friend_request_id',NEW.id)
  );
  return NEW;
end;
$$;
drop trigger if exists friend_request_accepted on public.friend_requests;
create trigger friend_request_accepted
after update of status on public.friend_requests
for each row execute function public.accept_friend_request();

create or replace function public.notify_friend_request_created()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.create_week_notification(
    NEW.to_user_id,NEW.from_user_id,'friend_request_created','Новая заявка в друзья',
    coalesce((select display_name from public.profiles where id=NEW.from_user_id),'Кто-то') || ' хочет добавить тебя в друзья',
    jsonb_build_object('friend_request_id',NEW.id)
  );
  return NEW;
end;
$$;
drop trigger if exists friend_request_created_notification on public.friend_requests;
create trigger friend_request_created_notification
after insert on public.friend_requests
for each row execute function public.notify_friend_request_created();

-- New shared tasks notify the selected friend.
create or replace function public.notify_shared_task_created()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare member_id uuid; actor_name text;
begin
  if NEW.visibility<>'shared' then return NEW; end if;
  select display_name into actor_name from public.profiles where id=NEW.owner_id;
  for member_id in select user_id from public.task_members where task_id=NEW.id and user_id<>NEW.owner_id loop
    perform public.create_week_notification(member_id,NEW.owner_id,'shared_task_created','Новая общая задача',coalesce(actor_name,'Пользователь') || ' добавил общую задачу: ' || NEW.title,jsonb_build_object('task_id',NEW.id));
  end loop;
  return NEW;
end;
$$;
drop trigger if exists shared_task_created_notification on public.tasks;
create trigger shared_task_created_notification
after insert on public.tasks
for each row execute function public.notify_shared_task_created();

-- Existing shared tasks become private-to-owner until they are explicitly shared with a friend.
insert into public.task_members(task_id,user_id)
select id,owner_id from public.tasks where visibility='shared'
on conflict do nothing;

-- RLS helpers avoid recursive policies when tasks and task_members reference each other.
create or replace function public.is_task_member(p_task uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.task_members where task_id=p_task and user_id=p_user);
$$;
create or replace function public.is_task_owner(p_task uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.tasks where id=p_task and owner_id=p_user);
$$;

drop policy if exists "task_members_select_own" on public.task_members;
create policy "task_members_select_own" on public.task_members for select using (
  user_id=auth.uid() or public.is_task_owner(task_id,auth.uid())
);
drop policy if exists "task_members_insert_owner_friend" on public.task_members;
create policy "task_members_insert_owner_friend" on public.task_members for insert with check (
  public.is_task_owner(task_id,auth.uid())
  and (
    user_id=auth.uid()
    or exists(select 1 from public.friendships f where f.user_a=least(auth.uid(),user_id) and f.user_b=greatest(auth.uid(),user_id))
  )
);
drop policy if exists "task_members_delete_owner" on public.task_members;
create policy "task_members_delete_owner" on public.task_members for delete using (public.is_task_owner(task_id,auth.uid()));

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select using (owner_id=auth.uid() or public.is_task_member(id,auth.uid()));
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (owner_id=auth.uid() or public.is_task_member(id,auth.uid()));

create or replace function public.notify_task_member_added()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid; owner_name text; task_title text; task_visibility text;
begin
  select t.owner_id,t.title,t.visibility into owner_id,task_title,task_visibility from public.tasks t where t.id=NEW.task_id;
  if task_visibility<>'shared' or owner_id is null or NEW.user_id=owner_id then return NEW; end if;
  select display_name into owner_name from public.profiles where id=owner_id;
  perform public.create_week_notification(NEW.user_id,owner_id,'shared_task_created','Новая общая задача',coalesce(owner_name,'Пользователь') || ' добавил общую задачу: ' || task_title,jsonb_build_object('task_id',NEW.task_id));
  return NEW;
end;
$$;
drop trigger if exists shared_task_member_added_notification on public.task_members;
create trigger shared_task_member_added_notification after insert on public.task_members for each row execute function public.notify_task_member_added();
