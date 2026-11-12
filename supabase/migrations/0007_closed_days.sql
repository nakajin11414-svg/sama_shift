-- ============================================================
-- 定休日
-- 0006 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
--   stores.closed_weekdays : 毎週の定休日（0=日 1=月 … 6=土）
--   day_settings.closed    : 日ごとの上書き（null=毎週の設定どおり / true=休業 / false=営業）
-- ============================================================

alter table public.stores add column closed_weekdays int[] not null default '{}';
alter table public.day_settings add column closed boolean;
