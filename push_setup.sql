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

-- Event notifications: proposals, accepted/rejected, shared task completion.
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
create policy "notification_events_own" on public.notification_events for select using (recipient_id = auth.uid());
drop policy if exists "notification_events_no_client_write" on public.notification_events;
create policy "notification_events_no_client_write" on public.notification_events for insert with check (false);
drop policy if exists "notification_events_no_client_update" on public.notification_events;
create policy "notification_events_no_client_update" on public.notification_events for update using (false) with check (false);
drop policy if exists "notification_events_no_client_delete" on public.notification_events;
create policy "notification_events_no_client_delete" on public.notification_events for delete using (false);
drop policy if exists "push_notification_event_log_none" on public.push_notification_event_log;
create policy "push_notification_event_log_none" on public.push_notification_event_log for all using (false) with check (false);

create index if not exists notification_events_recipient_idx on public.notification_events(recipient_id, created_at desc);

create or replace function public.create_week_notification(
  p_recipient uuid, p_actor uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null or p_recipient = p_actor then return; end if;
  insert into public.notification_events(recipient_id, actor_id, type, title, body, data)
  values(p_recipient,p_actor,p_type,p_title,p_body,coalesce(p_data,'{}'::jsonb));
end; $$;

create or replace function public.notify_task_request_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  select display_name into actor_name from public.profiles where id=NEW.from_user_id;
  perform public.create_week_notification(NEW.to_user_id,NEW.from_user_id,'request_created','Новое предложение',coalesce(actor_name,'Кто-то') || ' предлагает задачу: ' || NEW.title,jsonb_build_object('request_id',NEW.id));
  return NEW;
end; $$;
drop trigger if exists task_request_created_notification on public.task_requests;
create trigger task_request_created_notification after insert on public.task_requests for each row execute function public.notify_task_request_created();

create or replace function public.notify_task_request_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text; body_text text;
begin
  if OLD.status = NEW.status then return NEW; end if;
  select display_name into actor_name from public.profiles where id=NEW.to_user_id;
  if NEW.status='accepted' then body_text:=coalesce(actor_name,'Пользователь') || ' принял(а) предложение: ' || NEW.title;
  elsif NEW.status='rejected' then body_text:=coalesce(actor_name,'Пользователь') || ' отклонил(а) предложение: ' || NEW.title;
  else body_text:=coalesce(actor_name,'Пользователь') || ' изменил(а) предложение: ' || NEW.title; end if;
  perform public.create_week_notification(NEW.from_user_id,NEW.to_user_id,'request_'||NEW.status,case NEW.status when 'accepted' then 'Предложение принято' when 'rejected' then 'Предложение отклонено' else 'Предложение обновлено' end,body_text,jsonb_build_object('request_id',NEW.id,'status',NEW.status));
  return NEW;
end; $$;
drop trigger if exists task_request_status_notification on public.task_requests;
create trigger task_request_status_notification after update of status on public.task_requests for each row execute function public.notify_task_request_status();

create or replace function public.notify_shared_task_done()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; actor_name text;
begin
  if NEW.visibility<>'shared' or OLD.status='done' or NEW.status<>'done' then return NEW; end if;
  select id into recipient from public.profiles where id<>NEW.owner_id order by created_at limit 1;
  select display_name into actor_name from public.profiles where id=NEW.owner_id;
  perform public.create_week_notification(recipient,NEW.owner_id,'shared_task_done','Общая задача выполнена',coalesce(actor_name,'Пользователь') || ' выполнил(а): ' || NEW.title,jsonb_build_object('task_id',NEW.id));
  return NEW;
end; $$;
drop trigger if exists shared_task_done_notification on public.tasks;
create trigger shared_task_done_notification after update of status on public.tasks for each row execute function public.notify_shared_task_done();

do $$ begin
  alter publication supabase_realtime add table public.notification_events;
exception when duplicate_object then null;
end $$;

-- Friends / multi-user support (same schema as supabase.sql)
alter table public.profiles add column if not exists username text;
update public.profiles set username=lower(regexp_replace(coalesce(nullif(display_name,''),'user') || '_' || substr(id::text,1,6),'[^a-zA-Z0-9_а-яА-ЯёЁ-]','','g')) where username is null or trim(username)='';
create unique index if not exists profiles_username_unique_idx on public.profiles(username);
create table if not exists public.friend_requests (id uuid primary key default gen_random_uuid(),from_user_id uuid not null references public.profiles(id) on delete cascade,to_user_id uuid not null references public.profiles(id) on delete cascade,status text not null default 'pending' check(status in ('pending','accepted','rejected')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(from_user_id<>to_user_id));
create table if not exists public.friendships (user_a uuid not null references public.profiles(id) on delete cascade,user_b uuid not null references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_a,user_b),check(user_a<user_b));
create table if not exists public.task_members (task_id uuid not null references public.tasks(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(task_id,user_id));
create index if not exists task_members_user_idx on public.task_members(user_id,task_id);
alter table public.friend_requests enable row level security; alter table public.friendships enable row level security; alter table public.task_members enable row level security;
drop policy if exists "friend_requests_select" on public.friend_requests; create policy "friend_requests_select" on public.friend_requests for select using(from_user_id=auth.uid() or to_user_id=auth.uid());
drop policy if exists "friend_requests_insert" on public.friend_requests; create policy "friend_requests_insert" on public.friend_requests for insert with check(from_user_id=auth.uid() and from_user_id<>to_user_id);
drop policy if exists "friend_requests_update_recipient" on public.friend_requests; create policy "friend_requests_update_recipient" on public.friend_requests for update using(to_user_id=auth.uid()) with check(to_user_id=auth.uid());
drop policy if exists "friendships_select_own" on public.friendships; create policy "friendships_select_own" on public.friendships for select using(user_a=auth.uid() or user_b=auth.uid());
drop policy if exists "friendships_no_client_insert" on public.friendships; create policy "friendships_no_client_insert" on public.friendships for insert with check(false);
drop policy if exists "task_members_select_own" on public.task_members; create policy "task_members_select_own" on public.task_members for select using(user_id=auth.uid() or exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid()));
drop policy if exists "task_members_insert_owner_friend" on public.task_members; create policy "task_members_insert_owner_friend" on public.task_members for insert with check(exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid()) and (user_id=auth.uid() or exists(select 1 from public.friendships f where f.user_a=least(auth.uid(),user_id) and f.user_b=greatest(auth.uid(),user_id))));
drop policy if exists "task_members_delete_owner" on public.task_members; create policy "task_members_delete_owner" on public.task_members for delete using(exists(select 1 from public.tasks t where t.id=task_id and t.owner_id=auth.uid()));
drop policy if exists "tasks_select" on public.tasks; create policy "tasks_select" on public.tasks for select using(owner_id=auth.uid() or exists(select 1 from public.task_members tm where tm.task_id=tasks.id and tm.user_id=auth.uid()));
drop policy if exists "tasks_update" on public.tasks; create policy "tasks_update" on public.tasks for update using(owner_id=auth.uid() or exists(select 1 from public.task_members tm where tm.task_id=tasks.id and tm.user_id=auth.uid()));
create or replace function public.accept_friend_request() returns trigger language plpgsql security definer set search_path=public as $$ begin if OLD.status='accepted' or NEW.status<>'accepted' then return NEW; end if; insert into public.friendships(user_a,user_b) values(least(NEW.from_user_id,NEW.to_user_id),greatest(NEW.from_user_id,NEW.to_user_id)) on conflict do nothing; perform public.create_week_notification(NEW.from_user_id,NEW.to_user_id,'friend_accepted','Новый друг',coalesce((select display_name from public.profiles where id=NEW.to_user_id),'Пользователь') || ' принял(а) твою заявку в друзья',jsonb_build_object('friend_request_id',NEW.id)); return NEW; end; $$;
drop trigger if exists friend_request_accepted on public.friend_requests; create trigger friend_request_accepted after update of status on public.friend_requests for each row execute function public.accept_friend_request();
create or replace function public.notify_friend_request_created() returns trigger language plpgsql security definer set search_path=public as $$ begin perform public.create_week_notification(NEW.to_user_id,NEW.from_user_id,'friend_request_created','Новая заявка в друзья',coalesce((select display_name from public.profiles where id=NEW.from_user_id),'Кто-то') || ' хочет добавить тебя в друзья',jsonb_build_object('friend_request_id',NEW.id)); return NEW; end; $$;
drop trigger if exists friend_request_created_notification on public.friend_requests; create trigger friend_request_created_notification after insert on public.friend_requests for each row execute function public.notify_friend_request_created();
insert into public.task_members(task_id,user_id) select id,owner_id from public.tasks where visibility='shared' on conflict do nothing;

create or replace function public.is_task_member(p_task uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.task_members where task_id=p_task and user_id=p_user); $$;
create or replace function public.is_task_owner(p_task uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.tasks where id=p_task and owner_id=p_user); $$;
drop policy if exists "task_members_select_own" on public.task_members; create policy "task_members_select_own" on public.task_members for select using(user_id=auth.uid() or public.is_task_owner(task_id,auth.uid()));
drop policy if exists "task_members_insert_owner_friend" on public.task_members; create policy "task_members_insert_owner_friend" on public.task_members for insert with check(public.is_task_owner(task_id,auth.uid()) and (user_id=auth.uid() or exists(select 1 from public.friendships f where f.user_a=least(auth.uid(),user_id) and f.user_b=greatest(auth.uid(),user_id))));
drop policy if exists "task_members_delete_owner" on public.task_members; create policy "task_members_delete_owner" on public.task_members for delete using(public.is_task_owner(task_id,auth.uid()));
drop policy if exists "tasks_select" on public.tasks; create policy "tasks_select" on public.tasks for select using(owner_id=auth.uid() or public.is_task_member(id,auth.uid()));
drop policy if exists "tasks_update" on public.tasks; create policy "tasks_update" on public.tasks for update using(owner_id=auth.uid() or public.is_task_member(id,auth.uid()));
create or replace function public.notify_task_member_added() returns trigger language plpgsql security definer set search_path=public as $$ declare owner_id uuid; owner_name text; task_title text; task_visibility text; begin select t.owner_id,t.title,t.visibility into owner_id,task_title,task_visibility from public.tasks t where t.id=NEW.task_id; if task_visibility<>'shared' or owner_id is null or NEW.user_id=owner_id then return NEW; end if; select display_name into owner_name from public.profiles where id=owner_id; perform public.create_week_notification(NEW.user_id,owner_id,'shared_task_created','Новая общая задача',coalesce(owner_name,'Пользователь') || ' добавил общую задачу: ' || task_title,jsonb_build_object('task_id',NEW.task_id)); return NEW; end; $$;
drop trigger if exists shared_task_member_added_notification on public.task_members; create trigger shared_task_member_added_notification after insert on public.task_members for each row execute function public.notify_task_member_added();
