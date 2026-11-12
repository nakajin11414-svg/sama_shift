-- ============================================================
-- シフト希望の締切と変更依頼
-- 0007 を実行済みのプロジェクトで、SQL Editor に貼り付けて実行してください
--   month_settings  : 店舗・月ごとの締切日（この日まで入力できる。日本時間）
--   change_requests : 締切後にスタッフが送る変更依頼（管理者が承諾すると希望に反映）
-- 締切後、スタッフは「募集中」の日以外の希望を直接変更できなくなります（管理者は常に変更可）
-- ============================================================

-- ---------- 締切 ----------
create table public.month_settings (
  store_id uuid not null references public.stores(id) on delete cascade,
  month text not null,              -- 'YYYY-MM'
  deadline date,                    -- この日の終わりまで入力できる
  primary key (store_id, month)
);
alter table public.month_settings enable row level security;
create policy "month_settings_select" on public.month_settings for select to authenticated using (true);
create policy "month_settings_write" on public.month_settings for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- その日の希望が締切で固定されているか（募集中の日は固定しない）
create or replace function public.request_locked(p_store uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.month_settings m
      where m.store_id = p_store and m.month = to_char(p_date, 'YYYY-MM')
        and m.deadline is not null
        and m.deadline < (now() at time zone 'Asia/Tokyo')::date)
    and not coalesce((select d.recruit from public.day_settings d where d.store_id = p_store and d.date = p_date), false);
$$;

create or replace function public.requests_guard_deadline()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    if (tg_op in ('INSERT', 'UPDATE') and public.request_locked(new.store_id, new.date))
       or (tg_op in ('UPDATE', 'DELETE') and public.request_locked(old.store_id, old.date)) then
      raise exception '締切を過ぎているため変更できません。希望入力の画面から変更依頼を送ってください';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger requests_guard_deadline before insert or update or delete on public.requests
  for each row execute function public.requests_guard_deadline();

-- ---------- 変更依頼 ----------
create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  date date not null,
  action text not null check (action in ('set', 'remove')),   -- set = 追加・変更 / remove = 取り消し
  type text check (type in ('parts', 'custom')),
  parts text[] not null default '{}',
  start_time time,
  end_time time,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index change_requests_status_idx on public.change_requests (status, date);
alter table public.change_requests enable row level security;

create policy "change_requests_select" on public.change_requests for select to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id());
create policy "change_requests_insert" on public.change_requests for insert to authenticated
  with check (public.is_manager() or (staff_id = public.my_staff_id() and status = 'pending'));
create policy "change_requests_update" on public.change_requests for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
-- 本人は未処理の依頼だけ取り下げられる
create policy "change_requests_delete" on public.change_requests for delete to authenticated
  using (public.is_manager() or (staff_id = public.my_staff_id() and status = 'pending'));

alter publication supabase_realtime add table public.month_settings, public.change_requests;
