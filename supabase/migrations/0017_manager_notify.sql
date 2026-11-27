-- ============================================================
-- LINE通知の宛先を分ける: 管理者宛ての通知（変更依頼・募集への希望）を受け取るか
--   profiles.notify_manager : 管理者ごとの受け取り設定（初期値は受け取る）
--   「管理者 → スタッフ名簿」の「LINE通知」で切り替えます
-- 何度実行しても安全です
-- ============================================================

alter table public.profiles add column if not exists notify_manager boolean not null default true;
