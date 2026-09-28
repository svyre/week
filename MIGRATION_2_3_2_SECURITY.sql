-- week. 2.3.2 SECURITY HARDENING
-- Run AFTER MIGRATION_2_1.sql, MIGRATION_2_2_CLASSES.sql and MIGRATION_2_3_SCHOOL.sql.
-- Does not delete existing user data. Make a backup before applying.
-- The migration tightens RLS, limits writable columns, hides bulk profile enumeration,
-- validates important inputs and adds server-side helpers for shared task updates.

begin;

-- ---------------------------------------------------------------------------
-- 0. Reduce the exposed attack surface before changing individual policies.
--    RLS-only helper functions live in a schema that is not exposed by the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Nobody using a browser key should be able to create objects in public.
-- This also reduces search_path shadowing risk for legacy SECURITY DEFINER functions.
revoke create on schema public from public, anon, authenticated;

create or replace function private.week_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists(
      select 1 from public.week_admins wa
      where wa.user_id = (select auth.uid())
    );
$$;

create or replace function private.week_in_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists(
      select 1 from public.class_members cm
      where cm.class_id = p_class and cm.user_id = (select auth.uid())
    );
$$;

create or replace function private.week_is_task_member(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.task_members tm
    where tm.task_id = p_task and tm.user_id = p_user
  );
$$;

create or replace function private.week_is_task_owner(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.tasks t
    where t.id = p_task and t.owner_id = p_user
  );
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.week_is_admin(), private.week_in_class(uuid),
  private.week_is_task_member(uuid,uuid), private.week_is_task_owner(uuid,uuid)
  to authenticated;

-- Secure fallback for old accounts whose profile row is unexpectedly missing.
-- Email is copied from auth.users by the database; the browser cannot forge it.
create or replace function public.week_ensure_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_username text;
begin
  if v_uid is null then return null; end if;

  select u.email,
         coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),
                  nullif(split_part(coalesce(u.email,''),'@',1),''),
                  'Пользователь'),
         coalesce(nullif(btrim(u.raw_user_meta_data->>'username'),''),
                  nullif(split_part(coalesce(u.email,''),'@',1),''),
                  'user')
    into v_email, v_name, v_username
  from auth.users u
  where u.id = v_uid;

  if not found then return null; end if;

  v_name := left(v_name,80);
  v_username := lower(regexp_replace(v_username || '_' || substr(v_uid::text,1,6),
    '[^a-zA-Z0-9_а-яА-ЯёЁ-]','','g'));
  v_username := left(v_username,24);
  if v_username = '' then v_username := 'user_' || substr(v_uid::text,1,6); end if;

  insert into public.profiles(id,display_name,email,username)
  values(v_uid,v_name,v_email,v_username)
  on conflict(id) do nothing;

  return (select to_jsonb(p) from public.profiles p where p.id=v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Safer limits for new and edited data.
-- NOT VALID avoids failing because of an old row; new/updated rows are checked.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_display_name_security_check;
alter table public.profiles add constraint profiles_display_name_security_check
  check (length(btrim(display_name)) between 1 and 80) not valid;
alter table public.profiles drop constraint if exists profiles_username_security_check;
alter table public.profiles add constraint profiles_username_security_check
  check (username is null or (
    length(username) between 1 and 24
    and username = lower(username)
    and username ~ '^[a-z0-9_а-яё-]+$'
  )) not valid;

alter table public.tasks drop constraint if exists tasks_title_security_check;
alter table public.tasks add constraint tasks_title_security_check
  check (length(btrim(title)) between 1 and 300) not valid;
alter table public.tasks drop constraint if exists tasks_description_security_check;
alter table public.tasks add constraint tasks_description_security_check
  check (description is null or length(description) <= 10000) not valid;
alter table public.tasks drop constraint if exists tasks_duration_security_check;
alter table public.tasks add constraint tasks_duration_security_check
  check (duration between 1 and 1440) not valid;
alter table public.tasks drop constraint if exists tasks_recurrence_security_check;
alter table public.tasks add constraint tasks_recurrence_security_check
  check (recurrence is null or recurrence in ('daily','weekly','weekdays')) not valid;
alter table public.tasks drop constraint if exists tasks_color_security_check;
alter table public.tasks add constraint tasks_color_security_check
  check (color in ('default','lavender','blue','mint','amber','coral','rose','slate')) not valid;
alter table public.tasks drop constraint if exists tasks_checklist_security_check;
alter table public.tasks add constraint tasks_checklist_security_check
  check (jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) <= 50
    and octet_length(checklist::text) <= 20000) not valid;
alter table public.tasks drop constraint if exists tasks_category_security_check;
alter table public.tasks add constraint tasks_category_security_check
  check (length(btrim(category)) between 1 and 120) not valid;

alter table public.task_requests drop constraint if exists task_requests_not_self_security_check;
alter table public.task_requests add constraint task_requests_not_self_security_check
  check (from_user_id <> to_user_id) not valid;
alter table public.task_requests drop constraint if exists task_requests_title_security_check;
alter table public.task_requests add constraint task_requests_title_security_check
  check (length(btrim(title)) between 1 and 300) not valid;
alter table public.task_requests drop constraint if exists task_requests_description_security_check;
alter table public.task_requests add constraint task_requests_description_security_check
  check (description is null or length(description) <= 10000) not valid;
alter table public.task_requests drop constraint if exists task_requests_duration_security_check;
alter table public.task_requests add constraint task_requests_duration_security_check
  check (duration between 1 and 1440) not valid;
alter table public.task_requests drop constraint if exists task_requests_recurrence_security_check;
alter table public.task_requests add constraint task_requests_recurrence_security_check
  check (recurrence is null or recurrence in ('daily','weekly','weekdays')) not valid;
alter table public.task_requests drop constraint if exists task_requests_color_security_check;
alter table public.task_requests add constraint task_requests_color_security_check
  check (color in ('default','lavender','blue','mint','amber','coral','rose','slate')) not valid;
alter table public.task_requests drop constraint if exists task_requests_checklist_security_check;
alter table public.task_requests add constraint task_requests_checklist_security_check
  check (jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) <= 50
    and octet_length(checklist::text) <= 20000) not valid;
alter table public.task_requests drop constraint if exists task_requests_category_security_check;
alter table public.task_requests add constraint task_requests_category_security_check
  check (length(btrim(category)) between 1 and 120) not valid;

alter table public.task_templates drop constraint if exists task_templates_title_security_check;
alter table public.task_templates add constraint task_templates_title_security_check
  check (length(btrim(title)) between 1 and 200) not valid;
alter table public.task_templates drop constraint if exists task_templates_category_security_check;
alter table public.task_templates add constraint task_templates_category_security_check
  check (length(btrim(category)) between 1 and 120) not valid;
alter table public.task_templates drop constraint if exists task_templates_duration_security_check;
alter table public.task_templates add constraint task_templates_duration_security_check
  check (duration between 5 and 1440) not valid;

alter table public.schedule_items drop constraint if exists schedule_items_title_security_check;
alter table public.schedule_items add constraint schedule_items_title_security_check
  check (length(btrim(title)) between 1 and 120) not valid;

alter table public.time_logs drop constraint if exists time_logs_time_security_check;
alter table public.time_logs add constraint time_logs_time_security_check
  check (ended_at is null or ended_at >= started_at) not valid;

-- ---------------------------------------------------------------------------
-- 2. Profiles: private table, exact username search, and relationship-scoped names.
--    The old public_profiles view remains for compatibility but is no longer readable.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

do $$
begin
  if to_regclass('public.public_profiles') is not null then
    execute 'revoke all on public.public_profiles from public, anon, authenticated';
  end if;
end $$;

create or replace function public.week_find_profile_by_username(p_username text)
returns table(id uuid, display_name text, username text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_username text;
begin
  if auth.uid() is null then return; end if;
  v_username := lower(regexp_replace(btrim(coalesce(p_username,'')), '^@', ''));
  if length(v_username) not between 1 and 24 or v_username !~ '^[a-z0-9_а-яё-]+$' then
    return;
  end if;
  return query
    select p.id, p.display_name, p.username
    from public.profiles p
    where p.username = v_username and p.id <> auth.uid()
    limit 1;
end;
$$;

create or replace function public.week_get_visible_profiles(p_ids uuid[])
returns table(id uuid, display_name text, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.username
  from public.profiles p
  where auth.uid() is not null
    and p.id = any(coalesce(p_ids, array[]::uuid[]))
    and (
      p.id = auth.uid()
      or exists(select 1 from public.week_admins wa where wa.user_id = auth.uid())
      or exists(
        select 1 from public.friendships f
        where f.user_a = least(auth.uid(), p.id)
          and f.user_b = greatest(auth.uid(), p.id)
      )
      or exists(
        select 1 from public.friend_requests fr
        where fr.status='pending'
          and ((fr.from_user_id=auth.uid() and fr.to_user_id=p.id)
            or (fr.to_user_id=auth.uid() and fr.from_user_id=p.id))
      )
      or exists(
        select 1 from public.task_requests tr
        where (tr.from_user_id=auth.uid() and tr.to_user_id=p.id)
           or (tr.to_user_id=auth.uid() and tr.from_user_id=p.id)
      )
      or exists(
        select 1
        from public.class_members me
        join public.class_members them on them.class_id=me.class_id
        where me.user_id=auth.uid() and them.user_id=p.id
      )
      or exists(
        select 1
        from public.task_members me
        join public.task_members them on them.task_id=me.task_id
        where me.user_id=auth.uid() and them.user_id=p.id
      )
    );
$$;

-- Users may update only non-sensitive profile columns. Email remains server-managed.
revoke update on public.profiles from authenticated;
grant update(display_name, username, onboarding_completed, studies_at_school)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Friend requests and task proposals: prevent forged fields and illegal state changes.
-- ---------------------------------------------------------------------------
drop policy if exists "friend_requests_insert" on public.friend_requests;
create policy "friend_requests_insert" on public.friend_requests
  for insert to authenticated
  with check (
    from_user_id=(select auth.uid())
    and from_user_id<>to_user_id
    and status='pending'
  );

drop policy if exists "friend_requests_update_recipient" on public.friend_requests;
create policy "friend_requests_update_recipient" on public.friend_requests
  for update to authenticated
  using (to_user_id=(select auth.uid()) and status='pending')
  with check (to_user_id=(select auth.uid()) and status in ('accepted','rejected'));

revoke update on public.friend_requests from authenticated;
grant update(status) on public.friend_requests to authenticated;

drop policy if exists "requests_insert" on public.task_requests;
create policy "requests_insert" on public.task_requests
  for insert to authenticated
  with check (
    from_user_id=(select auth.uid())
    and from_user_id<>to_user_id
    and status='pending'
    and exists(
      select 1 from public.friendships f
      where f.user_a=least((select auth.uid()),to_user_id)
        and f.user_b=greatest((select auth.uid()),to_user_id)
    )
  );

drop policy if exists "requests_update_recipient" on public.task_requests;
create policy "requests_update_recipient" on public.task_requests
  for update to authenticated
  using (to_user_id=(select auth.uid()) and status='pending')
  with check (to_user_id=(select auth.uid()) and status in ('accepted','rejected'));

revoke update on public.task_requests from authenticated;
grant update(status) on public.task_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Shared tasks: members can mark done/check checklist, but cannot hijack ownership
--    or rewrite title/date/visibility. Full direct UPDATE is owner-only.
-- ---------------------------------------------------------------------------
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));

create or replace function public.week_set_task_status(p_task_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Требуется вход'; end if;
  if p_status not in ('open','done') then raise exception 'Недопустимый статус'; end if;
  if not exists(
    select 1 from public.tasks t
    where t.id=p_task_id
      and (t.owner_id=v_user or exists(
        select 1 from public.task_members tm
        where tm.task_id=t.id and tm.user_id=v_user
      ))
  ) then raise exception 'Нет доступа к задаче'; end if;
  update public.tasks
    set status=p_status, updated_at=clock_timestamp()
    where id=p_task_id;
end;
$$;

create or replace function public.week_set_task_checklist(p_task_id uuid,p_checklist jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_list jsonb := coalesce(p_checklist,'[]'::jsonb);
  v_clean jsonb;
begin
  if v_user is null then raise exception 'Требуется вход'; end if;
  if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 50 then
    raise exception 'Чек-лист должен содержать не более 50 пунктов';
  end if;
  if exists(
    select 1 from jsonb_array_elements(v_list) x(item)
    where jsonb_typeof(item) <> 'object'
      or not (item ? 'text')
      or jsonb_typeof(item->'text') <> 'string'
      or length(btrim(item->>'text')) not between 1 and 300
      or ((item ? 'done') and jsonb_typeof(item->'done') <> 'boolean')
  ) then raise exception 'Некорректный чек-лист'; end if;
  if not exists(
    select 1 from public.tasks t
    where t.id=p_task_id
      and (t.owner_id=v_user or exists(
        select 1 from public.task_members tm
        where tm.task_id=t.id and tm.user_id=v_user
      ))
  ) then raise exception 'Нет доступа к задаче'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'text', btrim(item->>'text'),
    'done', case when item ? 'done' then (item->>'done')::boolean else false end
  )), '[]'::jsonb)
  into v_clean
  from jsonb_array_elements(v_list) x(item);
  update public.tasks
    set checklist=v_clean, updated_at=clock_timestamp()
    where id=p_task_id;
end;
$$;

-- Timer rows must reference a task visible to the current user.
drop policy if exists "logs_own" on public.time_logs;
drop policy if exists "time_logs_select_own" on public.time_logs;
drop policy if exists "time_logs_insert_own" on public.time_logs;
drop policy if exists "time_logs_update_own" on public.time_logs;
drop policy if exists "time_logs_delete_own" on public.time_logs;
create policy "time_logs_select_own" on public.time_logs
  for select to authenticated using (user_id=(select auth.uid()));
create policy "time_logs_insert_own" on public.time_logs
  for insert to authenticated with check (
    user_id=(select auth.uid())
    and exists(
      select 1 from public.tasks t
      where t.id=task_id
        and (t.owner_id=(select auth.uid()) or public.is_task_member(t.id,(select auth.uid())))
    )
  );
create policy "time_logs_update_own" on public.time_logs
  for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));
create policy "time_logs_delete_own" on public.time_logs
  for delete to authenticated using (user_id=(select auth.uid()));
revoke update on public.time_logs from authenticated;
grant update(ended_at) on public.time_logs to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. Reassert every high-value RLS boundary used by the browser.
--     This makes the hardening migration safe even if an older setup file was
--     applied in a different order.
-- ---------------------------------------------------------------------------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    owner_id=(select auth.uid())
    or private.week_is_task_member(id,(select auth.uid()))
  );

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (owner_id=(select auth.uid()));

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated
  using (owner_id=(select auth.uid()));

drop policy if exists "task_members_select_own" on public.task_members;
create policy "task_members_select_own" on public.task_members
  for select to authenticated
  using (
    user_id=(select auth.uid())
    or private.week_is_task_owner(task_id,(select auth.uid()))
  );

drop policy if exists "task_members_insert_owner_friend" on public.task_members;
create policy "task_members_insert_owner_friend" on public.task_members
  for insert to authenticated
  with check (
    private.week_is_task_owner(task_id,(select auth.uid()))
    and (
      user_id=(select auth.uid())
      or exists(
        select 1 from public.friendships f
        where f.user_a=least((select auth.uid()),user_id)
          and f.user_b=greatest((select auth.uid()),user_id)
      )
    )
  );

drop policy if exists "task_members_delete_owner" on public.task_members;
create policy "task_members_delete_owner" on public.task_members
  for delete to authenticated
  using (private.week_is_task_owner(task_id,(select auth.uid())));

drop policy if exists "requests_select" on public.task_requests;
create policy "requests_select" on public.task_requests
  for select to authenticated
  using (from_user_id=(select auth.uid()) or to_user_id=(select auth.uid()));

drop policy if exists "friend_requests_select" on public.friend_requests;
create policy "friend_requests_select" on public.friend_requests
  for select to authenticated
  using (from_user_id=(select auth.uid()) or to_user_id=(select auth.uid()));

drop policy if exists "friend_requests_delete_sender" on public.friend_requests;
create policy "friend_requests_delete_sender" on public.friend_requests
  for delete to authenticated
  using (from_user_id=(select auth.uid()) and status='pending');

drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships
  for select to authenticated
  using (user_a=(select auth.uid()) or user_b=(select auth.uid()));

drop policy if exists "friendships_no_client_insert" on public.friendships;
create policy "friendships_no_client_insert" on public.friendships
  for insert to authenticated with check (false);

drop policy if exists "friendships_no_client_update" on public.friendships;
create policy "friendships_no_client_update" on public.friendships
  for update to authenticated using (false) with check (false);

drop policy if exists "friendships_delete_own" on public.friendships;
create policy "friendships_delete_own" on public.friendships
  for delete to authenticated
  using (user_a=(select auth.uid()) or user_b=(select auth.uid()));

drop policy if exists "templates_all_own" on public.task_templates;
create policy "templates_all_own" on public.task_templates
  for all to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

drop policy if exists "schedule_items_all_own" on public.schedule_items;
create policy "schedule_items_all_own" on public.schedule_items
  for all to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

drop policy if exists "task_completion_days_own" on public.task_completion_days;
create policy "task_completion_days_own" on public.task_completion_days
  for all to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));

-- Class data can be read only by an administrator or a member of that class.
drop policy if exists week_admins_read_self on public.week_admins;
create policy week_admins_read_self on public.week_admins
  for select to authenticated
  using (user_id=(select auth.uid()));

drop policy if exists class_groups_read on public.class_groups;
create policy class_groups_read on public.class_groups
  for select to authenticated
  using (private.week_is_admin() or private.week_in_class(id));

drop policy if exists class_members_read on public.class_members;
create policy class_members_read on public.class_members
  for select to authenticated
  using (private.week_is_admin() or private.week_in_class(class_id));

drop policy if exists class_schedule_read on public.class_schedule_items;
create policy class_schedule_read on public.class_schedule_items
  for select to authenticated
  using (private.week_is_admin() or private.week_in_class(class_id));

drop policy if exists class_exceptions_read on public.class_schedule_exceptions;
create policy class_exceptions_read on public.class_schedule_exceptions
  for select to authenticated
  using (private.week_is_admin() or private.week_in_class(class_id));

-- Notification events are private to their recipient. Logs remain server-only.
do $$ begin
  if to_regclass('public.notification_events') is not null then
    execute 'drop policy if exists "notification_events_own" on public.notification_events';
    execute 'create policy "notification_events_own" on public.notification_events for select to authenticated using (recipient_id=(select auth.uid()))';
  end if;
  if to_regclass('public.push_subscriptions') is not null then
    execute 'drop policy if exists "push_subscriptions_own" on public.push_subscriptions';
    execute 'create policy "push_subscriptions_own" on public.push_subscriptions for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Abuse / storage guards. These are intentionally generous for ~50 users.
-- ---------------------------------------------------------------------------
create or replace function public.week_guard_task_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.owner_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if (select count(*) from public.tasks where owner_id=new.owner_id) >= 10000 then
    raise exception 'Достигнут лимит задач аккаунта';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_task_insert_trigger on public.tasks;
create trigger week_guard_task_insert_trigger before insert on public.tasks
  for each row execute function public.week_guard_task_insert();

create or replace function public.week_guard_friend_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.from_user_id<>auth.uid() then raise exception 'Недопустимый отправитель'; end if;
  if (select count(*) from public.friend_requests
      where from_user_id=new.from_user_id and created_at>now()-interval '1 hour') >= 40 then
    raise exception 'Слишком много заявок. Попробуй позже';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_friend_request_insert_trigger on public.friend_requests;
create trigger week_guard_friend_request_insert_trigger before insert on public.friend_requests
  for each row execute function public.week_guard_friend_request_insert();

create or replace function public.week_guard_task_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.from_user_id<>auth.uid() then raise exception 'Недопустимый отправитель'; end if;
  if (select count(*) from public.task_requests
      where from_user_id=new.from_user_id and created_at>now()-interval '1 hour') >= 100 then
    raise exception 'Слишком много предложений. Попробуй позже';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_task_request_insert_trigger on public.task_requests;
create trigger week_guard_task_request_insert_trigger before insert on public.task_requests
  for each row execute function public.week_guard_task_request_insert();

create or replace function public.week_guard_template_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if (select count(*) from public.task_templates where user_id=new.user_id) >= 200 then
    raise exception 'Достигнут лимит шаблонов';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_template_insert_trigger on public.task_templates;
create trigger week_guard_template_insert_trigger before insert on public.task_templates
  for each row execute function public.week_guard_template_insert();

create or replace function public.week_guard_schedule_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if (select count(*) from public.schedule_items where user_id=new.user_id) >= 200 then
    raise exception 'Достигнут лимит расписания';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_schedule_insert_trigger on public.schedule_items;
create trigger week_guard_schedule_insert_trigger before insert on public.schedule_items
  for each row execute function public.week_guard_schedule_insert();

create or replace function public.week_guard_time_log_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if (select count(*) from public.time_logs where user_id=new.user_id) >= 20000 then
    raise exception 'Достигнут лимит записей таймера';
  end if;
  if (select count(*) from public.time_logs
      where user_id=new.user_id and created_at>now()-interval '1 hour') >= 300 then
    raise exception 'Слишком много запусков таймера. Попробуй позже';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_time_log_insert_trigger on public.time_logs;
create trigger week_guard_time_log_insert_trigger before insert on public.time_logs
  for each row execute function public.week_guard_time_log_insert();

create or replace function public.week_guard_completion_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if new.day < current_date - 3660 or new.day > current_date + 1 then
    raise exception 'Недопустимая дата активности';
  end if;
  if (select count(*) from public.task_completion_days where user_id=new.user_id) >= 4000 then
    raise exception 'Достигнут лимит истории активности';
  end if;
  return new;
end;
$$;
drop trigger if exists week_guard_completion_insert_trigger on public.task_completion_days;
create trigger week_guard_completion_insert_trigger before insert on public.task_completion_days
  for each row execute function public.week_guard_completion_insert();

-- Push subscriptions are optional. If enabled, cap them per account and bound fields.
create or replace function public.week_guard_push_subscription_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer; v_existing boolean;
begin
  if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'Недопустимый владелец'; end if;
  if length(coalesce(new.endpoint,'')) not between 10 and 2048
     or length(coalesce(new.p256dh,'')) not between 20 and 512
     or length(coalesce(new.auth,'')) not between 8 and 256
     or length(coalesce(new.timezone,'')) not between 1 and 100 then
    raise exception 'Некорректная push-подписка';
  end if;
  execute 'select count(*), coalesce(bool_or(endpoint=$2),false) from public.push_subscriptions where user_id=$1'
    into v_count, v_existing using new.user_id, new.endpoint;
  if v_count >= 10 and not v_existing then raise exception 'Слишком много push-подписок'; end if;
  return new;
end;
$$;
do $$ begin
  if to_regclass('public.push_subscriptions') is not null then
    execute 'drop trigger if exists week_guard_push_subscription_insert_trigger on public.push_subscriptions';
    execute 'create trigger week_guard_push_subscription_insert_trigger before insert on public.push_subscriptions for each row execute function public.week_guard_push_subscription_insert()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5b. Least-privilege table grants for the Data API.
--     RLS decides which rows are visible; GRANT decides which operations exist.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on public.profiles to authenticated;
grant update(display_name, username, onboarding_completed, studies_at_school)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert on public.task_requests to authenticated;
grant update(status) on public.task_requests to authenticated;
grant select, insert on public.task_templates to authenticated;
grant select, insert on public.time_logs to authenticated;
grant update(ended_at) on public.time_logs to authenticated;
grant select, insert, delete on public.schedule_items to authenticated;
grant select, insert, delete on public.friend_requests to authenticated;
grant update(status) on public.friend_requests to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, insert, delete on public.task_members to authenticated;
grant select, insert on public.task_completion_days to authenticated;

grant select on public.week_admins, public.class_groups, public.class_members,
  public.class_schedule_items, public.class_schedule_exceptions to authenticated;

do $$ begin
  if to_regclass('public.push_subscriptions') is not null then
    execute 'grant select, insert, update, delete on public.push_subscriptions to authenticated';
  end if;
  if to_regclass('public.notification_events') is not null then
    execute 'grant select on public.notification_events to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Function execution privileges: trigger helpers are not public APIs.
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.create_week_notification(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.notify_task_request_created() from public, anon, authenticated;
revoke execute on function public.notify_task_request_status() from public, anon, authenticated;
revoke execute on function public.notify_shared_task_done() from public, anon, authenticated;
revoke execute on function public.accept_friend_request() from public, anon, authenticated;
revoke execute on function public.notify_friend_request_created() from public, anon, authenticated;
revoke execute on function public.notify_shared_task_created() from public, anon, authenticated;
revoke execute on function public.notify_task_member_added() from public, anon, authenticated;
revoke execute on function public.week_signup_join_class() from public, anon, authenticated;
revoke execute on function public.week_code_hash(text) from public, anon, authenticated;
revoke execute on function public.week_rotate_class_code(uuid) from public, anon, authenticated;
revoke execute on function public.week_guard_task_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_friend_request_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_task_request_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_template_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_schedule_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_time_log_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_completion_insert() from public, anon, authenticated;
revoke execute on function public.week_guard_push_subscription_insert() from public, anon, authenticated;

-- Deliberate browser RPCs. RLS helpers in public remain unavailable to clients;
-- policies use the non-exposed private schema instead.
revoke execute on function public.is_task_member(uuid,uuid), public.is_task_owner(uuid,uuid),
  public.week_is_admin(), public.week_in_class(uuid),
  public.week_check_class_code(text), public.week_create_class(text),
  public.week_join_class(text), public.week_replace_class_schedule(uuid,jsonb),
  public.week_set_class_member_role(uuid,uuid,text),
  public.week_get_class_invite_code(uuid), public.week_lock_class_invite_code(uuid,text),
  public.week_change_class_lesson(uuid,text,date,integer,text,time,time,boolean),
  public.week_remove_class_lesson_exception(uuid,date),
  public.week_find_profile_by_username(text), public.week_get_visible_profiles(uuid[]),
  public.week_set_task_status(uuid,text), public.week_set_task_checklist(uuid,jsonb),
  public.week_ensure_profile()
  from public, anon, authenticated;

grant execute on function public.week_check_class_code(text) to anon, authenticated;
grant execute on function public.week_create_class(text), public.week_join_class(text),
  public.week_replace_class_schedule(uuid,jsonb),
  public.week_set_class_member_role(uuid,uuid,text),
  public.week_get_class_invite_code(uuid), public.week_lock_class_invite_code(uuid,text),
  public.week_change_class_lesson(uuid,text,date,integer,text,time,time,boolean),
  public.week_remove_class_lesson_exception(uuid,date),
  public.week_find_profile_by_username(text), public.week_get_visible_profiles(uuid[]),
  public.week_set_task_status(uuid,text), public.week_set_task_checklist(uuid,jsonb),
  public.week_ensure_profile()
  to authenticated;

-- New database objects are private by default. Future migrations must opt in.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Client has no reason to write server notification logs/events.
do $$ begin
  if to_regclass('public.notification_events') is not null then
    execute 'revoke insert, update, delete on public.notification_events from anon, authenticated';
  end if;
  if to_regclass('public.push_notification_event_log') is not null then
    execute 'revoke all on public.push_notification_event_log from anon, authenticated';
  end if;
  if to_regclass('public.push_notification_log') is not null then
    execute 'revoke all on public.push_notification_log from anon, authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
