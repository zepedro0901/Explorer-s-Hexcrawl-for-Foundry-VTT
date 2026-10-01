/**
 * Pure rules for the hexcrawl, taken from the "Hexcrawl Tables" reference pages.
 * Nothing in this file touches Foundry globals, so it can be unit-tested in Node.
 */

/* -------------------------------------------- */
/*  Weather                                     */
/* -------------------------------------------- */

/** The four kinds of weather, from best to worst. `extraHours` is added to every hex travelled. */
export const WEATHER = Object.freeze([
  { step: 1, key: "clear", label: "Clear", icon: "fa-sun", extraHours: 0,
    effect: "Good travelling weather." },
  { step: 2, key: "cloudy", label: "Cloudy", icon: "fa-cloud", extraHours: 0,
    effect: "Grey skies. Travel as normal." },
  { step: 3, key: "rain", label: "Rain", icon: "fa-cloud-showers-heavy", extraHours: 1,
    effect: "Wet going: every hex takes 1 more hour." },
  { step: 4, key: "storm", label: "Storm", icon: "fa-cloud-bolt", extraHours: 2,
    effect: "Every hex takes 2 more hours. A night without shelter: DC 10 CON save or 1 level of exhaustion." }
]);

export const MAX_STEP = WEATHER.length;

/** How rain and storms look in winter and frozen lands, and a desert's storm. */
const SNOW = Object.freeze({ label: "Snow", icon: "fa-snowflake" });
const BLIZZARD = Object.freeze({ label: "Blizzard", icon: "fa-snowflake" });
const SANDSTORM = Object.freeze({ label: "Sandstorm", icon: "fa-wind",
  effect: "Every hex takes 2 more hours. Tracks are erased. A night without shelter: DC 10 CON save or 1 level of exhaustion." });

export const TRENDS = Object.freeze({
  improving: { label: "Improving", icon: "fa-arrow-trend-up" },
  worsening: { label: "Worsening", icon: "fa-arrow-trend-down" }
});

/** Seasons only decide whether rain falls as snow. */
export const SEASONS = Object.freeze({
  spring: { label: "Spring" },
  summer: { label: "Summer" },
  autumn: { label: "Autumn" },
  winter: { label: "Winter", snow: true }
});

/* -------------------------------------------- */
/*  Sight, landmarks and viewing points         */
/* -------------------------------------------- */

/** The party always sees its own hex and the hexes next to it, whatever the weather. */
export const PARTY_SIGHT = 1;

/** Landmark kinds: a point of interest, or a viewing point that reveals the land around it. */
export const LANDMARK_KINDS = Object.freeze({
  poi: { label: "Point of interest", hint: "A cave, bridge, lair, quest, tower… Seen when the party is next to it." },
  viewpoint: { label: "Viewing point", hint: "A peak or a tall tower: from here the party sees far across the map." }
});

export const DEFAULT_FAR_SIGHT = 3;
export const DEFAULT_VIEW = 3;

const wholeHexes = n => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * A landmark with its numbers checked.
 * sight  hexes it can be seen from (null = only from next door)
 * view   for a viewing point, hexes the party sees from it
 */
export function normalizeLandmark(l) {
  const kind = l?.kind === "viewpoint" ? "viewpoint" : "poi";
  return {
    key: l?.key,
    kind,
    known: !!l?.known,
    sight: wholeHexes(l?.sight),
    view: kind === "viewpoint" ? (wholeHexes(l?.view) ?? DEFAULT_VIEW) : null
  };
}

/** How far away a landmark can be spotted, in hexes. */
export function landmarkReach(l) {
  return Math.max(PARTY_SIGHT, wholeHexes(l?.sight) ?? 0);
}

/* -------------------------------------------- */
/*  Regions                                     */
/* -------------------------------------------- */

/**
 * How a region bends the default weather roll.
 * spellBreak  highest d6 face that ends a settled spell (Clear + Improving); default 1
 * improveOn   lowest d6 face that moves the weather when Improving (default 3)
 * worsenOn    lowest d6 face that moves the weather when Worsening (default 3)
 * wetFlip     highest d6 face that turns a Worsening trend to Improving in Rain (default 1)
 * snow        rain falls as snow and storms are blizzards all year
 * storm       replaces the Storm's name and effect
 */
const REGION_DEFAULTS = Object.freeze({
  spellBreak: 1, improveOn: 3, worsenOn: 3, wetFlip: 1, snow: false, storm: null
});

export const REGIONS = Object.freeze({
  default: { label: "Default", icon: "fa-globe",
    summary: "The standard rules." },
  frozen: { label: "Frozen Wastes", icon: "fa-snowflake", spellBreak: 2, snow: true,
    summary: "Rain falls as snow and storms are blizzards, all year. Clear spells end on a 1–2." },
  desert: { label: "Desert", icon: "fa-sun-plant-wilt", improveOn: 2, worsenOn: 5, wetFlip: 3, storm: SANDSTORM,
    summary: "Improving moves on a 2–6, Worsening only on a 5–6. In Rain, a 1–3 turns the trend Improving. Storms are sandstorms." },
  marsh: { label: "Marshland", icon: "fa-water", improveOn: 4, worsenOn: 4, spellBreak: 2,
    summary: "The weather lingers: it moves only on a 4–6. Clear spells end on a 1–2." },
  coast: { label: "Coast", icon: "fa-anchor", improveOn: 2, worsenOn: 2, spellBreak: 2,
    summary: "The weather moves on a 2–6 (it never simply holds). Clear spells end on a 1–2." },
  highlands: { label: "Highlands", icon: "fa-mountain", improveOn: 2, worsenOn: 2, spellBreak: 2,
    summary: "The weather moves on a 2–6 (it never simply holds). Clear spells end on a 1–2." },
  jungle: { label: "Jungle", icon: "fa-tree", improveOn: 4, worsenOn: 2, spellBreak: 2,
    summary: "Worsening moves on a 2–6, Improving only on a 4–6. Clear spells end on a 1–2." }
});

/** A region's full set of modifiers, with defaults filled in. */
export function regionOf(key) {
  return { key: REGIONS[key] ? key : "default", ...REGION_DEFAULTS, ...(REGIONS[key] ?? REGIONS.default) };
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Roll one die with n faces using a [0, 1) random source. */
export function die(n, rng = Math.random) {
  return Math.min(n, Math.floor(rng() * n) + 1);
}

export function clampStep(step) {
  return clamp(Math.round(Number(step)) || 1, 1, MAX_STEP);
}

export function weatherFor(step) {
  return WEATHER[clampStep(step) - 1];
}

/** Does rain fall as snow here and now? */
export function snowFalls(season, region = "default") {
  return !!(regionOf(region).snow || SEASONS[season]?.snow);
}

/**
 * The weather as it should be shown: a desert Storm is a Sandstorm, and in winter or
 * frozen lands Rain is Snow and a Storm is a Blizzard.
 */
export function displayWeather(step, { region = "default", season = "spring" } = {}) {
  const base = weatherFor(step);
  const r = regionOf(region);
  if (base.key === "storm" && r.storm) return { ...base, ...r.storm };
  if (snowFalls(season, r.key)) {
    if (base.key === "rain") return { ...base, ...SNOW };
    if (base.key === "storm") return { ...base, ...BLIZZARD };
  }
  return { ...base };
}

export function flipTrend(trend) {
  return trend === "improving" ? "worsening" : "improving";
}

/* -------------------------------------------- */
/*  Weather rolls                               */
/* -------------------------------------------- */

/** Starting weather (1d6): 1–2 Clear, 3–4 Cloudy, 5–6 Rain. Odd = Improving, even = Worsening. */
export function startingWeather(rng = Math.random) {
  const roll = die(6, rng);
  const step = Math.ceil(roll / 2);
  return { step, trend: roll % 2 ? "improving" : "worsening", roll,
    reason: `Starting weather (rolled ${roll}).` };
}

/**
 * Daily weather roll (1d6).
 * Default: 1 the trend flips and the weather holds · 2 the weather holds · 3–6 one step in the
 * trend's direction. Clear + Improving is a settled spell: it stays Clear until a 1 (or the
 * region's spellBreak) turns the trend. A Storm lasts one day, then eases to Rain, Improving.
 * Regions change which faces move the weather (see REGIONS).
 */
export function nextWeather(current, rng = Math.random, region = "default") {
  const r = regionOf(region);
  const step = clampStep(current?.step ?? 2);
  const trend = current?.trend === "improving" ? "improving" : "worsening";
  if (step === MAX_STEP) {
    return { step: MAX_STEP - 1, trend: "improving", roll: null,
      reason: "The storm blows itself out: Rain tomorrow, and the trend turns Improving." };
  }
  const roll = die(6, rng);
  if (step === 1 && trend === "improving") {
    if (roll <= r.spellBreak) {
      return { step, trend: "worsening", roll, reason: `Rolled ${roll}: the settled spell is ending. Still clear, but the trend turns Worsening.` };
    }
    return { step, trend, roll, reason: `Rolled ${roll}: a settled spell, the weather stays clear.` };
  }
  const flipOn = trend === "worsening" && step >= 3 ? r.wetFlip : 1;
  if (roll <= flipOn) {
    const t = flipTrend(trend);
    return { step, trend: t, roll, reason: `Rolled ${roll}: the wind shifts. The weather holds, but the trend turns ${TRENDS[t].label}.` };
  }
  const moveOn = trend === "improving" ? r.improveOn : r.worsenOn;
  if (roll < moveOn) return { step, trend, roll, reason: `Rolled ${roll}: the weather holds.` };
  const next = clamp(step + (trend === "improving" ? -1 : 1), 1, MAX_STEP);
  return { step: next, trend, roll, reason: `Rolled ${roll}: the weather ${trend === "improving" ? "improves" : "worsens"}.` };
}

/* -------------------------------------------- */
/*  Travel                                      */
/* -------------------------------------------- */

export const DEFAULT_TRAVEL = Object.freeze({ open: 2, rough: 4, day: 8 });

/** Extra hours per hex from today's weather: rain +1, storm +2. */
export function weatherHours(step) {
  return weatherFor(step).extraHours;
}

/** Hours to enter one hex. */
export function hexHours(rough, step, { open = DEFAULT_TRAVEL.open, roughHours = DEFAULT_TRAVEL.rough } = {}) {
  return (rough ? roughHours : open) + weatherHours(step);
}

/**
 * The hexes entered during one move: consecutive repeats are dropped, and so is the hex the
 * move started in.
 * @param {{i:number,j:number}[]} path
 */
export function hexesEntered(path) {
  const out = [];
  let prev = null;
  for (const o of path ?? []) {
    if (prev && prev.i === o.i && prev.j === o.j) continue;
    out.push({ i: o.i, j: o.j });
    prev = o;
  }
  return out.slice(1);
}

/**
 * Hours a move takes.
 * @param {{i:number,j:number}[]} path    Every hex passed, starting with the hex the move began in
 * @param {Set<string>} rough             Keys ("i_j") of rough hexes
 * @param {number} step                   Today's weather
 * @param {object} [hours]                { open, roughHours }
 * @returns {{hexes: number, rough: number, hours: number}}
 */
export function moveCost(path, rough, step, hours = {}) {
  const entered = hexesEntered(path);
  let total = 0;
  let roughCount = 0;
  for (const o of entered) {
    const isRough = rough.has(`${o.i}_${o.j}`);
    if (isRough) roughCount++;
    total += hexHours(isRough, step, hours);
  }
  return { hexes: entered.length, rough: roughCount, hours: total };
}

/**
 * How far along a planned move the party can go with the hours it has.
 * @returns {{hexes: number, hours: number, fit: {hexes: number, hours: number}, ok: boolean}}
 *   fit: the hexes (from the start) that fit in `available` hours; ok: the whole move fits
 */
export function fitMove(path, rough, step, hours = {}, available = Infinity) {
  const entered = hexesEntered(path);
  let total = 0;
  const fit = { hexes: 0, hours: 0 };
  entered.forEach((o, index) => {
    total += hexHours(rough.has(`${o.i}_${o.j}`), step, hours);
    if (fit.hexes === index && total <= available + 1e-9) {
      fit.hexes++;
      fit.hours = total;
    }
  });
  return { hexes: entered.length, hours: total, fit, ok: total <= available + 1e-9 };
}

/**
 * The travel hours the party has left right now: the rest of the travel day, but never past
 * nightfall, and none at night.
 * @param {number} travelled       Hours already travelled today
 * @param {number} dayLength       Hours of travel in a day
 * @param {number} toNightfall     Hours until nightfall (0 at night)
 * @param {boolean} night          Whether it's night now
 * @returns {{hours: number, reason: "night"|"nightfall"|"day"}}  reason: what sets the limit
 */
export function hoursAvailable(travelled, dayLength, toNightfall, night) {
  if (night) return { hours: 0, reason: "night" };
  const left = Math.max(0, dayLength - travelled);
  return toNightfall < left ? { hours: Math.max(0, toNightfall), reason: "nightfall" } : { hours: left, reason: "day" };
}

/** Today's travel: hours on the road so far, hours left in the travel day, and any past it. */
export function travelDay(hoursTravelled, dayLength = DEFAULT_TRAVEL.day) {
  const hours = Math.max(0, Number(hoursTravelled) || 0);
  const day = Number(dayLength) > 0 ? Number(dayLength) : DEFAULT_TRAVEL.day;
  return { hours, day, left: Math.max(0, day - hours), over: Math.max(0, hours - day) };
}

/* -------------------------------------------- */
/*  Directions                                  */
/* -------------------------------------------- */

const COMPASS = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];

/** A compass direction from one canvas point to another (y grows downwards). */
export function compassDirection(from, to) {
  const dx = to.x - from.x;
  const dy = from.y - to.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return "";
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return COMPASS[((Math.round(angle / 45) % 8) + 8) % 8];
}

/* -------------------------------------------- */
/*  Night and the map                           */
/* -------------------------------------------- */

/**
 * Map darkness: full daylight by day, a fixed level at night. Weather never darkens
 * the map (the weather effects show it instead), so the map can't creep darker.
 */
export function darknessFor(phase, nightLevel = 0.6) {
  if (phase !== "night") return 0;
  const n = Number(nightLevel);
  return Math.round(clamp(Number.isFinite(n) ? n : 0.6, 0, 1) * 100) / 100;
}

/** Core Foundry weather effect to show on the map ("" for none). */
export function sceneWeatherFor(step, { season = "spring", region = "default" } = {}) {
  const shown = displayWeather(step, { season, region });
  switch (weatherFor(step).key) {
    case "storm":
      if (shown.label === "Sandstorm") return ""; // drawn by the module's own wind animation
      return shown.label === "Blizzard" ? "blizzard" : "rainStorm";
    case "rain":
      return shown.label === "Snow" ? "snow" : "rain";
    default:
      return "";
  }
}

/** 0.6.0 landmark sizes (a range: 0 hidden, 1 small, 3 large, null huge) → hexes seen from. */
export function sightFromOldRange(range) {
  if (range === null || range === undefined) return 6;
  const r = Math.floor(Number(range));
  return Number.isFinite(r) && r >= 2 ? r : null;
}

/** Old seven-step weather (Clear, Fair, Overcast, Drizzle, Showers, Rain, Storm) → the four kinds. */
export const LEGACY_STEPS = Object.freeze({ 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4 });
