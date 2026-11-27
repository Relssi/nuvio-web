// Addons, plugins and settings are shared by every profile in this build:
// they are always read from and written to the primary profile ("1").
// Per-person data (watch progress, continue watching, library, search
// history, avatars) stays per profile and does not go through this.

export const SHARED_PROFILE_ID = "1";

export function sharedProfileId() {
  return SHARED_PROFILE_ID;
}
