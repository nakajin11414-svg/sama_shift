-- ============================================================
-- シフト表アプリ スキーマ
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください
-- ============================================================

-- ---------- ログインユーザー ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text unique not null,
  display_name text not null,
  picture_url text,
  role text not null default 'pending' check (role in ('pending', 'staff', 'manager')),
  created_at timestamptz not null default now()
);

-- ---------- スタッフ名簿（管理者が管理） ----------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  profile_id uuid unique references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 店の設定（1行だけ） ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  rules jsonb not null default '{"weekday":{"lunch":4,"dinner":4},"holiday":{"lunch":5,"dinner":5},"event":{"lunch":6,"dinner":6}}',
  holidays date[] not null default '{}'
);
insert into public.settings (id) values (1);

-- ---------- 日ごとの設定（区分の上書き・再募集） ----------
create table public.day_settings (
  date date primary key,
  day_type text check (day_type in ('weekday', 'holiday', 'event')),
  recruit boolean not null default false
);

-- ---------- シフト希望 ----------
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  type text not null check (type in ('lunch', 'dinner', 'both', 'custom')),
  start_time time,
  end_time time,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  updated_at timestamptz not null default now(),
  unique (staff_id, date)
);

-- ---------- 月ごとの公開 ----------
create table public.publications (
  month text primary key,           -- '2026-09'
  published_at timestamptz not null default now()
);

-- ---------- 補助関数 ----------
create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

create or replace function public.my_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.staff where profile_id = auth.uid();
$$;

-- スタッフ本人が希望を書き換えたら承認待ちに戻す
create or replace function public.requests_reset_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if not public.is_manager() then
    if tg_op = 'INSERT' or new.type <> old.type
       or new.start_time is distinct from old.start_time
       or new.end_time is distinct from old.end_time then
      new.status := 'pending';
    else
      new.status := old.status;  -- スタッフは status を直接変えられない
    end if;
  end if;
  return new;
end;
$$;
create trigger requests_reset_status before insert or update on public.requests
  for each row execute function public.requests_reset_status();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.day_settings enable row level security;
alter table public.requests enable row level security;
alter table public.publications enable row level security;

-- profiles: 本人は自分を見られる、管理者は全員を見て役割を変えられる
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_manager());
create policy "profiles_update_manager" on public.profiles for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- staff: ログイン済みなら全員閲覧可、編集は管理者
create policy "staff_select" on public.staff for select to authenticated using (true);
create policy "staff_write" on public.staff for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- settings / day_settings / publications: 閲覧は全員、編集は管理者
create policy "settings_select" on public.settings for select to authenticated using (true);
create policy "settings_write" on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "day_settings_select" on public.day_settings for select to authenticated using (true);
create policy "day_settings_write" on public.day_settings for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "publications_select" on public.publications for select to authenticated using (true);
create policy "publications_write" on public.publications for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- requests: 管理者は全部。スタッフは自分の希望と、承認済みの希望（確定シフト表示用）
create policy "requests_select" on public.requests for select to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id() or status = 'approved');
create policy "requests_insert" on public.requests for insert to authenticated
  with check (public.is_manager() or staff_id = public.my_staff_id());
create policy "requests_update" on public.requests for update to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id())
  with check (public.is_manager() or staff_id = public.my_staff_id());
create policy "requests_delete" on public.requests for delete to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id());

-- ---------- リアルタイム更新 ----------
alter publication supabase_realtime add table public.requests, public.day_settings, public.publications, public.staff, public.settings;
