-- ============================================================
-- スタッフのできる仕事に「仕込み」「中堅」「ホール」を追加
-- 0004 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- ============================================================

alter table public.staff
  add column can_prep boolean not null default false,
  add column can_mid boolean not null default false,
  add column can_hall boolean not null default false;
