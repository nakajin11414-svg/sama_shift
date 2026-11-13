-- ============================================================
-- 役職に「研修中」を追加 / 研修の回数の設定
-- 0012 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 何度実行しても大丈夫です
-- 研修中は出勤の人数に数えません。研修の回数（初期値10回）出勤したら研修終了の表示になります
-- ============================================================

alter table public.staff drop constraint if exists staff_position_check;
alter table public.staff add constraint staff_position_check
  check (position in ('operation', 'employee', 'part_time', 'trainee'));

alter table public.settings add column if not exists training_shifts int not null default 10 check (training_shifts > 0);
