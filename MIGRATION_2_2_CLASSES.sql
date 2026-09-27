-- week. 2.2: классы, приглашения и общее школьное расписание.
-- Выполнить ПОСЛЕ MIGRATION_2_1.sql и до загрузки новой версии приложения.
-- Не удаляет существующие задачи и личные расписания.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.week_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now()
);
create table if not exists public.class_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  invite_hash text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  schedule_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.class_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  class_id uuid not null references public.class_groups(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists class_members_class_idx on public.class_members(class_id);
create table if not exists public.class_schedule_items (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.class_groups(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  title text not null check (length(btrim(title)) between 1 and 120),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists class_schedule_order_idx on public.class_schedule_items(class_id,day_of_week,start_time);

alter table public.week_admins enable row level security;
alter table public.class_groups enable row level security;
alter table public.class_members enable row level security;
alter table public.class_schedule_items enable row level security;

-- Роль нельзя выдать самому себе через клиент: у week_admins нет insert/update/delete policy.
drop policy if exists week_admins_read_self on public.week_admins;
create policy week_admins_read_self on public.week_admins for select to authenticated using(user_id=auth.uid());

create or replace function public.week_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from public.week_admins where user_id=auth.uid());
$$;
create or replace function public.week_in_class(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from public.class_members where class_id=p_class and user_id=auth.uid());
$$;

-- Участники видят только свой класс, администратор видит все классы.
drop policy if exists class_groups_read on public.class_groups;
create policy class_groups_read on public.class_groups for select to authenticated
  using(public.week_is_admin() or public.week_in_class(id));
drop policy if exists class_members_read on public.class_members;
create policy class_members_read on public.class_members for select to authenticated
  using(public.week_is_admin() or public.week_in_class(class_id));
drop policy if exists class_schedule_read on public.class_schedule_items;
create policy class_schedule_read on public.class_schedule_items for select to authenticated
  using(public.week_is_admin() or public.week_in_class(class_id));
-- Из браузера нельзя напрямую создавать классы, менять участников и школьные занятия.
-- Запись выполняется только функциями с проверкой прав на стороне базы.

grant select on public.week_admins, public.class_groups, public.class_members, public.class_schedule_items to authenticated;
revoke insert, update, delete on public.week_admins, public.class_groups, public.class_members, public.class_schedule_items from authenticated, anon;

create or replace function public.week_code_hash(p_code text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select case when length(upper(regexp_replace(coalesce(p_code,''),'[^a-fA-F0-9]','','g')))=24
    then encode(digest(upper(regexp_replace(p_code,'[^a-fA-F0-9]','','g')),'sha256'),'hex')
    else null end;
$$;

-- Проверка кода при регистрации. Возвращает только название класса, не список учеников.
create or replace function public.week_check_class_code(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select name from public.class_groups where invite_hash=public.week_code_hash(p_code) limit 1;
$$;

create or replace function public.week_create_class(p_name text)
returns table(class_id uuid, invite_code text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_id uuid;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Название класса: от 1 до 80 символов'; end if;
  v_code:=upper(encode(gen_random_bytes(12),'hex'));
  insert into public.class_groups(name,invite_hash,created_by)
    values(btrim(p_name),public.week_code_hash(v_code),auth.uid()) returning id into v_id;
  return query select v_id, substr(v_code,1,6)||'-'||substr(v_code,7,6)||'-'||substr(v_code,13,6)||'-'||substr(v_code,19,6);
end;
$$;

create or replace function public.week_rotate_class_code(p_class_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  if not exists(select 1 from public.class_groups where id=p_class_id) then raise exception 'Класс не найден'; end if;
  v_code:=upper(encode(gen_random_bytes(12),'hex'));
  update public.class_groups set invite_hash=public.week_code_hash(v_code) where id=p_class_id;
  return substr(v_code,1,6)||'-'||substr(v_code,7,6)||'-'||substr(v_code,13,6)||'-'||substr(v_code,19,6);
end;
$$;

-- Одному пользователю разрешён один класс. Код одноразовым НЕ является.
create or replace function public.week_join_class(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old uuid;
begin
  if auth.uid() is null then raise exception 'Войди в аккаунт'; end if;
  select id into v_id from public.class_groups where invite_hash=public.week_code_hash(p_code);
  if v_id is null then raise exception 'Неверный или устаревший код класса'; end if;
  select class_id into v_old from public.class_members where user_id=auth.uid();
  if v_old=v_id then return v_id; end if;
  if v_old is not null then raise exception 'Ты уже состоишь в другом классе'; end if;
  insert into public.class_members(user_id,class_id) values(auth.uid(),v_id)
    on conflict(user_id) do nothing;
  select class_id into v_old from public.class_members where user_id=auth.uid();
  if v_old<>v_id then raise exception 'Ты уже состоишь в другом классе'; end if;
  return v_id;
end;
$$;

-- Путь «код при регистрации». Выполняется в транзакции регистрации Supabase Auth,
-- даже если подтверждение email будет открыто позднее или на другом устройстве.
create or replace function public.week_signup_join_class()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  v_code:=new.raw_user_meta_data->>'class_invite_code';
  if v_code is null or btrim(v_code)='' then return new; end if;
  select id into v_id from public.class_groups where invite_hash=public.week_code_hash(v_code);
  if v_id is not null then
    insert into public.class_members(user_id,class_id) values(new.id,v_id)
      on conflict(user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists zz_week_signup_join_class on auth.users;
-- on_auth_user_created создаёт профиль раньше, чем этот триггер создаст членство.
create trigger zz_week_signup_join_class after insert on auth.users
  for each row execute procedure public.week_signup_join_class();

create or replace function public.week_replace_class_schedule(p_class_id uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_day int; v_title text; v_start time; v_end time; v_count integer:=0;
begin
  if not public.week_is_admin() then raise exception 'Нет прав администратора'; end if;
  if not exists(select 1 from public.class_groups where id=p_class_id) then raise exception 'Класс не найден'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>70
    then raise exception 'Расписание должно содержать не более 70 уроков'; end if;
  -- Вся замена выполняется в одной транзакции. Ошибка не удалит старое расписание.
  delete from public.class_schedule_items where class_id=p_class_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_day:=(v_item->>'day_of_week')::int;
    v_title:=btrim(coalesce(v_item->>'title',''));
    v_start:=(v_item->>'start_time')::time;
    v_end:=(v_item->>'end_time')::time;
    if v_day not between 0 and 6 or length(v_title) not between 1 and 120
      or v_start is null or v_end is null or v_end<=v_start
      then raise exception 'Проверь предметы и время уроков'; end if;
    insert into public.class_schedule_items(class_id,day_of_week,title,start_time,end_time)
      values(p_class_id,v_day,v_title,v_start,v_end);
    v_count:=v_count+1;
  end loop;
  update public.class_groups set schedule_updated_at=clock_timestamp() where id=p_class_id;
  return v_count;
end;
$$;

-- Функции definer нельзя оставлять открытыми неавторизованным пользователям.
revoke all on function public.week_is_admin(), public.week_in_class(uuid),
  public.week_code_hash(text), public.week_check_class_code(text),
  public.week_create_class(text), public.week_rotate_class_code(uuid),
  public.week_join_class(text), public.week_replace_class_schedule(uuid,jsonb),
  public.week_signup_join_class() from public, anon;
grant execute on function public.week_is_admin(), public.week_in_class(uuid),
  public.week_code_hash(text), public.week_create_class(text),
  public.week_rotate_class_code(uuid), public.week_join_class(text),
  public.week_replace_class_schedule(uuid,jsonb) to authenticated;
grant execute on function public.week_check_class_code(text) to anon, authenticated;

notify pgrst, 'reload schema';
