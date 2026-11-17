-- RideTarget database setup
-- Paste this whole file into the Supabase SQL editor and press Run.
-- You can run it again later. It will not wipe existing rides.
--
-- After you sign up in the app, the last commented line shows how to
-- make your email the owner.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_target numeric(10, 2) not null default 300,
  last_pay text not null default 'cash',
  last_platform text not null default 'Grab',
  platforms text[] not null default array[
    'Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt',
    'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'
  ]::text[],
  days jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_target_range check (daily_target > 0 and daily_target <= 999999.99),
  constraint settings_last_pay check (last_pay in ('cash', 'credit')),
  constraint settings_last_platform check (last_platform in (
    'Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt',
    'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'
  )),
  constraint settings_platforms_known check (
    cardinality(platforms) >= 1
    and platforms <@ array[
      'Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt',
      'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'
    ]::text[]
  ),
  constraint settings_days_object check (jsonb_typeof(days) = 'object'),
  constraint settings_days_size check (octet_length(days::text) < 500000)
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  day_key date not null,
  amount numeric(10, 2) not null,
  pay text not null,
  platform text not null,
  ts timestamptz not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint rides_user_client unique (user_id, client_id),
  constraint rides_amount_range check (amount > 0 and amount <= 99999.99),
  constraint rides_pay check (pay in ('cash', 'credit')),
  constraint rides_platform check (platform in (
    'Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt',
    'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'
  )),
  constraint rides_client_id_len check (char_length(client_id) between 1 and 80)
);

create index if not exists rides_user_day_idx on public.rides (user_id, day_key);
create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- Helpers. security definer so Row Level Security can ask "is this user
-- approved?" without looping. They only return true/false for the signed-in user.
-- ---------------------------------------------------------------------------

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.approved from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Block the signed-in app user from changing approved / is_admin / email.
-- The SQL editor (postgres) and the security-definer functions below still can.
create or replace function public.protect_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator') then
    raise exception 'Not allowed';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Create a locked profile the moment someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, approved, is_admin)
  values (new.id, coalesce(new.email, ''), false, false)
  on conflict (id) do nothing;

  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = coalesce(new.email, '')
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists set_rides_updated_at on public.rides;
create trigger set_rides_updated_at
  before update on public.rides
  for each row execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

drop trigger if exists protect_profile_write on public.profiles;
create trigger protect_profile_write
  before insert or update or delete on public.profiles
  for each row execute function public.protect_profile();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Owner-only. The app calls this from the admin page.
-- A normal driver cannot approve anyone, even if they edit the page.
create or replace function public.admin_set_approved(target_id uuid, make_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if target_id is null then
    raise exception 'Missing account';
  end if;
  update public.profiles
     set approved = coalesce(make_approved, false)
   where id = target_id;
  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Supabase grants new tables to anon by default, so take that
-- back. Drivers use the signed-in role only, and only through the policies.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from PUBLIC, anon, authenticated;
revoke all on table public.rides from PUBLIC, anon, authenticated;
revoke all on table public.settings from PUBLIC, anon, authenticated;

grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.rides to authenticated;
grant select, insert, update, delete on table public.settings to authenticated;

revoke all on function public.is_approved() from PUBLIC, anon;
revoke all on function public.is_admin() from PUBLIC, anon;
revoke all on function public.admin_set_approved(uuid, boolean) from PUBLIC, anon, authenticated;

grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_set_approved(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. Each person only touches their own rows, and only
-- after approved = true. Admins can read every profile (so the owner page
-- can list sign-ups) but cannot read other people's rides.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rides enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists rides_select on public.rides;
create policy rides_select
  on public.rides
  for select
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

drop policy if exists rides_insert on public.rides;
create policy rides_insert
  on public.rides
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists rides_update on public.rides;
create policy rides_update
  on public.rides
  for update
  to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists rides_delete on public.rides;
create policy rides_delete
  on public.rides
  for delete
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

drop policy if exists settings_select on public.settings;
create policy settings_select
  on public.settings
  for select
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

drop policy if exists settings_insert on public.settings;
create policy settings_insert
  on public.settings
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists settings_update on public.settings;
create policy settings_update
  on public.settings
  for update
  to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists settings_delete on public.settings;
create policy settings_delete
  on public.settings
  for delete
  to authenticated
  using (user_id = auth.uid() and public.is_approved());

notify pgrst, 'reload schema';

-- After you create your own account in the app, run the next line once.
-- Delete the two dashes at the start, put your email inside the quotes, then Run.
-- update public.profiles set is_admin = true, approved = true where email = 'you@email.com';
