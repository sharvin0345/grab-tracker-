-- Local stand-in for Supabase auth, then the real setup script, then checks.
-- Not run by the app. The builder uses it against a scratch database.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, authenticator, supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, authenticator, supabase_auth_admin;
grant insert, update on auth.users to supabase_auth_admin;

-- Supabase grants new public tables and functions to anon. The setup script must take that back.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

\ir ../supabase-setup.sql

-- Run the script a second time. It must be safe to paste again.
\ir ../supabase-setup.sql

do $$
begin
  if has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'FAIL: anon can read profiles';
  end if;
  if has_table_privilege('anon', 'public.rides', 'select') then
    raise exception 'FAIL: anon can read rides';
  end if;
  if has_function_privilege('anon', 'public.admin_set_approved(uuid, boolean)', 'execute') then
    raise exception 'FAIL: anon can call admin_set_approved';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_set_approved(uuid, boolean)', 'execute') then
    raise exception 'FAIL: signed-in users cannot call admin_set_approved';
  end if;
  if has_table_privilege('authenticated', 'public.profiles', 'update') then
    raise exception 'FAIL: drivers can update profiles directly';
  end if;
  if not has_table_privilege('authenticated', 'public.rides', 'insert') then
    raise exception 'FAIL: approved drivers need insert on rides';
  end if;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'driver@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'other@example.com');

-- Sign-up trigger must lock the account and create settings.
do $$
begin
  if (select count(*) from public.profiles) <> 3 then
    raise exception 'FAIL: sign-up did not create profiles';
  end if;
  if exists (select 1 from public.profiles where approved or is_admin) then
    raise exception 'FAIL: a new account was approved or admin';
  end if;
  if (select count(*) from public.settings) <> 3 then
    raise exception 'FAIL: sign-up did not create settings';
  end if;
  if (select daily_target from public.settings where user_id = '22222222-2222-4222-8222-222222222222') <> 300 then
    raise exception 'FAIL: default target is not 300';
  end if;
end $$;

-- A brand-new auth role (not the table owner) can still sign a user up.
set role supabase_auth_admin;
insert into auth.users (id, email) values ('44444444-4444-4444-8444-444444444444', 'via-auth@example.com');
reset role;

do $$
begin
  if not exists (select 1 from public.profiles where email = 'via-auth@example.com' and approved = false) then
    raise exception 'FAIL: auth admin insert did not create a locked profile';
  end if;
end $$;

-- Driver cannot write, and cannot see other people.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: driver can see other profiles';
  end if;
  if (select count(*) from public.rides) <> 0 then
    raise exception 'FAIL: unexpected rides';
  end if;
  if (select count(*) from public.settings) <> 0 then
    raise exception 'FAIL: unapproved driver can read settings';
  end if;
  begin
    insert into public.rides (user_id, client_id, day_key, amount, pay, platform, ts)
    values ('22222222-2222-4222-8222-222222222222', 'ride-1', '2026-11-17', 12.50, 'cash', 'Grab', now());
    raise exception 'FAIL: unapproved driver inserted a ride';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform public.admin_set_approved('33333333-3333-4333-8333-333333333333', true);
    raise exception 'FAIL: driver approved someone';
  exception
    when others then
      if sqlerrm = 'FAIL: driver approved someone' then raise; end if;
      if sqlerrm <> 'Not allowed' then
        raise exception 'FAIL: unexpected admin error: %', sqlerrm;
      end if;
  end;
end $$;

reset role;
update public.profiles set is_admin = true, approved = true where email = 'owner@example.com';

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;

do $$
declare
  n int;
begin
  select count(*) into n from public.profiles;
  if n < 4 then
    raise exception 'FAIL: owner cannot list sign-ups (saw %)', n;
  end if;
  perform public.admin_set_approved('22222222-2222-4222-8222-222222222222', true);
end $$;

reset role;

do $$
begin
  if not (select approved from public.profiles where email = 'driver@example.com') then
    raise exception 'FAIL: approve did not stick';
  end if;
  if (select is_admin from public.profiles where email = 'driver@example.com') then
    raise exception 'FAIL: approve also made them admin';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;

insert into public.rides (user_id, client_id, day_key, amount, pay, platform, ts)
values ('22222222-2222-4222-8222-222222222222', 'ride-1', '2026-11-17', 12.50, 'cash', 'Grab', now());

do $$
begin
  begin
    insert into public.rides (user_id, client_id, day_key, amount, pay, platform, ts)
    values ('22222222-2222-4222-8222-222222222222', 'ride-x', '2026-11-17', 10, 'cash', 'Uber', now());
    raise exception 'FAIL: unknown platform was stored';
  exception
    when check_violation then
      null;
  end;
  begin
    insert into public.rides (user_id, client_id, day_key, amount, pay, platform, ts)
    values ('33333333-3333-4333-8333-333333333333', 'ride-stolen', '2026-11-17', 10, 'cash', 'Bolt', now());
    raise exception 'FAIL: driver wrote another user ride';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
set role authenticated;

do $$
begin
  if (select count(*) from public.rides) <> 0 then
    raise exception 'FAIL: other driver can read rides';
  end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'FAIL: other driver can list sign-ups';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
select public.admin_set_approved('22222222-2222-4222-8222-222222222222', false);

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;

do $$
begin
  if (select count(*) from public.rides) <> 0 then
    raise exception 'FAIL: revoked driver can still read rides';
  end if;
end $$;

reset role;
update auth.users set email = 'driver2@example.com' where id = '22222222-2222-4222-8222-222222222222';

do $$
begin
  if (select email from public.profiles where id = '22222222-2222-4222-8222-222222222222') <> 'driver2@example.com' then
    raise exception 'FAIL: email change did not copy onto the profile';
  end if;
  if (select count(*) from public.rides where client_id = 'ride-1' and deleted = false) <> 1 then
    raise exception 'FAIL: revoke deleted the ride';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '', false);
reset role;
