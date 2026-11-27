// General vs personal settings in this build.
//
// GENERAL (streaming, connections, catalogs): one copy for everybody, kept on
// the primary profile ("1"). Only the primary profile may change it; every
// other profile uses it read-only.
//   - addons (addonRepository), plugin repositories (pluginStore)
//   - the profile-scoped stores listed in GENERAL_SETTINGS_KEYS
//   - the cloud settings features listed in GENERAL_SETTINGS_FEATURES
//
// PERSONAL: each profile keeps its own (theme, layout, ambient mode,
// experience mode, player/subtitles/audio, trailers, Trakt, track
// preferences), plus watch progress, library and search history.

import { LocalStore } from "../storage/localStore.js";

export const SHARED_PROFILE_ID = "1";

// Profile-scoped localStorage keys (createProfileScopedStore) that are general.
export const GENERAL_SETTINGS_KEYS = new Set([
  "debridSettings",
  "torrentSettings",
  "tmdbSettings",
  "mdbListSettings",
  "animeSkipSettings",
  "streamBadgeSettings",
  "homeCatalogPrefs",
  "collectionsState",
  "mediaServerConnections",
  "pluginState"
]);

// Feature names inside the cloud settings document that are general. Must
// match docs/supabase/03-general-vs-personal.sql.
export const GENERAL_SETTINGS_FEATURES = [
  "tmdb_settings",
  "mdblist_settings",
  "animeskip_settings",
  "stream_badge_settings",
  "debrid_settings",
  "plugin_settings"
];

export function sharedProfileId() {
  return SHARED_PROFILE_ID;
}

export function isGeneralSettingsKey(key) {
  return GENERAL_SETTINGS_KEYS.has(String(key || ""));
}

export function activeProfileId() {
  const raw = LocalStore.get("activeProfileId", null);
  return raw == null ? SHARED_PROFILE_ID : String(raw);
}

// The primary profile manages the general settings.
export function isPrimaryProfileActive() {
  return activeProfileId() === SHARED_PROFILE_ID;
}
