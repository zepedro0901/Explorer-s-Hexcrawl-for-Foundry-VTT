/**
 * Day/night clock helpers. Pure functions over world time in seconds.
 * A hexcrawl "day" runs from dawn to dawn.
 */

/** Day runs from dawn to nightfall; night from nightfall to the next dawn. */
export const PHASES = Object.freeze({
  day: { key: "day", label: "Day", icon: "fa-sun" },
  night: { key: "night", label: "Night", icon: "fa-moon" }
});

const DEFAULT_HOURS = [6, 20];

/**
 * Build a clock configuration. Dawn must come before nightfall within the day;
 * otherwise sensible defaults are used.
 */
export function makeClock({ hoursPerDay = 24, secondsPerHour = 3600, dawn = 6, night = 20 } = {}) {
  hoursPerDay = Number(hoursPerDay) > 0 ? Number(hoursPerDay) : 24;
  secondsPerHour = Number(secondsPerHour) > 0 ? Number(secondsPerHour) : 3600;
  let h = [dawn, night].map(Number);
  const ok = h.every(Number.isFinite) && h[0] >= 0 && h[0] < h[1] && h[1] < hoursPerDay;
  if (!ok) h = DEFAULT_HOURS.map(x => (x / 24) * hoursPerDay);
  return {
    hoursPerDay, secondsPerHour,
    secondsPerDay: hoursPerDay * secondsPerHour,
    dawn: h[0], night: h[1]
  };
}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

export function hourOf(t, c) {
  return mod(t, c.secondsPerDay) / c.secondsPerHour;
}

export function midnightOf(t, c) {
  return Math.floor(t / c.secondsPerDay) * c.secondsPerDay;
}

export function phaseAt(t, c) {
  const h = hourOf(t, c);
  return h >= c.dawn && h < c.night ? "day" : "night";
}

/** The next dawn or nightfall after t. */
export function nextPhaseStart(t, c) {
  const base = midnightOf(t, c);
  for (let d = 0; d <= 1; d++) {
    for (const [phase, hour] of [["day", c.dawn], ["night", c.night]]) {
      const time = base + d * c.secondsPerDay + hour * c.secondsPerHour;
      if (time > t) return { phase, time };
    }
  }
  return { phase: "day", time: base + c.secondsPerDay + c.dawn * c.secondsPerHour };
}

/** Hours of daylight left before nightfall (0 at night). */
export function hoursToNightfall(t, c) {
  if (phaseAt(t, c) === "night") return 0;
  const nightfall = midnightOf(t, c) + c.night * c.secondsPerHour;
  return Math.max(0, (nightfall - t) / c.secondsPerHour);
}

export function nextDawn(t, c) {
  let x = midnightOf(t, c) + c.dawn * c.secondsPerHour;
  if (x <= t) x += c.secondsPerDay;
  return x;
}

/**
 * Dawn and nightfall events in the interval (t0, t1], in time order.
 * Very long jumps are capped to the last ten years of events.
 */
export function eventsBetween(t0, t1, c) {
  if (!(t1 > t0)) return [];
  let d0 = Math.floor(t0 / c.secondsPerDay);
  const d1 = Math.floor(t1 / c.secondsPerDay);
  if (d1 - d0 > 3660) d0 = d1 - 3660;
  const out = [];
  for (let d = d0; d <= d1; d++) {
    const base = d * c.secondsPerDay;
    const dawn = base + c.dawn * c.secondsPerHour;
    const night = base + c.night * c.secondsPerHour;
    if (dawn > t0 && dawn <= t1) out.push({ type: "dawn", time: dawn });
    if (night > t0 && night <= t1) out.push({ type: "nightfall", time: night });
  }
  return out.sort((a, b) => a.time - b.time);
}

export function formatClock(t, c) {
  const h = hourOf(t, c);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** The time on the same day as `t` at the given (24-hour-scaled) hour. */
export function timeAtHour(t, hour, c) {
  return midnightOf(t, c) + (hour / 24) * c.hoursPerDay * c.secondsPerHour;
}
