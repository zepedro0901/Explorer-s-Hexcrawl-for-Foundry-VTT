/**
 * Travel limits: the party can't travel at night, past nightfall, or past the day's hours.
 * A move that would is stopped before it happens, and the GM decides: allow it, let the party
 * go as far as the day allows, or stop it.
 */
import { MOD } from "./constants.js";
import * as R from "./rules.js";
import * as C from "./clock.js";
import { get } from "./settings.js";
import { getState, clock, travelSettings, isResponsibleGM } from "./state.js";
import { isPartyToken, pathFromPositions, positionInHex } from "./sync.js";
import { escapeHTML } from "./chat.js";

const SOCKET = `module.${MOD}`;

/** Movement methods that are the party travelling (not undo, pasting, a resize or the token sheet). */
const TRAVEL_METHODS = new Set(["dragging", "keyboard", "api", "hud"]);

/** Does this move count as travel (spending time, and limited)? */
export const isTravelMethod = method => TRAVEL_METHODS.has(method);

/**
 * Moves this client has let through that the GM's clock hasn't counted yet (movement id →
 * hours). Without these, two quick moves would both see the same hours left.
 */
const inFlight = new Map();
const IN_FLIGHT_MS = 15000;

function hoursInFlight(state) {
  const counted = new Set(state.counted ?? []);
  const now = Date.now();
  let hours = 0;
  for (const [id, move] of inFlight) {
    if (counted.has(id) || now - move.at > IN_FLIGHT_MS) inFlight.delete(id);
    else hours += move.hours;
  }
  return hours;
}

/** The parts of a waypoint that TokenDocument#move takes. */
const WAYPOINT_KEYS = ["x", "y", "elevation", "width", "height", "shape", "action", "snapped", "explicit", "checkpoint"];
const cleanWaypoint = w => Object.fromEntries(WAYPOINT_KEYS.filter(k => w?.[k] !== undefined).map(k => [k, w[k]]));

/** Moves the GM has just approved, so they aren't stopped again (token ids). */
const approved = new Set();

/** Tokens with a GM decision open, so repeated tries don't stack up dialogs. */
const asking = new Set();

/** The travel hours the party has left right now (counting moves still on their way to the GM). */
export function hoursLeft(state = getState(), t = travelSettings()) {
  const c = clock();
  const extra = hoursInFlight(state);
  const now = game.time.worldTime + extra * c.secondsPerHour;
  return R.hoursAvailable(state.travel.hours + extra, t.day, C.hoursToNightfall(now, c), C.phaseAt(now, c) === "night");
}

/** Where a planned move goes, what it costs, and how much of it fits in the hours left. */
export function planMove(scene, doc, origin, waypoints) {
  const state = getState();
  const t = travelSettings();
  const path = pathFromPositions(scene, doc, [origin, ...waypoints]);
  const rough = new Set(scene.getFlag(MOD, "rough") ?? []);
  const left = hoursLeft(state, t);
  const fit = R.fitMove(path, rough, state.weather.step, t, left.hours);
  return { path, left, ...fit };
}

const hoursText = n => `${Number.isInteger(n) ? n : n.toFixed(1)} hour${n === 1 ? "" : "s"}`;
const hexesText = n => `${n} hex${n === 1 ? "" : "es"}`;

/** Why the party can't go on, in a sentence. */
export function limitText(left) {
  if (left.reason === "night") return "It's night: the party should be camping until dawn.";
  if (left.reason === "nightfall") return `Nightfall is ${left.hours > 0 ? `${hoursText(left.hours)} away` : "here"}.`;
  if (left.hours <= 0) return "The party has used up today's travel.";
  return `Only ${hoursText(left.hours)} of travel ${left.hours === 1 ? "is" : "are"} left today.`;
}

/**
 * preMoveToken: stop a party move that goes past what the day allows, and ask the GM.
 * Runs on the client of whoever is moving the token.
 * @returns {false|void}
 */
export function onPreMove(doc, movement, operation) {
  if (operation?.[MOD]?.approved || approved.has(doc?.id)) return;
  if (!TRAVEL_METHODS.has(movement?.method)) return;
  const scene = doc?.parent;
  if (!isPartyToken(scene, doc) || !get("mode") || !travelSettings().auto) return;
  if (!game.users?.activeGM) return; // nobody is running the hexcrawl clock
  if (!getState().initialized) return;
  const waypoints = [...(movement.passed?.waypoints ?? []), ...(movement.pending?.waypoints ?? [])];
  if (!waypoints.length || waypoints.every(w => w?.action === "displace")) return;

  const origin = movement.origin ?? { x: doc.x, y: doc.y };
  const plan = planMove(scene, doc, origin, waypoints);
  if (plan.ok) {
    if (plan.hours > 0 && movement.id) inFlight.set(movement.id, { hours: plan.hours, at: Date.now() });
    return;
  }

  const request = { type: "travel-request", userId: game.user.id, sceneId: scene.id, tokenId: doc.id,
    origin: { x: origin.x, y: origin.y }, waypoints: waypoints.map(cleanWaypoint) };
  if (isResponsibleGM()) askGM(request);
  else {
    ui.notifications.info(`The party can't go that far: ${limitText(plan.left)} Asking the GM.`);
    game.socket.emit(SOCKET, request);
  }
  return false;
}

/** Messages between clients: a player's request to the GM, and the GM's answer. */
export function onSocket(message) {
  if (message?.type === "travel-request" && isResponsibleGM()) askGM(message);
  else if (message?.type === "travel-answer" && message.userId === game.user.id && message.text) {
    ui.notifications.info(message.text);
  }
}

/** Tell the player who tried to move the party what the GM decided (the GM knows already). */
function answer(userId, text) {
  if (!text || userId === game.user.id) return;
  game.socket.emit(SOCKET, { type: "travel-answer", userId, text });
}

/** Move the party with the GM's blessing. */
async function approvedMove(doc, waypoints) {
  approved.add(doc.id);
  try {
    return await doc.move(waypoints, { method: "api", [MOD]: { approved: true } });
  }
  finally {
    approved.delete(doc.id);
  }
}

/**
 * The GM decides what happens to a move that goes past today's limit.
 * @param {{userId: string, sceneId: string, tokenId: string, waypoints: object[]}} request
 */
export async function askGM({ userId, sceneId, tokenId, origin, waypoints }) {
  const scene = game.scenes.get(sceneId);
  const doc = scene?.tokens.get(tokenId);
  if (!doc) return;
  if (asking.has(tokenId)) return answer(userId, "The GM is already deciding on a move for the party.");
  asking.add(tokenId);
  const start = { x: doc.x, y: doc.y };
  const stillThere = () => doc.x === start.x && doc.y === start.y;
  try {
    if (origin && (Math.abs(origin.x - start.x) > 1 || Math.abs(origin.y - start.y) > 1)) {
      return answer(userId, "The party has moved since, so nothing was changed.");
    }
    const plan = planMove(scene, doc, start, waypoints);
    if (plan.ok) return await approvedMove(doc, waypoints); // time moved on (a new day) and it fits now
    const who = userId === game.user.id ? "You want" : `<strong>${escapeHTML(game.users.get(userId)?.name ?? "A player")}</strong> wants`;
    const partial = plan.fit.hexes > 0;
    const buttons = [
      { action: "allow", label: "Allow the whole move", icon: "fa-solid fa-check" },
      ...(partial ? [{ action: "partial", label: `Go ${hexesText(plan.fit.hexes)} (${hoursText(plan.fit.hours)})`, icon: "fa-solid fa-person-hiking" }] : []),
      { action: "stop", label: "Stop the party", icon: "fa-solid fa-hand", default: true }
    ];
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Travel past today's limit?", icon: "fa-solid fa-person-hiking" },
      content: `<p>${who} to move the party ${hexesText(plan.hexes)}, which takes ${hoursText(plan.hours)}.</p>`
        + `<p>${limitText(plan.left)}</p>`,
      buttons, rejectClose: false
    });
    if (choice !== "allow" && choice !== "partial") return answer(userId, "The GM stopped the party here.");
    if (!stillThere()) return answer(userId, "The party moved while the GM was deciding, so nothing was changed.");
    if (choice === "allow") {
      const moved = await approvedMove(doc, waypoints);
      answer(userId, moved === false ? "The move couldn't be made." : "The GM allowed the move.");
    }
    else {
      const hexes = R.hexesEntered(plan.path).slice(0, plan.fit.hexes);
      const steps = hexes.map(o => ({ ...positionInHex(scene.grid, o, doc), elevation: doc.elevation ?? 0 }));
      const moved = await approvedMove(doc, steps);
      answer(userId, moved === false ? "The move couldn't be made."
        : `The GM let the party go ${hexesText(plan.fit.hexes)}, as far as it can today.`);
    }
  }
  catch (err) {
    console.error(`${MOD} | Travel request failed`, err);
  }
  finally {
    asking.delete(tokenId);
  }
}

export const socketName = SOCKET;
