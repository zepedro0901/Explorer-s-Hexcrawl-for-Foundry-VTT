import { MOD } from "./constants.js";
import { DEFAULT_TRAVEL, SEASONS, REGIONS } from "./rules.js";

export const get = key => game.settings.get(MOD, key);
export const set = (key, value) => game.settings.set(MOD, key, value);

/**
 * Register all module settings.
 * @param {Record<string, Function>} on   Change handlers, wired up by main.js
 */
export function registerSettings(on = {}) {
  const call = name => (...args) => on[name]?.(...args);
  const reg = (key, data) => game.settings.register(MOD, key, data);
  const choices = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.label]));

  /* Hidden state, changed from the tracker */
  reg("state", { scope: "world", config: false, type: Object, default: {}, onChange: call("state") });
  reg("schemaVersion", { scope: "world", config: false, type: Number, default: 0 });
  reg("mode", { scope: "world", config: false, type: Boolean, default: false, onChange: call("mode") });
  reg("season", { scope: "world", config: false, type: String, default: "spring",
    choices: choices(SEASONS), onChange: call("season") });
  reg("region", { scope: "world", config: false, type: String, default: "default",
    choices: choices(REGIONS), onChange: call("region") });

  /* Map and visibility */
  reg("milesPerHex", {
    name: "Miles per hex",
    hint: "Applied to a scene's grid (distance and units) when you turn it into a hexcrawl map.",
    scope: "world", config: true, type: Number, default: 6
  });
  reg("keepExplored", {
    name: "Remember explored hexes",
    hint: "Hexes the party has seen stay revealed (dimmed) after it moves on. Turn off to show only what the party can see right now.",
    scope: "world", config: true, type: Boolean, default: true, onChange: call("visibilityRules")
  });

  /* Travel */
  reg("autoTravel", {
    name: "Moving the party spends time",
    hint: "While Hexcrawl mode is on, moving the party token moves the clock forward: so many hours per open hex, more per rough hex, and more again in rain or storms.",
    scope: "world", config: true, type: Boolean, default: true, onChange: call("travel")
  });
  reg("hoursOpen", {
    name: "Hours per open hex",
    hint: "Roads, farmland, grassland, hills and forest.",
    scope: "world", config: true, type: Number, default: DEFAULT_TRAVEL.open,
    range: { min: 0.5, max: 12, step: 0.5 }, onChange: call("travel")
  });
  reg("hoursRough", {
    name: "Hours per rough hex",
    hint: "Hexes you paint as rough ground: mire, swamp, mountains.",
    scope: "world", config: true, type: Number, default: DEFAULT_TRAVEL.rough,
    range: { min: 0.5, max: 24, step: 0.5 }, onChange: call("travel")
  });
  reg("travelHours", {
    name: "Hours of travel in a day",
    hint: "The tracker counts down the hours left, and chat says when a full day's travel is used up.",
    scope: "world", config: true, type: Number, default: DEFAULT_TRAVEL.day,
    range: { min: 1, max: 24, step: 1 }, onChange: call("travel")
  });

  /* Day and night */
  const hour = (key, name, def) => reg(key, {
    name, hint: "Hour of the day (24-hour clock).",
    scope: "world", config: true, type: Number, default: def,
    range: { min: 0, max: 23.5, step: 0.5 }, onChange: call("clock")
  });
  hour("dawnHour", "Dawn (day starts)", 6);
  hour("nightHour", "Nightfall (night starts)", 20);

  reg("controlDarkness", {
    name: "Darken the map at night",
    hint: "While Hexcrawl mode is on, hexcrawl maps are in full daylight by day and darken at nightfall. Turning this off returns them to daylight.",
    scope: "world", config: true, type: Boolean, default: true, onChange: call("darkness")
  });
  reg("nightDarkness", {
    name: "Night darkness",
    hint: "How dark hexcrawl maps get at night (0 = daylight, 1 = pitch black).",
    scope: "world", config: true, type: Number, default: 0.6,
    range: { min: 0, max: 1, step: 0.05 }, onChange: call("environment")
  });
  reg("weatherEffects", {
    name: "Show weather on the map",
    hint: "While Hexcrawl mode is on, use Foundry's built-in rain, storm and snow effects on hexcrawl maps.",
    scope: "world", config: true, type: Boolean, default: true, onChange: call("environment")
  });
  reg("animatedWeather", {
    name: "Animated storms",
    hint: "Lightning in thunderstorms and blowing wind in blizzards and sandstorms, on top of the map's weather effect. Turn off if flashes bother you.",
    scope: "client", config: true, type: Boolean, default: true, onChange: call("animation")
  });
  reg("announce", {
    name: "Post to chat",
    hint: "Post the weather at dawn, landmarks and views as the party discovers them, and a note when a full day's travel is used up. You get a GM-only forecast at nightfall.",
    scope: "world", config: true, type: Boolean, default: true
  });

  /* Overlay look */
  reg("hiddenColor", {
    name: "Unexplored hex colour",
    scope: "world", config: true, default: "#1b1a17",
    type: new foundry.data.fields.ColorField({ nullable: false, initial: "#1b1a17" }),
    onChange: call("overlay")
  });
  reg("exploredOpacity", {
    name: "Explored hex shading",
    hint: "How strongly hexes the party has seen, but can't see right now, are dimmed.",
    scope: "world", config: true, type: Number, default: 0.45,
    range: { min: 0, max: 1, step: 0.05 }, onChange: call("overlay")
  });
  reg("gmOpacity", {
    name: "GM view of hidden hexes",
    hint: "How opaque unexplored hexes look to you as GM. Players always see them fully hidden.",
    scope: "client", config: true, type: Number, default: 0.5,
    range: { min: 0, max: 1, step: 0.05 }, onChange: call("overlay")
  });
  reg("autoOpen", {
    name: "Open the tracker automatically",
    hint: "Show the Hexcrawl tracker whenever Hexcrawl mode is on.",
    scope: "client", config: true, type: Boolean, default: true
  });
}
