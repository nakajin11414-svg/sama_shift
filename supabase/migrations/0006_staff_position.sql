-- ============================================================
-- スタッフの役職（運営・社員・アルバイト）
-- 0005 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 既存のスタッフはすべて「アルバイト」になります
-- ============================================================

alter table public.staff
  add column position text not null default 'part_time'
  check (position in ('operation', 'employee', 'part_time'));
