-- =====================================================================
-- Nuvio web backend - Stage 3: general settings (primary profile) vs
-- personal settings (each profile)
--
-- Run AFTER 02-shared-addons-settings.sql, in Supabase > SQL Editor.
-- Safe to run more than once.
--
-- GENERAL = streaming and connections: TMDB, MDBList, AnimeSkip, stream
--   badges, debrid (TorBox...), plugins; plus addons and debrid/API keys.
--   One copy, taken from profile 1 (the primary profile). Only profile 1
--   can change it.
-- PERSONAL = theme, layout, ambient mode, experience mode, player
--   (subtitles/audio), trailers, Trakt, track preferences. One copy per
--   profile.
--
-- The list below must match GENERAL_SETTINGS_FEATURES in
-- js/core/profile/sharedProfileData.js.
-- =====================================================================

create or replace function public.nuvio_general_features()
returns text[]
language sql
immutable
as $$
  select array[
    'tmdb_settings',
    'mdblist_settings',
    'animeskip_settings',
    'stream_badge_settings',
    'debrid_settings',
    'plugin_settings'
  ];
$$;

-- ---------------------------------------------------------------------
-- Settings documents, now per profile
-- ---------------------------------------------------------------------
create table if not exists public.nuvio_settings_blobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id integer not null,
  platform text not null default 'web',
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, platform)
);
alter table public.nuvio_settings_blobs enable row level security;
-- No policies: only the functions below read and write it.

-- Bring over the single shared document from stage 2 as the primary
-- profile's document.
do $$
begin
  if to_regclass('public.nuvio_profile_settings') is not null then
    insert into public.nuvio_settings_blobs (user_id, profile_id, platform, settings_json, updated_at)
    select user_id, 1, platform, settings_json, updated_at
    from public.nuvio_profile_settings
    on conflict (user_id, profile_id, platform) do nothing;
  end if;
end;
$$;

-- Keeps only the features whose name is (or is not) general.
create or replace function public.nuvio_filter_features(p_features jsonb, p_general boolean)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(e.key, e.value)
      filter (where (e.key = any (public.nuvio_general_features())) = p_general),
    '{}'::jsonb
  )
  from jsonb_each(case when jsonb_typeof(p_features) = 'object' then p_features else '{}'::jsonb end) e;
$$;

drop function if exists public.sync_pull_profile_settings_blob(integer, text);
create or replace function public.sync_pull_profile_settings_blob(
  p_profile_id integer default 1,
  p_platform text default 'web'
)
returns table (settings_json jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.get_sync_owner();
  v_platform text := coalesce(nullif(p_platform, ''), 'web');
  v_profile integer := greatest(coalesce(p_profile_id, 1), 1);
  v_primary public.nuvio_settings_blobs;
  v_own public.nuvio_settings_blobs;
  v_base jsonb;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  select * into v_primary from public.nuvio_settings_blobs b
  where b.user_id = v_owner and b.profile_id = 1 and b.platform = v_platform;
  if v_profile = 1 then
    if v_primary.user_id is null then return; end if;
    return query select v_primary.settings_json, v_primary.updated_at;
    return;
  end if;

  select * into v_own from public.nuvio_settings_blobs b
  where b.user_id = v_owner and b.profile_id = v_profile and b.platform = v_platform;
  if v_primary.user_id is null and v_own.user_id is null then return; end if;

  v_base := coalesce(v_own.settings_json, v_primary.settings_json, '{}'::jsonb);
  return query select
    v_base || jsonb_build_object(
      'features',
      public.nuvio_filter_features(v_own.settings_json -> 'features', false)
        || public.nuvio_filter_features(v_primary.settings_json -> 'features', true)
    ),
    greatest(v_own.updated_at, v_primary.updated_at);
end;
$$;

drop function if exists public.sync_push_profile_settings_blob(jsonb, integer, text);
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
  v_platform text := coalesce(nullif(p_platform, ''), 'web');
  v_profile integer := greatest(coalesce(p_profile_id, 1), 1);
  v_document jsonb := p_settings_json;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_settings_json) <> 'object' then raise exception 'p_settings_json must be an object'; end if;
  if pg_column_size(p_settings_json) > 2000000 then raise exception 'Settings too large'; end if;
  -- Other profiles cannot change general settings: keep only their personal part.
  if v_profile <> 1 then
    v_document := p_settings_json || jsonb_build_object(
      'features', public.nuvio_filter_features(p_settings_json -> 'features', false)
    );
  end if;
  insert into public.nuvio_settings_blobs (user_id, profile_id, platform, settings_json, updated_at)
  values (v_owner, v_profile, v_platform, v_document, now())
  on conflict (user_id, profile_id, platform) do update
    set settings_json = excluded.settings_json, updated_at = now();
end;
$$;

revoke all on function public.sync_pull_profile_settings_blob(integer, text) from public, anon;
revoke all on function public.sync_push_profile_settings_blob(jsonb, integer, text) from public, anon;
grant execute on function public.sync_pull_profile_settings_blob(integer, text) to authenticated;
grant execute on function public.sync_push_profile_settings_blob(jsonb, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Debrid / API keys: only the primary profile may change them.
-- (Everybody can read them: pull is unchanged from stage 2.)
-- ---------------------------------------------------------------------
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
  if coalesce(p_profile_id, 1) <> 1 then return; end if;
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
  if coalesce(p_profile_id, 1) <> 1 then return; end if;
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

revoke all on function public.sync_push_provider_credentials(jsonb, integer, text) from public, anon;
revoke all on function public.sync_seed_provider_credentials(jsonb, integer, text) from public, anon;
grant execute on function public.sync_push_provider_credentials(jsonb, integer, text) to authenticated;
grant execute on function public.sync_seed_provider_credentials(jsonb, integer, text) to authenticated;
