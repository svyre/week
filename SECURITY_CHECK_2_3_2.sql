-- week. 2.3.2 SECURITY CHECK
-- Read-only checks. Run after MIGRATION_2_3_2_SECURITY.sql.

-- 1) Every ordinary table in public should have RLS enabled.
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind='r'
  and not c.relrowsecurity
order by c.relname;

-- Expected: 0 rows.

-- 2) Anonymous role should not have direct table privileges in public.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and grantee='anon'
order by table_name, privilege_type;

-- Expected: 0 rows. Pre-login access to the class code is through a controlled RPC.

-- 3) public_profiles must not be readable by browser roles.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name='public_profiles'
  and grantee in ('anon','authenticated');

-- Expected: 0 rows.

-- 4) Only deliberate RPCs should be executable by browser roles.
select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public'
  and grantee in ('anon','authenticated')
order by grantee, routine_name;

-- Review this list. Authenticated should contain only week_* RPCs used by the app.
-- anon should contain only week_check_class_code.

-- 5) Confirm critical hardening functions exist.
select
  to_regprocedure('public.week_ensure_profile()') is not null as secure_profile_recovery,
  to_regprocedure('public.week_set_task_status(uuid,text)') is not null as shared_status_rpc,
  to_regprocedure('public.week_set_task_checklist(uuid,jsonb)') is not null as shared_checklist_rpc,
  to_regprocedure('private.week_is_task_member(uuid,uuid)') is not null as private_task_rls_helper,
  to_regprocedure('private.week_is_admin()') is not null as private_admin_rls_helper;

-- Expected: all true.
