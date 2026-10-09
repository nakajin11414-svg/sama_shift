-- ============================================================
-- シフト表アプリ 基本スキーマ（初回のみ）
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください
-- 続けて 0002 も実行してください
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text unique not null,
  display_name text not null,
  picture_url text,
  role text not null default 'pending' check (role in ('pending', 'staff', 'manager')),
  created_at timestamptz not null default now()
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  profile_id uuid unique references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  rules jsonb not null default '{"weekday":{"lunch":4,"dinner":4},"holiday":{"lunch":5,"dinner":5},"event":{"lunch":6,"dinner":6}}',
  holidays date[] not null default '{}'
);
insert into public.settings (id) values (1);

create table public.day_settings (
  date date primary key,
  day_type text check (day_type in ('weekday', 'holiday', 'event')),
  recruit boolean not null default false
);

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

create table public.publications (
  month text primary key,
  published_at timestamptz not null default now()
);

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

create or replace function public.my_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.staff where profile_id = auth.uid();
$$;

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
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$;
create trigger requests_reset_status before insert or update on public.requests
  for each row execute function public.requests_reset_status();

alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.day_settings enable row level security;
alter table public.requests enable row level security;
alter table public.publications enable row level security;

create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_manager());
create policy "profiles_update_manager" on public.profiles for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "staff_select" on public.staff for select to authenticated using (true);
create policy "staff_write" on public.staff for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "settings_select" on public.settings for select to authenticated using (true);
create policy "settings_write" on public.settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "day_settings_select" on public.day_settings for select to authenticated using (true);
create policy "day_settings_write" on public.day_settings for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "publications_select" on public.publications for select to authenticated using (true);
create policy "publications_write" on public.publications for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy "requests_select" on public.requests for select to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id() or status = 'approved');
create policy "requests_insert" on public.requests for insert to authenticated
  with check (public.is_manager() or staff_id = public.my_staff_id());
create policy "requests_update" on public.requests for update to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id())
  with check (public.is_manager() or staff_id = public.my_staff_id());
create policy "requests_delete" on public.requests for delete to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id());

alter publication supabase_realtime add table public.requests, public.day_settings, public.publications, public.staff, public.settings;
