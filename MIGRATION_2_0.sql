-- week. 2.0: completion activity days for the streak. Safe to rerun.
-- A maximum of one record is stored per user and date. No backfill is invented.
create table if not exists public.task_completion_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.task_completion_days enable row level security;
drop policy if exists "task_completion_days_own" on public.task_completion_days;
create policy "task_completion_days_own"
  on public.task_completion_days
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
