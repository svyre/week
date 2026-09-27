-- Выполни один раз в Supabase -> SQL Editor, если база уже существует.
-- Новому проекту достаточно выполнить supabase.sql (миграция включена туда).
alter table public.tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.task_requests add column if not exists checklist jsonb not null default '[]'::jsonb;
