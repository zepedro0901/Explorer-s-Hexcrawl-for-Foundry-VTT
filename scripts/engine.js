/**
 * The hexcrawl clock: turns world time into dawns and nightfalls, rolls the weather,
 * spends travel time when the party moves, and keeps the scenes in step.
 * Only the responsible GM client runs any of this.
 */
import { MOD } from "./constants.js";
import * as R from "./rules.js";
import * as C from "./clock.js";
import { get } from "./settings.js";
import { getState, saveState, clock, conditions, travelSettings, isResponsibleGM, rng } from "./state.js";
import { syncAllScenes } from "./sync.js";
import * as Chat from "./chat.js";

/* Run state changes one at a time so overlapping time updates can't clobber each other. */
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(err => console.error(`${MOD} |`, err));
  return run;
}

/** Nightfall: the end of the day. Roll tomorrow's weather now so the GM knows what's coming. */
function nightfall(state, time, random, region) {
  if (!state.forecast) state.forecast = R.nextWeather(state.weather, random, region);
  return { type: "nightfall", time, day: state.day, weather: { ...state.weather }, forecast: { ...state.forecast } };
}

/** Dawn: tomorrow's weather arrives, and a new day of travel begins. */
function dawn(state, time, random, region) {
  const prev = { ...state.weather };
  const next = state.forecast ?? R.nextWeather(prev, random, region);
  state.forecast = null;
  state.weather = { step: next.step, trend: next.trend };
  state.day = (state.day || 0) + 1;
  state.travel = { day: state.day, hours: 0, moves: [] };
  state.presetWeather = false;
  return { type: "dawn", time, day: state.day, prev, next };
}

async function initialize(worldTime) {
  const state = getState();
  if (!state.presetWeather) {
    const start = R.startingWeather(rng());
    state.weather = { step: start.step, trend: start.trend };
  }
  Object.assign(state, { initialized: true, day: 1, lastTime: worldTime, forecast: null,
    travel: { day: 1, hours: 0, moves: [] }, presetWeather: false });
  await saveState(state);
  if (get("announce")) await Chat.postStartCard(state, conditions(state));
  await syncAllScenes({ visibility: true, environment: true });
}

/** Process everything that happened between the last processed time and `worldTime`. */
async function advanceTo(worldTime) {
  const state = getState();
  if (!state.initialized) return initialize(worldTime);
  const c = clock();
  const t0 = Number.isFinite(state.lastTime) ? state.lastTime : worldTime;
  const phaseBefore = C.phaseAt(t0, c);
  const random = rng();
  const region = get("region");

  let lastDawn = null;
  let lastNight = null;
  let dawns = 0;

  for (const ev of C.eventsBetween(t0, worldTime, c)) {
    if (ev.type === "nightfall") lastNight = nightfall(state, ev.time, random, region);
    else {
      lastDawn = dawn(state, ev.time, random, region);
      dawns++;
    }
  }
  state.lastTime = worldTime;
  await saveState(state);

  if (get("announce")) {
    const cond = conditions(state);
    if (lastDawn) await Chat.postDawnCard(lastDawn, state, cond, { skipped: dawns - 1 });
    if (lastNight && (!lastDawn || lastNight.time > lastDawn.time)) await Chat.postNightfallCard(lastNight);
  }

  const phaseAfter = C.phaseAt(worldTime, c);
  if (dawns) await syncAllScenes({ visibility: true, environment: true });
  else if (phaseAfter !== phaseBefore) await syncAllScenes({ visibility: false, environment: true });
}

/* -------------------------------------------- */
/*  Travel                                      */
/* -------------------------------------------- */

/** How many of today's moves can have their time given back by Ctrl+Z. */
const TRAVEL_MEMORY = 20;
const COUNTED_MEMORY = 50;

/**
 * Spend the hours a party move took, and move the clock on by that much.
 * @param {object} move  { id, approved }: the movement's id, and whether the GM allowed it past the limit
 */
async function spendTravel(scene, tokenDoc, path, { id, approved = false } = {}) {
  const state = getState();
  if (!state.initialized) return;
  // Clients count a move they let through until they see its id here (see travel.js).
  state.counted = [...state.counted, id].slice(-COUNTED_MEMORY);
  const t = travelSettings();
  const rough = new Set(scene.getFlag(MOD, "rough") ?? []);
  const cost = R.moveCost(path, rough, state.weather.step, t);
  if (!cost.hexes || !(cost.hours > 0)) return saveState(state);

  const c = clock();
  const from = game.time.worldTime;
  const before = state.travel.hours;
  const left = R.hoursAvailable(before, t.day, C.hoursToNightfall(from, c), C.phaseAt(from, c) === "night");
  state.travel.hours = before + cost.hours;
  const seconds = Math.round(cost.hours * c.secondsPerHour);
  const move = { id, hours: cost.hours, from, to: from + seconds, messages: [] };
  if (get("announce") && before < t.day && state.travel.hours >= t.day) {
    const msg = await Chat.postTravelDayCard(state.travel.hours);
    if (msg?.id) move.messages.push(msg.id);
  }
  // A move the GM didn't approve that still went past the limit (two quick moves, say): tell the GM.
  if (!approved && cost.hours > left.hours + 1e-9) await Chat.postOverLimitCard(cost.hours, left);
  state.travel.moves = [...state.travel.moves, move].slice(-TRAVEL_MEMORY);
  await saveState(state);
  await game.time.advance(seconds);
}

/**
 * Give back the travel time of undone moves (Ctrl+Z): their hours come off today's count, and the
 * clock turns back as long as nothing else has moved it since.
 * @param {string[]} ids  The undone moves, newest first
 */
export function undoTravel(ids) {
  if (!isResponsibleGM() || !ids?.length) return;
  return exclusive(async () => {
    const state = getState();
    let time = game.time.worldTime;
    const messages = [];
    for (const id of ids) {
      const i = state.travel.moves.findIndex(m => m.id === id);
      if (i < 0) continue; // spent no time, or on an earlier day
      const [move] = state.travel.moves.splice(i, 1);
      state.travel.hours = Math.max(0, state.travel.hours - move.hours);
      messages.push(...(move.messages ?? []));
      if (time === move.to) time = move.from;
    }
    await saveState(state);
    for (const id of messages) {
      try { await game.messages?.get(id)?.delete(); }
      catch { /* already gone */ }
    }
    if (time !== game.time.worldTime) await game.time.advance(time - game.time.worldTime);
  });
}

/**
 * Called when the party token moves (from the moveToken hook).
 * @param {Scene} scene
 * @param {TokenDocument} tokenDoc
 * @param {object} movement
 * @param {{i:number,j:number}[]} path   Every hex passed, starting where the move began
 * @param {object} move                  { id, approved }
 */
export function onPartyMove(scene, tokenDoc, movement, path, move = {}) {
  if (!isResponsibleGM() || !get("mode") || !travelSettings().auto) return;
  // A teleport (Foundry's "displace" movement action) doesn't take any travel time.
  const waypoints = movement?.passed?.waypoints ?? [];
  if (waypoints.length && waypoints.every(w => w?.action === "displace")) return;
  return exclusive(() => spendTravel(scene, tokenDoc, path, move));
}

/** Start today's travel over (the GM's fix for a mistaken move). */
export function resetTravel() {
  if (!isResponsibleGM()) return;
  return exclusive(async () => {
    const state = getState();
    state.travel = { day: state.day, hours: 0, moves: [] };
    await saveState(state);
  });
}

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/** Called from the updateWorldTime hook. */
export function onWorldTime(worldTime) {
  if (!isResponsibleGM() || !get("mode")) return;
  return exclusive(() => advanceTo(worldTime));
}

/** Start the hexcrawl, or catch up on time that passed while Hexcrawl mode was off. */
export function resume() {
  if (!isResponsibleGM() || !get("mode")) return;
  return exclusive(() => advanceTo(game.time.worldTime));
}

/** Set today's weather by hand (e.g. Langden Mire starts Cloudy, Worsening). */
export function setWeather(step, trend) {
  if (!isResponsibleGM()) return;
  return exclusive(async () => {
    const state = getState();
    step = R.clampStep(step);
    state.weather = { step, trend: trend === "improving" ? "improving" : "worsening" };
    state.forecast = null;
    if (!state.initialized) state.presetWeather = true;
    await saveState(state);
    await syncAllScenes({ visibility: true, environment: true });
  });
}

/** Roll (or reroll) tomorrow's weather now and whisper it to the GM. */
export function rerollForecast() {
  if (!isResponsibleGM()) return;
  return exclusive(async () => {
    const state = getState();
    state.forecast = R.nextWeather(state.weather, rng(), get("region"));
    await saveState(state);
    await Chat.postForecastCard(state);
  });
}

/** Post the current conditions to chat for everyone. */
export async function postReport() {
  const state = getState();
  const c = clock();
  const t = game.time.worldTime;
  await Chat.postReportCard(state, conditions(state), {
    day: state.day,
    phaseLabel: C.PHASES[C.phaseAt(t, c)].label,
    time: C.formatClock(t, c)
  });
}
