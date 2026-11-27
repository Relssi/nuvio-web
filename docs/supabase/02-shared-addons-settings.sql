-- =====================================================================
-- Nuvio web backend - Stage 2: shared addons, plugins, settings, debrid
--
-- Run AFTER 01-accounts-profiles.sql, in Supabase > SQL Editor.
-- Safe to run more than once.
--
-- In this build addons, plugins, settings and debrid/API keys are the same
-- for every profile ("general settings"). The app still sends the active
-- profile number; these functions ignore it and always use one shared copy
-- per account (stored under profile 1).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Addons
-- ---------------------------------------------------------------------
create table if not exists public.addons (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id integer not null default 1,
  url text not null check (length(url) <= 2000),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  name text,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, url)
);
alter table public.addons enable row level security;

drop policy if exists addons_owner_all on public.addons;
create policy addons_owner_all on public.addons
  for all to authenticated
  using (user_id = public.get_sync_owner())
  with check (user_id = public.get_sync_owner());

-- Rows written straight to the table (the app's fallback path) are also
-- stored as the shared list.
create or replace function public.nuvio_force_shared_profile()
returns trigger
language plpgsql
as $$
begin
  new.profile_id := 1;
  return new;
end;
$$;

drop trigger if exists addons_force_shared_profile on public.addons;
create trigger addons_force_shared_profile
  before insert or update on public.addons
  for each row execute function public.nuvio_force_shared_profile();

create or replace function public.sync_pull_addons(p_profile_id integer default 1)
returns setof public.addons
language sql
stable
security definer
set search_path = public
as $$
  select * from public.addons
  where user_id = public.get_sync_owner() and profile_id = 1
  order by sort_order;
$$;

create or replace function public.sync_push_addons(
  p_addons jsonb,
  p_profile_id integer default 1,
  p_origin_client_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_addons) <> 'array' then raise exception 'p_addons must be an array'; end if;
  if jsonb_array_length(p_addons) > 200 then raise exception 'Too many addons'; end if;

  delete from public.addons where user_id = v_owner and profile_id = 1;
  insert into public.addons (user_id, profile_id, url, sort_order, enabled, name, updated_at)
  select distinct on (e ->> 'url')
    v_owner,
    1,
    e ->> 'url',
    coalesce((e ->> 'sort_order')::integer, 0),
    coalesce((e ->> 'enabled')::boolean, true),
    nullif(left(e ->> 'name', 120), ''),
    now()
  from jsonb_array_elements(p_addons) e
  where coalesce(e ->> 'url', '') <> '';
end;
$$;

revoke all on function public.sync_pull_addons(integer) from public, anon;
revoke all on function public.sync_push_addons(jsonb, integer, text) from public, anon;
grant execute on function public.sync_pull_addons(integer) to authenticated;
grant execute on function public.sync_push_addons(jsonb, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Plugin repositories
-- ---------------------------------------------------------------------
create table if not exists public.plugins (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id integer not null default 1,
  url text not null check (length(url) <= 2000),
  name text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, url)
);
alter table public.plugins enable row level security;

drop policy if exists plugins_owner_all on public.plugins;
create policy plugins_owner_all on public.plugins
  for all to authenticated
  using (user_id = public.get_sync_owner())
  with check (user_id = public.get_sync_owner());

drop trigger if exists plugins_force_shared_profile on public.plugins;
create trigger plugins_force_shared_profile
  before insert or update on public.plugins
  for each row execute function public.nuvio_force_shared_profile();

create or replace function public.sync_push_plugins(
  p_plugins jsonb,
  p_profile_id integer default 1,
  p_origin_client_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_plugins) <> 'array' then raise exception 'p_plugins must be an array'; end if;
  if jsonb_array_length(p_plugins) > 100 then raise exception 'Too many plugin repositories'; end if;

  delete from public.plugins where user_id = v_owner and profile_id = 1;
  insert into public.plugins (user_id, profile_id, url, name, enabled, sort_order, updated_at)
  select distinct on (e ->> 'url')
    v_owner,
    1,
    e ->> 'url',
    nullif(left(e ->> 'name', 120), ''),
    coalesce((e ->> 'enabled')::boolean, true),
    coalesce((e ->> 'sort_order')::integer, 0),
    now()
  from jsonb_array_elements(p_plugins) e
  where coalesce(e ->> 'url', '') <> '';
end;
$$;
revoke all on function public.sync_push_plugins(jsonb, integer, text) from public, anon;
grant execute on function public.sync_push_plugins(jsonb, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Settings (theme, layout, player, catalogs, ...): one JSON document
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_profile_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'web',
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.nuvio_profile_settings enable row level security;
-- No policies: only the functions below read and write it.

create or replace function public.sync_pull_profile_settings_blob(
  p_profile_id integer default 1,
  p_platform text default 'web'
)
returns table (settings_json jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.settings_json, s.updated_at
  from public.nuvio_profile_settings s
  where s.user_id = public.get_sync_owner()
    and s.platform = coalesce(nullif(p_platform, ''), 'web');
$$;

create or replace function public.sync_push_profile_settings_blob(
  p_settings_json jsonb,
  p_profile_id integer default 1,
  p_platform text default 'web'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_settings_json) <> 'object' then raise exception 'p_settings_json must be an object'; end if;
  if pg_column_size(p_settings_json) > 2000000 then raise exception 'Settings too large'; end if;
  insert into public.nuvio_profile_settings (user_id, platform, settings_json, updated_at)
  values (v_owner, coalesce(nullif(p_platform, ''), 'web'), p_settings_json, now())
  on conflict (user_id, platform) do update
    set settings_json = excluded.settings_json, updated_at = now();
end;
$$;

revoke all on function public.sync_pull_profile_settings_blob(integer, text) from public, anon;
revoke all on function public.sync_push_profile_settings_blob(jsonb, integer, text) from public, anon;
grant execute on function public.sync_pull_profile_settings_blob(integer, text) to authenticated;
grant execute on function public.sync_push_profile_settings_blob(jsonb, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Provider credentials (TorBox / Real-Debrid / Premiumize, MDBList, ...)
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_provider_credentials (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (length(provider) <= 80),
  credential_json jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.nuvio_provider_credentials enable row level security;
-- No policies: only the functions below read and write it.

create or replace function public.sync_pull_provider_credentials(p_profile_id integer default 1)
returns table (provider text, credential_json jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.provider, c.credential_json, c.updated_at
  from public.nuvio_provider_credentials c
  where c.user_id = public.get_sync_owner()
  order by c.provider;
$$;

-- Replaces the shared credentials with the ones sent. An entry whose
-- credential_json is null or empty removes that provider.
create or replace function public.sync_push_provider_credentials(
  p_credentials jsonb,
  p_profile_id integer default 1,
  p_origin_client_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
  v_entry jsonb;
  v_json jsonb;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_credentials) <> 'array' then raise exception 'p_credentials must be an array'; end if;
  for v_entry in select * from jsonb_array_elements(p_credentials) loop
    v_json := case
      when jsonb_typeof(v_entry -> 'credential_json') = 'string'
        then (v_entry ->> 'credential_json')::jsonb
      else v_entry -> 'credential_json'
    end;
    if v_json is null or v_json = 'null'::jsonb or v_json = '{}'::jsonb then
      delete from public.nuvio_provider_credentials
      where user_id = v_owner and provider = v_entry ->> 'provider';
    else
      insert into public.nuvio_provider_credentials (user_id, provider, credential_json, updated_at)
      values (v_owner, v_entry ->> 'provider', v_json, now())
      on conflict (user_id, provider) do update
        set credential_json = excluded.credential_json, updated_at = now();
    end if;
  end loop;
end;
$$;

-- First upload from a device: only fills providers the cloud does not have.
create or replace function public.sync_seed_provider_credentials(
  p_credentials jsonb,
  p_profile_id integer default 1,
  p_origin_client_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
  v_entry jsonb;
  v_json jsonb;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_credentials) <> 'array' then raise exception 'p_credentials must be an array'; end if;
  for v_entry in select * from jsonb_array_elements(p_credentials) loop
    v_json := case
      when jsonb_typeof(v_entry -> 'credential_json') = 'string'
        then (v_entry ->> 'credential_json')::jsonb
      else v_entry -> 'credential_json'
    end;
    if v_json is not null and v_json <> 'null'::jsonb and v_json <> '{}'::jsonb then
      insert into public.nuvio_provider_credentials (user_id, provider, credential_json, updated_at)
      values (v_owner, v_entry ->> 'provider', v_json, now())
      on conflict (user_id, provider) do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_pull_provider_credentials(integer) from public, anon;
revoke all on function public.sync_push_provider_credentials(jsonb, integer, text) from public, anon;
revoke all on function public.sync_seed_provider_credentials(jsonb, integer, text) from public, anon;
grant execute on function public.sync_pull_provider_credentials(integer) to authenticated;
grant execute on function public.sync_push_provider_credentials(jsonb, integer, text) to authenticated;
grant execute on function public.sync_seed_provider_credentials(jsonb, integer, text) to authenticated;
