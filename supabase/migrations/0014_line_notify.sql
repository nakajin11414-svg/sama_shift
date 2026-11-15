-- ============================================================
-- LINE通知（Messaging API）
--   profiles.line_friend          : 公式アカウントを友だち追加しているか（Edge Function line-notify が確認して保存）
--   profiles.line_friend_checked_at: 最後に確認した日時
--   announcements.notified_at     : お知らせをLINEで送った日時
--   settings.line_bot_id          : 公式アカウントのID（@xxxx）。友だち追加リンクに使う
-- 何度実行しても安全です
-- ============================================================

alter table public.profiles add column if not exists line_friend boolean not null default false;
alter table public.profiles add column if not exists line_friend_checked_at timestamptz;
alter table public.announcements add column if not exists notified_at timestamptz;
alter table public.settings add column if not exists line_bot_id text;
