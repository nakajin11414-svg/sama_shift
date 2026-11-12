-- ============================================================
-- 運営・社員の「休み希望」: 希望の種類に 'off' を追加
-- 0011 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 何度実行しても大丈夫です
-- 休み希望は出勤には数えません（確定シフト・人数・社員の休み残りのどれにも出勤として出ない）
-- ============================================================

alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in ('parts', 'custom', 'office', 'off'));

alter table public.change_requests drop constraint if exists change_requests_type_check;
alter table public.change_requests add constraint change_requests_type_check check (type in ('parts', 'custom', 'office', 'off'));
