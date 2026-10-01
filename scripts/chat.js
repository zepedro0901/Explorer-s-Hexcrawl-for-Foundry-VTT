import { TITLE } from "./constants.js";
import * as R from "./rules.js";
import { displayFor } from "./state.js";

const speaker = () => ({ alias: TITLE });
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

export const escapeHTML = s => String(s ?? "").replace(/[&<>"']/g, ch => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
));

function card(header, body) {
  return `<div class="explorers-hexcrawl-card"><header>${header}</header>${body}</div>`;
}

const hoursText = h => `${h} h`;

/** The weather headline. The trend (Improving/Worsening) is only shown on GM-only cards. */
export function weatherLine(step, trend = null) {
  const w = displayFor(step);
  const t = trend ? (R.TRENDS[trend] ?? R.TRENDS.worsening) : null;
  const trendHTML = t ? `<span class="hc-card-trend"><i class="fa-solid ${t.icon}"></i> ${t.label}</span>` : "";
  return `<div class="hc-card-weather"><i class="fa-solid ${w.icon}"></i> <strong>${w.label}</strong>${trendHTML}</div>`;
}

/** Hours per hex today, weather included. */
export function travelText(cond) {
  return `${hoursText(cond.hexHours.open)} per open hex, ${hoursText(cond.hexHours.rough)} per rough hex`;
}

/** The body shared by all public weather cards: one line of effect, then how long a hex takes. */
export function conditionsHTML(state, cond) {
  const parts = [`<p>${cond.weather.effect}</p>`];
  parts.push(`<p class="hc-card-stats"><span><strong>Travel:</strong> ${travelText(cond)}</span></p>`);
  if (cond.region.key !== "default") {
    parts.push(`<p class="hc-card-muted"><i class="fa-solid ${cond.region.icon}"></i> ${cond.region.label}</p>`);
  }
  return parts.join("");
}

export async function postStartCard(state, cond) {
  const header = `<i class="fa-solid fa-compass"></i> The hexcrawl begins · Day ${state.day}`;
  return ChatMessage.create({ speaker: speaker(), content: card(header, weatherLine(state.weather.step) + conditionsHTML(state, cond)) });
}

export async function postDawnCard(report, state, cond, { skipped = 0 } = {}) {
  const extra = skipped > 0 ? ` <span class="hc-card-muted">(${skipped} earlier day${skipped === 1 ? "" : "s"} passed)</span>` : "";
  const header = `<i class="fa-solid fa-mountain-sun"></i> Day ${report.day} dawns${extra}`;
  const body = weatherLine(state.weather.step) + conditionsHTML(state, cond);
  return ChatMessage.create({ speaker: speaker(), content: card(header, body) });
}

/** GM only: tomorrow's weather, and a reminder when tonight is stormy. */
export async function postNightfallCard(report) {
  const f = report.forecast;
  const header = `<i class="fa-solid fa-moon"></i> Nightfall · Day ${report.day}`;
  const lines = [
    `<p><strong>Tomorrow (GM only):</strong></p>`,
    weatherLine(f.step, f.trend),
    f.reason ? `<p class="hc-card-muted">${f.reason}</p>` : "",
    `<p class="hc-card-muted">A DC 12 Wisdom (Survival) check reads the sky and predicts this.</p>`
  ];
  if (R.weatherFor(report.weather.step).key === "storm") {
    lines.push(`<p><strong>Tonight:</strong> a night without shelter means a DC 10 CON save or 1 level of exhaustion.</p>`);
  }
  return ChatMessage.create({ speaker: speaker(), whisper: gmIds(), content: card(header, lines.join("")) });
}

export async function postForecastCard(state) {
  const f = state.forecast;
  const header = `<i class="fa-solid fa-binoculars"></i> Forecast (GM only)`;
  const body = weatherLine(f.step, f.trend) + (f.reason ? `<p class="hc-card-muted">${f.reason}</p>` : "");
  return ChatMessage.create({ speaker: speaker(), whisper: gmIds(), content: card(header, body) });
}

export async function postReportCard(state, cond, { day, phaseLabel, time }) {
  const header = `<i class="fa-solid fa-compass"></i> Day ${day} · ${phaseLabel} · ${time}`;
  return ChatMessage.create({ speaker: speaker(), content: card(header, weatherLine(state.weather.step) + conditionsHTML(state, cond)) });
}

/** One line per landmark: where it lies from the spot it was first seen. */
export function landmarkLine(l) {
  const name = `<strong>${escapeHTML(l.name)}</strong>`;
  if (!(l.distance > 0)) return `The party comes upon ${name}.`;
  const where = l.distance === 1 ? "in the next hex" : `${l.distance} hexes away`;
  return `${name}, ${where}${l.direction ? ` to the ${l.direction}` : ""}.`;
}

/**
 * Everyone: the party reached a viewing point, or spotted landmarks.
 * @param {{views: {key:string, name:string, view:number}[], landmarks: object[]}} found
 */
export async function postDiscoveryCard({ views = [], landmarks = [] } = {}) {
  const viewKeys = new Set(views.map(v => v.key));
  // Standing on a viewing point says more than "the party comes upon it".
  const list = landmarks.filter(l => !(viewKeys.has(l.key) && !(l.distance > 0)));
  if (!views.length && !list.length) return null;
  const lines = views.map(v => `<p>From <strong>${escapeHTML(v.name)}</strong> the party can see ${v.view} hex${v.view === 1 ? "" : "es"} in every direction.</p>`);
  if (views.length && list.length) lines.push(`<p>It spots:</p>`);
  lines.push(...list.map(l => `<p>${landmarkLine(l)}</p>`));
  let header;
  if (views.length) header = `<i class="fa-solid fa-binoculars"></i> The view from ${escapeHTML(views[0].name)}`;
  else header = `<i class="fa-solid fa-tower-observation"></i> ${list.length === 1 ? "Landmark spotted" : "Landmarks spotted"}`;
  return ChatMessage.create({ speaker: speaker(), content: card(header, lines.join("")) });
}

/** GM only: the party went past today's limit without the GM's say-so (two quick moves, say). */
export async function postOverLimitCard(hours, left) {
  const header = `<i class="fa-solid fa-triangle-exclamation"></i> Past today's limit (GM only)`;
  const why = left.reason === "night" ? "at night" : left.reason === "nightfall" ? "past nightfall" : "past the day's travel";
  const body = `<p>The party's last move took ${hoursText(hours)} and went ${why}. Press Ctrl+Z to undo it if you didn't mean to allow it.</p>`;
  return ChatMessage.create({ speaker: speaker(), whisper: gmIds(), content: card(header, body) });
}

/** Everyone: a full day's travel is used up. */
export async function postTravelDayCard(hours) {
  const header = `<i class="fa-solid fa-person-hiking"></i> A full day on the road`;
  const body = `<p>The party has travelled ${hoursText(hours)} today. Time to make camp.</p>`;
  return ChatMessage.create({ speaker: speaker(), content: card(header, body) });
}
