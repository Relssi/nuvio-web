-- =====================================================================
-- Nuvio web backend - Stage 1: accounts, profiles, profile PINs, devices
--
-- Recreates the Supabase functions the Nuvio app calls for accounts and
-- profiles (sync_pull_profiles, sync_push_profiles, get_sync_owner, ...).
-- Safe to run more than once. Run it in Supabase > SQL Editor.
--
-- Sharing model: every account has an "owner". By default the owner is
-- the account itself. Link a friend's account to yours with
--   select public.nuvio_link_account('friend@email', 'you@email');
-- and from then on the friend sees and edits the same profiles (and, in
-- later stages, the same history and library) as you.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Account links (friend account -> owner account)
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_account_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint nuvio_account_links_not_self check (user_id <> owner_id)
);
alter table public.nuvio_account_links enable row level security;
-- No policies: only the functions below (security definer) read it.

create or replace function public.get_sync_owner()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    else coalesce(
      (select l.owner_id from public.nuvio_account_links l where l.user_id = auth.uid()),
      auth.uid()
    )
  end;
$$;
revoke all on function public.get_sync_owner() from public, anon;
grant execute on function public.get_sync_owner() to authenticated;

-- Admin helper, run from the SQL editor only.
create or replace function public.nuvio_link_account(friend_email text, owner_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_friend uuid;
  v_owner uuid;
begin
  select id into v_friend from auth.users where lower(email) = lower(trim(friend_email));
  select id into v_owner from auth.users where lower(email) = lower(trim(owner_email));
  if v_friend is null then raise exception 'No account with email %', friend_email; end if;
  if v_owner is null then raise exception 'No account with email %', owner_email; end if;
  if v_friend = v_owner then raise exception 'An account cannot be linked to itself'; end if;
  insert into public.nuvio_account_links (user_id, owner_id)
  values (v_friend, v_owner)
  on conflict (user_id) do update set owner_id = excluded.owner_id;
  return format('%s now shares the data of %s', friend_email, owner_email);
end;
$$;
revoke all on function public.nuvio_link_account(text, text) from public, anon, authenticated;

create or replace function public.nuvio_unlink_account(friend_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.nuvio_account_links
  where user_id = (select id from auth.users where lower(email) = lower(trim(friend_email)));
  return format('%s now uses its own data', friend_email);
end;
$$;
revoke all on function public.nuvio_unlink_account(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_index integer not null check (profile_index between 1 and 20),
  name text not null default 'Profile',
  avatar_color_hex text not null default '#1E88E5',
  avatar_id text,
  -- Uploaded photos are small JPEG data URLs (256 px), so allow ~400 KB.
  avatar_url text check (avatar_url is null or length(avatar_url) <= 400000),
  profile_background_id text,
  profile_background_url text,
  uses_primary_addons boolean not null default false,
  uses_primary_plugins boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_index)
);
alter table public.profiles enable row level security;

drop policy if exists profiles_owner_all on public.profiles;
create policy profiles_owner_all on public.profiles
  for all to authenticated
  using (user_id = public.get_sync_owner())
  with check (user_id = public.get_sync_owner());

create or replace function public.sync_pull_profiles()
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.profiles
  where user_id = public.get_sync_owner()
  order by profile_index;
$$;
revoke all on function public.sync_pull_profiles() from public, anon;
grant execute on function public.sync_pull_profiles() to authenticated;

create or replace function public.sync_push_profiles(
  p_profiles jsonb,
  p_client_max_profiles integer default 5
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
  v_max integer := least(greatest(coalesce(p_client_max_profiles, 5), 1), 20);
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_profiles) <> 'array' then raise exception 'p_profiles must be an array'; end if;
  if jsonb_array_length(p_profiles) > v_max then
    raise exception 'Too many profiles (max %)', v_max;
  end if;

  delete from public.profiles p
  where p.user_id = v_owner
    and p.profile_index not in (
      select (e ->> 'profile_index')::integer from jsonb_array_elements(p_profiles) e
    );

  insert into public.profiles as p (
    user_id, profile_index, name, avatar_color_hex, avatar_id, avatar_url,
    profile_background_id, profile_background_url,
    uses_primary_addons, uses_primary_plugins, updated_at
  )
  select
    v_owner,
    (e ->> 'profile_index')::integer,
    left(coalesce(nullif(trim(e ->> 'name'), ''), 'Profile'), 40),
    coalesce(nullif(e ->> 'avatar_color_hex', ''), '#1E88E5'),
    nullif(e ->> 'avatar_id', ''),
    nullif(e ->> 'avatar_url', ''),
    nullif(e ->> 'profile_background_id', ''),
    nullif(e ->> 'profile_background_url', ''),
    coalesce((e ->> 'uses_primary_addons')::boolean, false),
    coalesce((e ->> 'uses_primary_plugins')::boolean, false),
    now()
  from jsonb_array_elements(p_profiles) e
  on conflict (user_id, profile_index) do update set
    name = excluded.name,
    avatar_color_hex = excluded.avatar_color_hex,
    avatar_id = excluded.avatar_id,
    avatar_url = excluded.avatar_url,
    profile_background_id = excluded.profile_background_id,
    profile_background_url = excluded.profile_background_url,
    uses_primary_addons = excluded.uses_primary_addons,
    uses_primary_plugins = excluded.uses_primary_plugins,
    updated_at = now();
end;
$$;
revoke all on function public.sync_push_profiles(jsonb, integer) from public, anon;
grant execute on function public.sync_push_profiles(jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Profile PINs
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_profile_pins (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_index integer not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  primary key (user_id, profile_index)
);
alter table public.nuvio_profile_pins enable row level security;
-- No policies: PIN hashes are only touched by the functions below.

create or replace function public.sync_pull_profile_locks()
returns table (profile_index integer, pin_enabled boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.profile_index, true
  from public.nuvio_profile_pins p
  where p.user_id = public.get_sync_owner();
$$;

create or replace function public.nuvio_check_current_pin(v_owner uuid, p_profile_id integer, p_current_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from public.nuvio_profile_pins
  where user_id = v_owner and profile_index = p_profile_id;
  if v_hash is not null and (p_current_pin is null or crypt(p_current_pin, v_hash) <> v_hash) then
    raise exception 'Current PIN is incorrect';
  end if;
end;
$$;
revoke all on function public.nuvio_check_current_pin(uuid, integer, text) from public, anon, authenticated;

create or replace function public.set_profile_pin(
  p_profile_id integer,
  p_pin text,
  p_current_pin text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  perform public.nuvio_check_current_pin(v_owner, p_profile_id, p_current_pin);
  insert into public.nuvio_profile_pins (user_id, profile_index, pin_hash)
  values (v_owner, p_profile_id, crypt(p_pin, gen_salt('bf')))
  on conflict (user_id, profile_index) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
end;
$$;

create or replace function public.clear_profile_pin(
  p_profile_id integer,
  p_current_pin text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  perform public.nuvio_check_current_pin(v_owner, p_profile_id, p_current_pin);
  delete from public.nuvio_profile_pins where user_id = v_owner and profile_index = p_profile_id;
end;
$$;

create or replace function public.verify_profile_pin(p_profile_id integer, p_pin text)
returns table (unlocked boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := public.get_sync_owner();
  v_row public.nuvio_profile_pins;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  select * into v_row from public.nuvio_profile_pins
  where user_id = v_owner and profile_index = p_profile_id;
  if not found then
    return query select true, 0;
    return;
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query select false, ceil(extract(epoch from (v_row.locked_until - now())))::integer;
    return;
  end if;
  if crypt(coalesce(p_pin, ''), v_row.pin_hash) = v_row.pin_hash then
    update public.nuvio_profile_pins set failed_attempts = 0, locked_until = null
    where user_id = v_owner and profile_index = p_profile_id;
    return query select true, 0;
  else
    update public.nuvio_profile_pins
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '60 seconds' else null end
    where user_id = v_owner and profile_index = p_profile_id;
    return query select false, case when v_row.failed_attempts + 1 >= 5 then 60 else 0 end;
  end if;
end;
$$;

-- Later stages add their per-profile tables here.
create or replace function public.sync_delete_profile_data(p_profile_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  delete from public.nuvio_profile_pins where user_id = v_owner and profile_index = p_profile_id;
end;
$$;

revoke all on function public.sync_pull_profile_locks() from public, anon;
revoke all on function public.set_profile_pin(integer, text, text) from public, anon;
revoke all on function public.clear_profile_pin(integer, text) from public, anon;
revoke all on function public.verify_profile_pin(integer, text) from public, anon;
revoke all on function public.sync_delete_profile_data(integer) from public, anon;
grant execute on function public.sync_pull_profile_locks() to authenticated;
grant execute on function public.set_profile_pin(integer, text, text) to authenticated;
grant execute on function public.clear_profile_pin(integer, text) to authenticated;
grant execute on function public.verify_profile_pin(integer, text) to authenticated;
grant execute on function public.sync_delete_profile_data(integer) to authenticated;

-- ---------------------------------------------------------------------
-- Devices (the app registers each browser/TV after login)
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id text not null,
  client_name text,
  client_version text,
  platform text,
  device_name text,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, installation_id)
);
alter table public.nuvio_devices enable row level security;

create or replace function public.register_current_device(
  p_installation_id text,
  p_client_name text default null,
  p_client_version text default null,
  p_platform text default null,
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.nuvio_devices (user_id, installation_id, client_name, client_version, platform, device_name, last_seen_at)
  values (auth.uid(), left(p_installation_id, 100), left(p_client_name, 80), left(p_client_version, 40),
          left(p_platform, 60), left(p_device_name, 120), now())
  on conflict (user_id, installation_id) do update set
    client_name = excluded.client_name,
    client_version = excluded.client_version,
    platform = excluded.platform,
    device_name = excluded.device_name,
    last_seen_at = now();
end;
$$;
revoke all on function public.register_current_device(text, text, text, text, text) from public, anon;
grant execute on function public.register_current_device(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Features not provided by this backend (yet): answer "off/empty" so the
-- app does not show errors.
-- ---------------------------------------------------------------------
create or replace function public.get_avatar_catalog()
returns setof jsonb
language sql
stable
as $$ select '{}'::jsonb where false; $$;
grant execute on function public.get_avatar_catalog() to anon, authenticated;

create or replace function public.watch_party_enabled()
returns boolean
language sql
stable
as $$ select false; $$;
grant execute on function public.watch_party_enabled() to anon, authenticated;
