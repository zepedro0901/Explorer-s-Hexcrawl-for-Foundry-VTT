import { MOD } from "./constants.js";
import * as R from "./rules.js";
import * as C from "./clock.js";
import { get } from "./settings.js";
import { getState, clock, isResponsibleGM } from "./state.js";
import { computeVisibility, hexKey, parseHexKey } from "./visibility.js";
import * as Chat from "./chat.js";

/** Scenes that have been turned into hexcrawl maps. */
export function hexcrawlScenes() {
  return game.scenes.filter(s => s.getFlag(MOD, "enabled"));
}

export function isPartyToken(scene, tokenDoc) {
  if (!scene || !tokenDoc) return false;
  return !!scene.getFlag(MOD, "enabled") && scene.getFlag(MOD, "partyToken") === tokenDoc.id;
}

/** Offset bounds that cover the scene, with a one-hex margin. */
export function sceneBounds(scene) {
  const [i0, j0, i1, j1] = scene.grid.getOffsetRange(scene.dimensions.sceneRect);
  return { i0: i0 - 1, j0: j0 - 1, i1: i1 + 1, j1: j1 + 1 };
}

function centerOf(grid, pos, doc) {
  const w = (pos.width ?? doc?.width ?? 1) * (grid.sizeX ?? grid.size);
  const h = (pos.height ?? doc?.height ?? 1) * (grid.sizeY ?? grid.size);
  return { x: pos.x + w / 2, y: pos.y + h / 2 };
}

/** The token position (top-left corner) that puts a token of this size in a hex. */
export function positionInHex(grid, offset, doc) {
  const size1 = (doc?.width ?? 1) === 1 && (doc?.height ?? 1) === 1;
  if (size1 && typeof grid.getTopLeftPoint === "function") {
    const p = grid.getTopLeftPoint(offset);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }
  const c = grid.getCenterPoint(offset);
  const w = (doc?.width ?? 1) * (grid.sizeX ?? grid.size);
  const h = (doc?.height ?? 1) * (grid.sizeY ?? grid.size);
  return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
}

/** The hex a token (or a token position) is in. */
export function tokenOffset(grid, pos, doc = pos) {
  const o = grid.getOffset(centerOf(grid, pos, doc));
  return { i: o.i, j: o.j };
}

/** Every hex a token passed through during one movement. */
export function pathFromMovement(scene, doc, movement) {
  if (!movement) return [];
  return pathFromPositions(scene, doc, [movement.origin, ...(movement.passed?.waypoints ?? [])]);
}

/** Every hex on the way through a list of token positions (the first is where it starts). */
export function pathFromPositions(scene, doc, positions) {
  const grid = scene?.grid;
  if (!grid?.isHexagonal) return [];
  const points = (positions ?? [])
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(-200)
    .map(p => centerOf(grid, p, doc));
  if (points.length < 2) return points.map(p => tokenOffsetOfPoint(grid, p));
  try {
    return grid.getDirectPath(points).map(o => ({ i: o.i, j: o.j }));
  } catch (err) {
    console.warn(`${MOD} | Could not trace the movement path`, err);
    return points.map(p => tokenOffsetOfPoint(grid, p));
  }
}

function tokenOffsetOfPoint(grid, p) {
  const o = grid.getOffset(p);
  return { i: o.i, j: o.j };
}

/** Landmarks with their numbers checked, and how far away each can be spotted. */
export function normalizeLandmarks(list) {
  return (Array.isArray(list) ? list : [])
    .filter(l => l && typeof l.key === "string")
    .map(l => {
      const n = R.normalizeLandmark(l);
      return { ...n, reach: R.landmarkReach(n) };
    });
}

/** Landmarks the party has just spotted, nearest first, with where they lie from the party. */
function spottedReport(grid, landmarks, fresh) {
  const byKey = new Map((landmarks ?? []).map(l => [l.key, l]));
  return [...fresh]
    .map(([key, seen]) => {
      const l = byKey.get(key);
      const direction = seen.distance > 0
        ? R.compassDirection(grid.getCenterPoint(seen.from), grid.getCenterPoint(parseHexKey(key)))
        : "";
      return { key, name: l?.name || "A landmark", icon: l?.icon || "", distance: seen.distance, direction };
    })
    .sort((a, b) => a.distance - b.distance);
}

function sameList(a, b) {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* Landmarks being written as discovered right now (scene id:key). */
const announcing = new Set();

/* Work on one scene's flags one job at a time, so a refresh never writes over an undo.
   Jobs here never wait on the engine's queue (the engine waits on these), so they can't deadlock. */
const chains = new Map();
function serial(key, fn) {
  const run = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
  chains.set(key, run.catch(err => console.error(`${MOD} |`, err)));
  return run;
}

/**
 * Recompute what the party can see on one hexcrawl scene and store it in the scene's flags.
 * @param {Scene} scene
 */
export function refreshScene(scene) {
  if (!isResponsibleGM() || !scene) return Promise.resolve();
  return serial(scene.id, () => doRefresh(scene));
}

/* ------------------------------------------------------------------ */
/*  The party's moves, remembered so Ctrl+Z can take them back          */
/* ------------------------------------------------------------------ */

/** How many of the party's moves are remembered for undo (Ctrl+Z). */
const MOVE_MEMORY = 20;

/** The move log of each scene, kept in memory by the responsible GM and saved in the scene's flags. */
const moveLogs = new Map();

function moveLog(scene) {
  if (!moveLogs.has(scene.id)) {
    const saved = scene.flags?.[MOD]?.moves;
    moveLogs.set(scene.id, (Array.isArray(saved) ? saved : []).filter(r => r?.token).map(r => ({
      id: r.id, token: r.token, start: r.start, end: r.end,
      revealed: [...(r.revealed ?? [])], discovered: [...(r.discovered ?? [])], messages: [...(r.messages ?? [])]
    })));
  }
  return moveLogs.get(scene.id);
}

const savedLog = scene => moveLog(scene).map(({ id, token, start, end, revealed, discovered, messages }) =>
  ({ id, token, start, end, revealed: [...revealed], discovered: [...discovered], messages: [...messages] }));

/** Forget a scene's move log (when its explored hexes are reset). */
export function clearMoveLog(scene) {
  moveLogs.set(scene.id, []);
}

/**
 * The party token has moved: note the move, and reveal what it saw on the way.
 * Called from the moveToken hook, in the order the moves happen.
 * @param {Scene} scene
 * @param {TokenDocument} tokenDoc
 * @param {{i:number,j:number}[]} path   Every hex passed, starting where the move began
 * @param {string} id                    The movement's id
 */
export function partyMoved(scene, tokenDoc, path, id) {
  if (!isResponsibleGM() || !scene?.grid?.isHexagonal) return null;
  const here = tokenOffset(scene.grid, tokenDoc);
  const record = { id, token: tokenDoc.id, start: hexKey(path[0] ?? here), end: hexKey(here),
    revealed: [], discovered: [], messages: [] };
  const log = moveLog(scene);
  log.push(record);
  if (log.length > MOVE_MEMORY) log.splice(0, log.length - MOVE_MEMORY);
  serial(scene.id, () => doRefresh(scene, { path, record, at: here }));
  return record;
}

/**
 * The party's move was undone (Ctrl+Z). Foundry may take the token back over more than one move,
 * so moves are taken back, newest first, until one that started where the token now stands.
 * @returns {string[]}  The ids of the moves taken back (to give their travel time back)
 */
export function partyUndone(scene, tokenDoc) {
  if (!isResponsibleGM() || !scene?.grid?.isHexagonal) return [];
  const here = hexKey(tokenOffset(scene.grid, tokenDoc));
  const log = moveLog(scene);
  const mine = log.filter(r => r.token === tokenDoc.id);
  let undone = [];
  for (let i = mine.length - 1; i >= 0; i--) {
    undone.push(mine[i]);
    if (mine[i].start === here) break;
  }
  if (!undone.some(r => r.start === here)) undone = undone.slice(0, 1); // no match: just the last move
  for (const r of undone) log.splice(log.indexOf(r), 1);
  serial(scene.id, () => doUndo(scene, undone));
  return undone.map(r => r.id);
}

/**
 * @param {Scene} scene
 * @param {object} [options]
 * @param {{i:number,j:number}[]} [options.path]  Hexes passed through on the way to the current hex
 * @param {object} [options.record]    The move this refresh is for: what it reveals is noted on it
 * @param {boolean} [options.announce] Post landmarks and views to chat
 * @param {{i:number,j:number}} [options.at]  Where the move ended (by the time this runs the token
 *                                            may have moved on again)
 */
async function doRefresh(scene, { path = [], record = null, announce = true, at = null } = {}) {
  const f = scene.flags?.[MOD] ?? {};
  if (!f.enabled) return;
  const grid = scene.grid;
  if (!grid?.isHexagonal) return;
  const added = { revealed: [], discovered: [] };

  const updates = {};
  let fresh = [];
  let newViews = [];
  const token = f.partyToken ? scene.tokens.get(f.partyToken) : null;
  if (token) {
    const current = at ?? tokenOffset(grid, token);
    const landmarks = normalizeLandmarks(f.landmarks);
    const viewpoints = new Map(landmarks.filter(l => l.kind === "viewpoint").map(l => [l.key, l.view]));
    const { visible, passed, spotted, views } = computeVisibility(grid, [...path, current], sceneBounds(scene), {
      sight: R.PARTY_SIGHT, landmarks, viewpoints
    });
    const vis = [...visible].sort();
    if (!sameList(vis, f.visible)) updates[`flags.${MOD}.visible`] = vis;
    if (get("keepExplored")) {
      const revealed = new Set(f.revealed ?? []);
      const before = revealed.size;
      for (const k of passed) {
        if (revealed.has(k)) continue;
        revealed.add(k);
        added.revealed.push(k);
      }
      if (revealed.size !== before) updates[`flags.${MOD}.revealed`] = [...revealed].sort();
    }
    // Landmarks, once spotted, stay discovered: their icon and name stay on the map.
    const discovered = new Set(f.discovered ?? []);
    for (const l of landmarks) if (l.known) discovered.add(l.key); // known from the start: nothing to announce
    fresh = [...spotted].filter(([k]) => !discovered.has(k) && !announcing.has(`${scene.id}:${k}`));
    for (const [k] of fresh) announcing.add(`${scene.id}:${k}`); // two refreshes at once announce it once
    added.discovered = fresh.map(([k]) => k);
    if (fresh.length || !Array.isArray(f.discovered)) {
      updates[`flags.${MOD}.discovered`] = [...new Set([...(f.discovered ?? []), ...fresh.map(([k]) => k)])].sort();
    }
    // A viewing point is announced when the party arrives, not while it stands there.
    newViews = views.filter(k => k !== f.partyHex).map(k => ({ key: k, view: viewpoints.get(k) }));
    const partyHex = hexKey(current);
    if (partyHex !== f.partyHex) updates[`flags.${MOD}.partyHex`] = partyHex;
  }
  else if (f.visible?.length) updates[`flags.${MOD}.visible`] = [];

  try {
    if ((fresh.length || newViews.length) && announce && get("mode") && get("announce")) {
      const names = new Map((f.landmarks ?? []).map(l => [l.key, l.name || "A viewing point"]));
      const msg = await Chat.postDiscoveryCard({
        views: newViews.map(v => ({ ...v, name: names.get(v.key) })),
        landmarks: spottedReport(grid, f.landmarks, fresh)
      });
      if (msg?.id && record) record.messages.push(msg.id);
    }
    if (record) {
      // Remember what this move revealed, so Ctrl+Z can cover it again.
      record.revealed.push(...added.revealed);
      record.discovered.push(...added.discovered);
      updates[`flags.${MOD}.moves`] = savedLog(scene);
    }
    if (!foundry.utils.isEmpty(updates)) await scene.update(updates);
  }
  finally {
    for (const [k] of fresh) announcing.delete(`${scene.id}:${k}`);
  }
}

/**
 * Take back undone moves: cover the hexes they revealed again, forget the landmarks they found
 * (and delete their chat cards), then look around from where the party now stands, quietly.
 */
async function doUndo(scene, records) {
  const f = scene.flags?.[MOD] ?? {};
  const revealed = new Set(records.flatMap(r => r.revealed ?? []));
  const discovered = new Set(records.flatMap(r => r.discovered ?? []));
  const updates = { [`flags.${MOD}.moves`]: savedLog(scene) };
  if (revealed.size) updates[`flags.${MOD}.revealed`] = (f.revealed ?? []).filter(k => !revealed.has(k));
  if (discovered.size) updates[`flags.${MOD}.discovered`] = (f.discovered ?? []).filter(k => !discovered.has(k));
  const token = f.partyToken ? scene.tokens.get(f.partyToken) : null;
  if (token) updates[`flags.${MOD}.partyHex`] = hexKey(tokenOffset(scene.grid, token)); // back where it was: no "arrival"
  await scene.update(updates);
  for (const id of records.flatMap(r => r.messages ?? [])) {
    try { await game.messages?.get(id)?.delete(); }
    catch (err) { console.warn(`${MOD} | Could not delete a landmark message`, err); }
  }
  await doRefresh(scene, { announce: false });
}

/* Other changes (a landmark edited, a hex revealed by hand) come in bursts; refresh once. */
const pending = new Map();

export function queueRefresh(scene) {
  if (!scene || !isResponsibleGM()) return;
  clearTimeout(pending.get(scene.id));
  pending.set(scene.id, setTimeout(() => {
    pending.delete(scene.id);
    refreshScene(scene).catch(err => console.error(`${MOD} | Visibility update failed`, err));
  }, 150));
}

/** Darkness and the built-in weather effect for one hexcrawl scene. */
export async function applyEnvironment(scene) {
  if (!isResponsibleGM() || !scene?.getFlag(MOD, "enabled")) return;
  const state = getState();
  const phase = C.phaseAt(game.time.worldTime, clock());
  const updates = {};
  if (get("controlDarkness") && !scene.environment?.darknessLevelLock) {
    const dl = R.darknessFor(phase, get("nightDarkness"));
    if (Math.abs((scene.environment?.darknessLevel ?? 0) - dl) > 0.005) updates["environment.darknessLevel"] = dl;
  }
  if (get("weatherEffects")) {
    let effect = R.sceneWeatherFor(state.weather.step, { season: get("season"), region: get("region") });
    if (effect && !CONFIG.weatherEffects?.[effect]) effect = "";
    if ((scene.weather ?? "") !== effect) updates.weather = effect;
  }
  if (!foundry.utils.isEmpty(updates)) await scene.update(updates);
}

/** Give every hexcrawl map full daylight again (when the GM turns darkness control off). */
export async function resetDarkness() {
  if (!isResponsibleGM()) return;
  for (const scene of hexcrawlScenes()) {
    if (scene.environment?.darknessLevelLock) continue;
    if ((scene.environment?.darknessLevel ?? 0) !== 0) await scene.update({ "environment.darknessLevel": 0 });
  }
}

export async function syncAllScenes({ visibility = true, environment = true } = {}) {
  if (!isResponsibleGM()) return;
  for (const scene of hexcrawlScenes()) {
    try {
      if (visibility) await refreshScene(scene);
      if (environment && get("mode")) await applyEnvironment(scene);
    }
    catch (err) {
      console.error(`${MOD} | Could not update scene "${scene.name}"`, err);
    }
  }
}
