-- week. 2.3. Run AFTER MIGRATION_2_1.sql and MIGRATION_2_2_CLASSES.sql.
-- Does not delete existing users, classes, lessons or tasks.
-- Make a database backup first. Run in Supabase SQL Editor as project owner.
-- All steps run together; any SQL error rolls the entire migration back.
begin;

-- Class titles are labels. Only week_admins are allowed to edit them.
alter table public.class_members add column if not exists role text not null default 'student';
alter table public.class_members drop constraint if exists class_members_role_check;
alter table public.class_members add constraint class_members_role_check
  check (role in ('student','teacher','homeroom_teacher'));

create or replace function public.week_set_class_member_role(p_class_id uuid,p_user_id uuid,p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.week_is_admin() then raise exception 'Недостаточно прав'; end if;
  if p_role is null or p_role not in ('student','teacher','homeroom_teacher')
    then raise exception 'Неизвестное звание'; end if;
  update public.class_members set role=p_role
  where class_id=p_class_id and user_id=p_user_id;
  if not found then raise exception 'Участник не найден в классе'; end if;
  update public.class_groups set schedule_updated_at=clock_timestamp() where id=p_class_id;
end; $$;

-- The existing invite_hash is retained. Existing printed codes keep working.
-- A separate admin-only table keeps recoverable permanent codes for new classes,
-- and for existing classes after the admin enters the old code or locks a new one.
create table if not exists public.class_invite_secrets(
  class_id uuid primary key references public.class_groups(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.class_invite_secrets enable row level security;
revoke all on public.class_invite_secrets from public, anon, authenticated;

create or replace function public.week_create_class(p_name text)
returns table(class_id uuid,invite_code text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_id uuid; v_display text;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Название класса: от 1 до 80 символов'; end if;
  v_code:=upper(encode(gen_random_bytes(12),'hex'));
  v_display:=substr(v_code,1,6)||'-'||substr(v_code,7,6)||'-'||substr(v_code,13,6)||'-'||substr(v_code,19,6);
  insert into public.class_groups(name,invite_hash,created_by)
    values(btrim(p_name),public.week_code_hash(v_code),auth.uid()) returning id into v_id;
  insert into public.class_invite_secrets(class_id,invite_code) values(v_id,v_display);
  return query select v_id,v_display;
end; $$;

create or replace function public.week_get_class_invite_code(p_class_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_code text;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  select invite_code into v_code from public.class_invite_secrets where class_id=p_class_id;
  return v_code;
end; $$;

-- One-time migration for a legacy class whose old code is kept as a SHA-256 hash.
-- Supplying its original code preserves it. NULL generates a NEW permanent code
-- and invalidates the legacy code, with explicit confirmation in the UI.
create or replace function public.week_lock_class_invite_code(p_class_id uuid,p_existing_code text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_existing text; v_raw text; v_display text;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  select invite_hash into v_hash from public.class_groups where id=p_class_id for update;
  if not found then raise exception 'Класс не найден'; end if;
  select invite_code into v_existing from public.class_invite_secrets where class_id=p_class_id;
  if v_existing is not null then return v_existing; end if;
  if nullif(btrim(coalesce(p_existing_code,'')),'') is not null then
    v_raw:=upper(regexp_replace(p_existing_code,'[^a-fA-F0-9]','','g'));
    if public.week_code_hash(v_raw) is distinct from v_hash then
      raise exception 'Исходный код не совпадает с кодом этого класса';
    end if;
  else
    v_raw:=upper(encode(gen_random_bytes(12),'hex'));
    update public.class_groups set invite_hash=public.week_code_hash(v_raw) where id=p_class_id;
  end if;
  v_display:=substr(v_raw,1,6)||'-'||substr(v_raw,7,6)||'-'||substr(v_raw,13,6)||'-'||substr(v_raw,19,6);
  insert into public.class_invite_secrets(class_id,invite_code) values(p_class_id,v_display);
  return v_display;
end; $$;

-- Revoke old rotating functionality so a legacy app cannot change permanent codes.
revoke all on function public.week_rotate_class_code(uuid) from public, anon, authenticated;

-- One-off adjustments are tied to one exact calendar date. The lesson remains
-- unchanged for every other week. RLS permits reading only one's class.
create table if not exists public.class_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.class_groups(id) on delete cascade,
  lesson_id uuid not null references public.class_schedule_items(id) on delete cascade,
  lesson_date date not null,
  cancelled boolean not null default false,
  title text,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  unique(lesson_id,lesson_date),
  check(cancelled or (title is not null and length(btrim(title)) between 1 and 120
       and start_time is not null and end_time is not null and end_time>start_time))
);
create index if not exists class_schedule_exceptions_window_idx
  on public.class_schedule_exceptions(class_id,lesson_date);
alter table public.class_schedule_exceptions enable row level security;
drop policy if exists class_exceptions_read on public.class_schedule_exceptions;
create policy class_exceptions_read on public.class_schedule_exceptions for select to authenticated
  using(public.week_is_admin() or public.week_in_class(class_id));
grant select on public.class_schedule_exceptions to authenticated;
revoke insert,update,delete on public.class_schedule_exceptions from public,anon,authenticated;

create or replace function public.week_change_class_lesson(
  p_lesson_id uuid,p_mode text,p_date date,p_day_of_week integer,
  p_title text,p_start_time time,p_end_time time,p_cancelled boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_class uuid; v_day integer;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  select class_id,day_of_week into v_class,v_day from public.class_schedule_items where id=p_lesson_id for update;
  if not found then raise exception 'Урок не найден'; end if;
  if p_mode not in ('once','forever') then raise exception 'Неизвестный тип изменения'; end if;
  if p_mode='once' then
    if p_date is null or extract(dow from p_date)::integer<>v_day
      then raise exception 'Дата должна соответствовать дню недели урока'; end if;
    if not coalesce(p_cancelled,false) and (length(btrim(coalesce(p_title,''))) not between 1 and 120
      or p_start_time is null or p_end_time is null or p_end_time<=p_start_time)
      then raise exception 'Проверь название и время урока'; end if;
    insert into public.class_schedule_exceptions(class_id,lesson_id,lesson_date,cancelled,title,start_time,end_time)
    values(v_class,p_lesson_id,p_date,coalesce(p_cancelled,false),
      case when coalesce(p_cancelled,false) then null else btrim(p_title) end,
      case when coalesce(p_cancelled,false) then null else p_start_time end,
      case when coalesce(p_cancelled,false) then null else p_end_time end)
    on conflict(lesson_id,lesson_date) do update set
      cancelled=excluded.cancelled,title=excluded.title,
      start_time=excluded.start_time,end_time=excluded.end_time;
  else
    if coalesce(p_cancelled,false) then raise exception 'Для постоянного удаления используй редактор расписания'; end if;
    if p_day_of_week not between 0 and 6 or length(btrim(coalesce(p_title,''))) not between 1 and 120
      or p_start_time is null or p_end_time is null or p_end_time<=p_start_time
      then raise exception 'Проверь день, название и время урока'; end if;
    if p_day_of_week<>v_day then
      delete from public.class_schedule_exceptions where lesson_id=p_lesson_id;
    end if;
    update public.class_schedule_items set day_of_week=p_day_of_week,
      title=btrim(p_title),start_time=p_start_time,end_time=p_end_time
      where id=p_lesson_id;
  end if;
  update public.class_groups set schedule_updated_at=clock_timestamp() where id=v_class;
end; $$;

-- Save the full timetable without destroying exceptions of unchanged lessons.
-- Existing lesson IDs are kept; deleted lessons and their exceptions are removed.
create or replace function public.week_replace_class_schedule(p_class_id uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_day int; v_old_day int; v_title text; v_start time; v_end time;
        v_id uuid; v_ids uuid[]:=array[]::uuid[]; v_count integer:=0;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  if not exists(select 1 from public.class_groups where id=p_class_id for update)
    then raise exception 'Класс не найден'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>70
    then raise exception 'Расписание должно содержать не более 70 уроков'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_day:=(v_item->>'day_of_week')::int;
    v_title:=btrim(coalesce(v_item->>'title',''));
    v_start:=(v_item->>'start_time')::time;
    v_end:=(v_item->>'end_time')::time;
    if v_day not between 0 and 6 or length(v_title) not between 1 and 120
      or v_start is null or v_end is null or v_end<=v_start
      then raise exception 'Проверь предметы и время уроков'; end if;
    v_id:=nullif(v_item->>'id','')::uuid;
    if v_id is not null then
      if v_id=any(v_ids) then raise exception 'Повторяющийся идентификатор урока'; end if;
      select day_of_week into v_old_day from public.class_schedule_items
        where id=v_id and class_id=p_class_id for update;
      if not found then raise exception 'Урок не принадлежит выбранному классу'; end if;
      if v_day<>v_old_day then
        delete from public.class_schedule_exceptions where lesson_id=v_id;
      end if;
      update public.class_schedule_items set day_of_week=v_day,title=v_title,
        start_time=v_start,end_time=v_end where id=v_id and class_id=p_class_id;
    else
      insert into public.class_schedule_items(class_id,day_of_week,title,start_time,end_time)
        values(p_class_id,v_day,v_title,v_start,v_end) returning id into v_id;
    end if;
    v_ids:=array_append(v_ids,v_id);
    v_count:=v_count+1;
  end loop;
  delete from public.class_schedule_items
    where class_id=p_class_id and not (id=any(v_ids));
  update public.class_groups set schedule_updated_at=clock_timestamp() where id=p_class_id;
  return v_count;
end; $$;

revoke all on function public.week_set_class_member_role(uuid,uuid,text),
  public.week_get_class_invite_code(uuid), public.week_lock_class_invite_code(uuid,text),
  public.week_change_class_lesson(uuid,text,date,integer,text,time,time,boolean)
  from public,anon;
grant execute on function public.week_set_class_member_role(uuid,uuid,text),
  public.week_get_class_invite_code(uuid), public.week_lock_class_invite_code(uuid,text),
  public.week_change_class_lesson(uuid,text,date,integer,text,time,time,boolean)
  to authenticated;
notify pgrst, 'reload schema';

-- Undo one dated change and restore the normal weekly lesson on that date.
create or replace function public.week_remove_class_lesson_exception(p_lesson_id uuid,p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_class uuid;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  select class_id into v_class from public.class_schedule_items where id=p_lesson_id for update;
  if not found then raise exception 'Урок не найден'; end if;
  delete from public.class_schedule_exceptions where lesson_id=p_lesson_id and lesson_date=p_date;
  update public.class_groups set schedule_updated_at=clock_timestamp() where id=v_class;
end; $$;
revoke all on function public.week_remove_class_lesson_exception(uuid,date) from public,anon;
grant execute on function public.week_remove_class_lesson_exception(uuid,date) to authenticated;
notify pgrst, 'reload schema';
commit;
