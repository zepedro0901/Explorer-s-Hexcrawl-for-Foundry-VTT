/**
 * One-off upgrades for worlds that used an earlier version of the module.
 * Runs on the responsible GM's client when the world loads.
 */
import { MOD } from "./constants.js";
import * as R from "./rules.js";
import { get, set } from "./settings.js";

export const SCHEMA_VERSION = 3;

const OLD_DRIZZLE = "explorers-hexcrawl-drizzle";

/** v2: seven kinds of weather became four, and temperature and navigation went away. */
async function toFourKinds() {
  const stored = foundry.utils.deepClone(get("state") ?? {});
  const mapStep = s => R.LEGACY_STEPS[Math.round(Number(s))] ?? 2;
  if (stored.weather) stored.weather.step = mapStep(stored.weather.step);
  if (stored.forecast) stored.forecast.step = mapStep(stored.forecast.step);
  delete stored.fog; // fog and mist are gone
  delete stored.aftermath;
  stored.travel = { day: stored.day ?? 1, hours: 0 };
  delete stored.lastMove;
  await set("state", stored);

  for (const scene of game.scenes ?? []) {
    const f = scene.flags?.[MOD];
    if (!f?.enabled) continue;
    const updates = {};
    // Landmarks the party had already seen count as discovered, so they aren't announced again.
    if (!Array.isArray(f.discovered)) {
      const seen = new Set([...(f.visible ?? []), ...(f.revealed ?? [])]);
      updates[`flags.${MOD}.discovered`] = (f.landmarks ?? []).map(l => l?.key).filter(k => k && seen.has(k)).sort();
    }
    if (scene.weather === OLD_DRIZZLE) updates.weather = "rain";
    if (!foundry.utils.isEmpty(updates)) await scene.update(updates);
  }
}

/** v3: landmarks became points of interest and viewing points, seen from a set number of hexes. */
async function toPointsOfInterest() {
  for (const scene of game.scenes ?? []) {
    const list = scene.flags?.[MOD]?.landmarks;
    if (!Array.isArray(list) || !list.some(l => l && !("kind" in l))) continue;
    const next = list.map(l => {
      if (!l || "kind" in l) return l;
      const { range, peak, ...rest } = l;
      return { ...rest, kind: "poi", sight: R.sightFromOldRange(range), view: null };
    });
    await scene.update({ [`flags.${MOD}.landmarks`]: next });
  }
}

export async function migrate() {
  const from = Number(get("schemaVersion")) || 0;
  if (from >= SCHEMA_VERSION) return false;

  // v1 fixed an old sight setting; sight no longer depends on the weather, so there's nothing left to do.
  if (from < 2) await toFourKinds();
  if (from < 3) await toPointsOfInterest();

  await set("schemaVersion", SCHEMA_VERSION);
  return true;
}
