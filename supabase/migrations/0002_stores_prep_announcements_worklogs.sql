-- ============================================================
-- 追加機能: 複数店舗 / 仕込み枠 / お知らせ / デリバリー・厨房 / 実働時間
-- 0001 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
-- 既存の名簿・希望はそのまま最初の店舗に引き継がれます
-- ============================================================

-- ---------- 店舗 ----------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  -- 枠ごとの時間帯（時間指定の希望をどの枠に数えるか）
  windows jsonb not null default '{"prep":[9,11],"lunch":[11,15],"dinner":[17,22]}',
  -- 区分ごとの基準人数
  rules jsonb not null default '{"weekday":{"prep":1,"lunch":4,"dinner":4},"holiday":{"prep":1,"lunch":5,"dinner":5},"event":{"prep":2,"lunch":6,"dinner":6}}',
  holidays date[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 既存の settings から最初の店舗を作る
insert into public.stores (name, sort_order, rules, holidays)
select '本店', 0,
  jsonb_build_object(
    'weekday', (rules->'weekday') || '{"prep":1}',
    'holiday', (rules->'holiday') || '{"prep":1}',
    'event',   coalesce(rules->'event', '{"lunch":6,"dinner":6}') || '{"prep":2}'),
  holidays
from public.settings where id = 1;

-- ---------- スタッフ: スキルと所属店舗 ----------
alter table public.staff
  add column can_delivery boolean not null default false,
  add column can_kitchen boolean not null default false;

create table public.staff_stores (
  staff_id uuid references public.staff(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  primary key (staff_id, store_id)
);
insert into public.staff_stores (staff_id, store_id)
select s.id, (select id from public.stores order by sort_order limit 1) from public.staff s;

-- ---------- 希望: 店舗と枠（仕込み・ランチ・ディナーの組み合わせ） ----------
-- 移行中は「スタッフが書き換えたら未承認に戻す」トリガーを止める（承認状態を保つため）
alter table public.requests disable trigger requests_reset_status;

alter table public.requests
  add column store_id uuid references public.stores(id) on delete cascade,
  add column parts text[] not null default '{}';
-- 先に古い型チェックを外してから書き換える
alter table public.requests drop constraint requests_type_check;
update public.requests set store_id = (select id from public.stores order by sort_order limit 1);
update public.requests set parts = case type
  when 'lunch' then array['lunch']
  when 'dinner' then array['dinner']
  when 'both' then array['lunch','dinner']
  else array[]::text[] end;
update public.requests set type = 'parts' where type in ('lunch', 'dinner', 'both');
alter table public.requests alter column store_id set not null;
alter table public.requests add constraint requests_type_check check (type in ('parts', 'custom'));
alter table public.requests drop constraint requests_staff_id_date_key;
alter table public.requests add constraint requests_staff_date_store_key unique (staff_id, date, store_id);

alter table public.requests enable trigger requests_reset_status;

-- ---------- 日ごとの設定・公開: 店舗ごとに ----------
alter table public.day_settings add column store_id uuid references public.stores(id) on delete cascade;
update public.day_settings set store_id = (select id from public.stores order by sort_order limit 1);
alter table public.day_settings alter column store_id set not null;
alter table public.day_settings drop constraint day_settings_pkey;
alter table public.day_settings add primary key (store_id, date);

alter table public.publications add column store_id uuid references public.stores(id) on delete cascade;
update public.publications set store_id = (select id from public.stores order by sort_order limit 1);
alter table public.publications alter column store_id set not null;
alter table public.publications drop constraint publications_pkey;
alter table public.publications add primary key (store_id, month);

-- ---------- お知らせ ----------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,  -- null = 全店舗
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.profiles add column announcements_read_at timestamptz not null default 'epoch';

-- ---------- 実働時間（管理者が入力） ----------
create table public.work_logs (
  request_id uuid primary key references public.requests(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  break_min int not null default 0,
  note text,
  updated_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.stores enable row level security;
alter table public.staff_stores enable row level security;
alter table public.announcements enable row level security;
alter table public.work_logs enable row level security;

create policy "stores_select" on public.stores for select to authenticated using (true);
create policy "stores_write" on public.stores for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "staff_stores_select" on public.staff_stores for select to authenticated using (true);
create policy "staff_stores_write" on public.staff_stores for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "announcements_select" on public.announcements for select to authenticated using (true);
create policy "announcements_write" on public.announcements for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- 既読時刻は本人だけ更新できるようにする（role は管理者以外変えられない）
create policy "profiles_update_self_read" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create or replace function public.profiles_guard_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and not public.is_manager() then
    raise exception '権限がありません';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.profiles_guard_role();

-- 実働時間: 管理者は全部、スタッフは自分の分だけ閲覧
create policy "work_logs_select" on public.work_logs for select to authenticated
  using (public.is_manager() or exists (
    select 1 from public.requests r where r.id = request_id and r.staff_id = public.my_staff_id()));
create policy "work_logs_write" on public.work_logs for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------- リアルタイム ----------
alter publication supabase_realtime add table public.stores, public.staff_stores, public.announcements, public.work_logs;
