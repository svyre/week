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
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    new.email
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