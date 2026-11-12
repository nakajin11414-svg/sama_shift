-- ============================================================
-- 社員の月ごとの休みの日数（全店舗共通）
-- 0008 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- ============================================================

create table public.month_quotas (
  month text primary key,                 -- 'YYYY-MM'
  employee_days_off int not null check (employee_days_off >= 0)
);
alter table public.month_quotas enable row level security;
create policy "month_quotas_select" on public.month_quotas for select to authenticated using (true);
create policy "month_quotas_write" on public.month_quotas for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

alter publication supabase_realtime add table public.month_quotas;
