import * as R from "./rules.js";
import * as C from "./clock.js";
import { get, set } from "./settings.js";

export const DEFAULT_STATE = Object.freeze({
  initialized: false,
  day: 1,
  lastTime: null,
  weather: { step: 2, trend: "worsening" },
  presetWeather: false,
  forecast: null,
  travel: { day: 1, hours: 0, moves: [] },
  counted: []
});

/** The hexcrawl state (weather, day count, today's travel), with defaults filled in. */
export function getState() {
  const stored = foundry.utils.deepClone(get("state") ?? {});
  const s = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_STATE), stored, { inplace: false });
  s.weather = { step: R.clampStep(s.weather?.step ?? 2),
    trend: R.TRENDS[s.weather?.trend] ? s.weather.trend : "worsening" };
  delete s.fog; // fog was taken out in 0.6.2
  delete s.lastMove; // moves are now kept on each scene, for undo
  s.counted = Array.isArray(s.counted) ? s.counted : [];
  const t = s.travel ?? {};
  // A new day starts the travel count (and the moves that can be undone) afresh.
  s.travel = t.day === s.day
    ? { day: s.day, hours: Math.max(0, Number(t.hours) || 0), moves: Array.isArray(t.moves) ? t.moves : [] }
    : { day: s.day, hours: 0, moves: [] };
  return s;
}

export async function saveState(state) {
  return set("state", foundry.utils.deepClone(state));
}

/** Clock configuration from the world calendar and the dawn and nightfall settings. */
export function clock() {
  const days = game.time?.calendar?.days ?? {};
  const hoursPerDay = Number(days.hoursPerDay) || 24;
  const secondsPerHour = (Number(days.minutesPerHour) || 60) * (Number(days.secondsPerMinute) || 60);
  return C.makeClock({
    hoursPerDay, secondsPerHour,
    dawn: get("dawnHour"), night: get("nightHour")
  });
}

const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

/** Hours per open and rough hex, and the length of a travel day. */
export function travelSettings() {
  return {
    auto: !!get("autoTravel"),
    open: positive(get("hoursOpen"), R.DEFAULT_TRAVEL.open),
    roughHours: positive(get("hoursRough"), R.DEFAULT_TRAVEL.rough),
    day: positive(get("travelHours"), R.DEFAULT_TRAVEL.day)
  };
}

/** Everything derived from today's weather: how it looks, and how long a hex takes. */
export function conditions(state = getState()) {
  const { step, trend } = state.weather;
  const region = R.regionOf(get("region"));
  const t = travelSettings();
  const extra = R.weatherHours(step);
  return {
    step, trend, region,
    weather: displayFor(step),
    hexHours: { open: t.open + extra, rough: t.roughHours + extra, extra }
  };
}

/** How a weather step looks in the current season and region (Snow, Blizzard, Sandstorm). */
export function displayFor(step) {
  return R.displayWeather(step, { region: get("region"), season: get("season") });
}

/** Only one GM client writes hexcrawl data. */
export function isResponsibleGM() {
  if (!game.user?.isGM) return false;
  const active = game.users?.activeGM;
  return !active || active.id === game.user.id;
}

export function rng() {
  const uniform = CONFIG.Dice?.randomUniform;
  return () => {
    const x = typeof uniform === "function" ? uniform() : Math.random();
    return Number.isFinite(x) && x >= 0 && x < 1 ? x : Math.random();
  };
}
