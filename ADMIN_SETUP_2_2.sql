-- Запускай в Supabase SQL Editor только ПОСЛЕ MIGRATION_2_2_CLASSES.sql.
-- ЗАМЕНИ адрес ниже на email своего УЖЕ СОЗДАННОГО аккаунта в week.
-- Никому не отправляй свой пароль или service_role key. Они здесь не нужны.
do $$
declare v_email text := 'ТВОЙ_EMAIL_ЗДЕСЬ';
        v_user uuid;
begin
  select id into v_user from auth.users where lower(email)=lower(btrim(v_email));
  if v_user is null then
    raise exception 'Аккаунт с email % не найден. Замени ТВОЙ_EMAIL_ЗДЕСЬ на свой email.', v_email;
  end if;
  insert into public.week_admins(user_id) values(v_user) on conflict(user_id) do nothing;
  raise notice 'Права администратора выданы аккаунту %',v_email;
end $$;
