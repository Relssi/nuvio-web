-- =====================================================================
-- Nuvio web backend - Stage 4: let the app read/write its tables
--
-- Run AFTER 03-general-vs-personal.sql, in Supabase > SQL Editor.
-- Safe to run more than once.
--
-- Some Supabase projects do not expose new tables to the API by default.
-- The app reads addons/plugins straight from their tables, so without
-- these grants friends' browsers got "permission denied" and never loaded
-- the shared addons (docs/BUGS.md B18). Row Level Security still applies:
-- each account only sees its own (household) rows.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.addons to authenticated;
grant select, insert, update, delete on table public.plugins to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;

-- Nobody signed out may touch them.
revoke all on table public.addons from anon;
revoke all on table public.plugins from anon;
revoke all on table public.profiles from anon;
