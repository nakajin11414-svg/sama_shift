-- ============================================================
-- 管理者が枠を変えて出勤にしたとき、スタッフの元の希望を残す
-- 0009 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 例: {"type":"parts","parts":["lunch","dinner"],"start_time":null,"end_time":null}
-- ============================================================

alter table public.requests add column desired jsonb;
