// General vs personal settings (js/core/profile/sharedProfileData.js).
//
// General settings (e.g. debridSettings) are one copy on the primary profile
// for everybody; personal settings (e.g. themeSettings) stay per profile.
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
  setItem: (key, value) => storage.set(String(key), String(value)),
  removeItem: (key) => storage.delete(String(key)),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  }
};

const { createProfileScopedStore } = await import("../js/data/local/profileScopedStore.js");
const shared = await import("../js/core/profile/sharedProfileData.js");

const normalize = (value = {}) => ({ value: String(value?.value || "default") });
const general = createProfileScopedStore({ key: "debridSettings", normalize });
const personal = createProfileScopedStore({ key: "themeSettings", normalize });
const setActiveProfile = (id) => localStorage.setItem("activeProfileId", JSON.stringify(id));

test("general settings are one copy shared by every profile", () => {
  storage.clear();
  general.setForProfile("1", { value: "torbox-on" }, { silentSync: true });
  assert.equal(general.getForProfile("2").value, "torbox-on");
  assert.equal(general.getForProfile("5").value, "torbox-on");
  const envelope = JSON.parse(storage.get("debridSettings"));
  assert.deepEqual(Object.keys(envelope.profiles), ["1"], "only the primary copy is stored");
});

test("personal settings stay per profile", () => {
  storage.clear();
  personal.setForProfile("1", { value: "dark" }, { silentSync: true });
  personal.setForProfile("2", { value: "light" }, { silentSync: true });
  assert.equal(personal.getForProfile("1").value, "dark");
  assert.equal(personal.getForProfile("2").value, "light");
});

test("removing a secondary profile never clears the general copy", () => {
  storage.clear();
  general.setForProfile("1", { value: "keep" }, { silentSync: true });
  general.clearProfile("2", { silentSync: true });
  assert.equal(general.getForProfile("1").value, "keep");
});

test("only the primary profile manages general settings", () => {
  storage.clear();
  setActiveProfile("1");
  assert.equal(shared.isPrimaryProfileActive(), true);
  setActiveProfile("2");
  assert.equal(shared.isPrimaryProfileActive(), false);
  storage.delete("activeProfileId");
  assert.equal(shared.isPrimaryProfileActive(), true, "no active profile means the primary");
});

test("classification matches the stage 3 SQL", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../docs/supabase/03-general-vs-personal.sql", import.meta.url),
    "utf8"
  );
  const block = sql.slice(
    sql.indexOf("select array["),
    sql.indexOf("];", sql.indexOf("select array["))
  );
  const sqlFeatures = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(sqlFeatures, [...shared.GENERAL_SETTINGS_FEATURES].sort());
});
