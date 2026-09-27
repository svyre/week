-- week. 2.1: безопасная проверка использования базы и кандидатов на очистку.
-- Все запросы ниже ТОЛЬКО ЧИТАЮТ ДАННЫЕ. Пользовательские задачи не удаляются.
-- Запускать администратору в SQL Editor Supabase по мере необходимости.

select pg_size_pretty(pg_database_size(current_database())) as database_size;
select schemaname, relname as table_name, n_live_tup as estimated_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as full_size
from pg_stat_user_tables
where schemaname='public'
order by pg_total_relation_size(relid) desc;

select
  (select count(*) from public.tasks) as tasks_total,
  (select count(*) from public.tasks where status='done') as completed_tasks,
  (select count(*) from public.tasks where status='open' and date<current_date-90) as unfinished_older_90_days,
  (select count(*) from public.task_requests where status<>'pending' and created_at<now()-interval '90 days') as old_resolved_proposals,
  (select count(*) from public.notification_events where created_at<now()-interval '30 days') as old_notification_events;

-- При необходимости администратор отдельно принимает решение об очистке
-- устаревших notification_events и принятых/отклонённых предложений.
-- Удаление tasks вручную тоже удалит связанные time_logs из-за ON DELETE CASCADE.
-- Не удаляйте задачи автоматически: даты выполнения и долгосрочная история
-- пока не отделены от исходных записей.

-- Если в будущем решишь очищать старые технические события, только после
-- резервной копии и проверки COUNT выше можно отдельно выполнить:
-- DELETE FROM public.notification_events
-- WHERE created_at < now() - interval '30 days';
-- Связанные записи push_notification_event_log удалятся по каскаду.
-- Эта команда закомментирована: запуск файла НИЧЕГО не удаляет.
