-- week. 1.6: цвета задач. Запустить в Supabase SQL Editor для существующей базы.
-- Маленькое текстовое поле, отдельная таблица не нужна.
alter table public.tasks add column if not exists color text not null default 'default';
alter table public.task_requests add column if not exists color text not null default 'default';
