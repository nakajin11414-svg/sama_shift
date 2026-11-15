-- ============================================================
-- 実働時間を給与期間（締め日の翌日〜次の締め日）で管理する
--   settings.pay_closing_day : 締め日（1〜28。28 は「月末締め」として扱う）
--   settings.pay_day         : 支給日（1〜31。その月に無い日は月末）
--   pay_period_locks         : 締め確定（期間 × 店舗）。period_key は支給月 "YYYY-MM"
--   締め確定した期間の実働（work_logs と、日ごとの実働入力 day_settings.work_hours / delivery）は
--   管理者でも変更できない
-- 何度実行しても安全です
-- ============================================================

alter table public.settings add column if not exists pay_closing_day int not null default 15;
alter table public.settings add column if not exists pay_day int not null default 25;
alter table public.settings drop constraint if exists settings_pay_closing_day_check;
alter table public.settings add constraint settings_pay_closing_day_check check (pay_closing_day between 1 and 28);
alter table public.settings drop constraint if exists settings_pay_day_check;
alter table public.settings add constraint settings_pay_day_check check (pay_day between 1 and 31);

create table if not exists public.pay_period_locks (
  period_key text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  locked_at timestamptz not null default now(),
  locked_by uuid references public.profiles(id) on delete set null,
  primary key (period_key, store_id)
);
alter table public.pay_period_locks enable row level security;
drop policy if exists "pay_period_locks_select" on public.pay_period_locks;
drop policy if exists "pay_period_locks_write" on public.pay_period_locks;
create policy "pay_period_locks_select" on public.pay_period_locks for select to authenticated using (true);
create policy "pay_period_locks_write" on public.pay_period_locks for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- その日が属する給与期間のキー（支給月 "YYYY-MM"）。src/lib/util.js の payPeriodFor と同じ計算
--   締め日 c（28 以上は月末締め）、支給日 p
--   期間の終わりの月 em: 月末締めならその月、そうでなければ 日 <= c ならその月、c より後なら翌月
--   支給月: 月末締め、または p <= c なら em の翌月、そうでなければ em
create or replace function public.pay_period_key(d date)
returns text language sql stable security definer set search_path = public as $$
  with s as (select pay_closing_day as c, pay_day as p from public.settings where id = 1),
  e as (
    select s.c, s.p,
      case when s.c >= 28 or extract(day from d) <= s.c then date_trunc('month', d)::date
           else (date_trunc('month', d) + interval '1 month')::date end as em
    from s
  )
  select to_char(case when e.c >= 28 or e.p <= e.c then (e.em + interval '1 month')::date else e.em end, 'YYYY-MM') from e;
$$;

create or replace function public.pay_period_locked(p_store uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_store is not null and p_date is not null and exists (
    select 1 from public.pay_period_locks l where l.store_id = p_store and l.period_key = public.pay_period_key(p_date));
$$;

-- 個別に直した実働（work_logs）: 締め確定した期間は追加・変更・削除できない
create or replace function public.work_logs_guard_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select store_id, date into r from public.requests where id = old.request_id;
    if found and public.pay_period_locked(r.store_id, r.date) then
      raise exception 'この期間は締め確定済みです。解除してから修正してください';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select store_id, date into r from public.requests where id = new.request_id;
    if found and public.pay_period_locked(r.store_id, r.date) then
      raise exception 'この期間は締め確定済みです。解除してから修正してください';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists work_logs_guard_lock on public.work_logs;
create trigger work_logs_guard_lock before insert or update or delete on public.work_logs
  for each row execute function public.work_logs_guard_lock();

-- 日ごとの実働入力（day_settings.work_hours / delivery）: 締め確定した期間は変更できない
-- （区分・定休日・募集など、ほかの列の変更はこれまでどおりできる）
create or replace function public.day_settings_guard_lock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (new.work_hours is not null or new.delivery is not null) and public.pay_period_locked(new.store_id, new.date) then
      raise exception 'この期間は締め確定済みです。解除してから修正してください';
    end if;
  elsif tg_op = 'UPDATE' then
    if (new.work_hours is distinct from old.work_hours or new.delivery is distinct from old.delivery)
       and public.pay_period_locked(new.store_id, new.date) then
      raise exception 'この期間は締め確定済みです。解除してから修正してください';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists day_settings_guard_lock on public.day_settings;
create trigger day_settings_guard_lock before insert or update on public.day_settings
  for each row execute function public.day_settings_guard_lock();

-- リアルタイム
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pay_period_locks') then
    alter publication supabase_realtime add table public.pay_period_locks;
  end if;
end $$;
