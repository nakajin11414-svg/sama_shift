-- ============================================================
-- 事務日（運営・社員のみ・管理者だけが設定）: 出勤の種類に「事務」を追加
-- 0010 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 何度実行しても大丈夫です（以前の版を実行済みでも、もう一度実行すれば最新になります）
-- 事務は出勤日に数えますが、仕込み・ランチ・ディナーの人数には数えません
-- ============================================================

alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests add constraint requests_type_check check (type in ('parts', 'custom', 'office'));

alter table public.change_requests drop constraint if exists change_requests_type_check;
alter table public.change_requests add constraint change_requests_type_check check (type in ('parts', 'custom', 'office'));

-- 事務は管理者だけが、運営・社員に対してだけ設定できる
create or replace function public.requests_guard_office()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'office' and (tg_op = 'INSERT' or old.type is distinct from 'office') then
    if not public.is_manager() then
      raise exception '事務は管理者だけが設定できます';
    end if;
    if not exists (select 1 from public.staff where id = new.staff_id and position in ('operation', 'employee')) then
      raise exception '事務は役職が運営・社員の人だけ設定できます';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists requests_guard_office on public.requests;
create trigger requests_guard_office before insert or update on public.requests
  for each row execute function public.requests_guard_office();
