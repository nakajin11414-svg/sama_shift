-- ============================================================
-- お知らせに画像・動画を添付する
--   announcements.attachments : [{ path, type, name }]（path は Storage の announcements バケット内のパス）
--   Storage バケット announcements（非公開。ログインした人だけ見られる。1ファイル50MBまで）
--   アップロード・削除は管理者だけ
-- 何度実行しても安全です
-- ============================================================

alter table public.announcements add column if not exists attachments jsonb not null default '[]';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcements', 'announcements', false, 52428800, array['image/*', 'video/*'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "announcement_media_select" on storage.objects;
drop policy if exists "announcement_media_insert" on storage.objects;
drop policy if exists "announcement_media_delete" on storage.objects;

create policy "announcement_media_select" on storage.objects for select to authenticated
  using (bucket_id = 'announcements');
create policy "announcement_media_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'announcements' and public.is_manager());
create policy "announcement_media_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'announcements' and public.is_manager());
