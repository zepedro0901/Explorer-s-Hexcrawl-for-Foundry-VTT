import { MOD } from "./constants.js";
import * as R from "./rules.js";
import { registerSettings, get } from "./settings.js";
import { getState, isResponsibleGM } from "./state.js";
import * as Engine from "./engine.js";
import { HexOverlay } from "./overlay.js";
import { WeatherFX } from "./effects.js";
import { HexcrawlHUD } from "./hud.js";
import { partyMoved, partyUndone, pathFromMovement, isPartyToken, syncAllScenes, resetDarkness } from "./sync.js";
import * as Travel from "./travel.js";
import { editLandmarkAt, toggleExploredAt } from "./landmarks.js";
import { brush, toggleRoughAt } from "./brush.js";
import { migrate } from "./migrate.js";

const overlay = new HexOverlay();
brush.overlay = overlay;
const fx = new WeatherFX();
const refreshHUDSoon = foundry.utils.debounce(() => HexcrawlHUD.refresh(), 150);

/** The tracker and the storm animations both follow the weather state. */
function stateChanged() {
  refreshHUDSoon();
  fx.refresh();
}

function environmentChanged() {
  stateChanged();
  if (isResponsibleGM() && get("mode")) syncAllScenes({ visibility: false, environment: true });
}

/* -------------------------------------------- */
/*  Setup                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings({
    state: stateChanged,
    mode: on => {
      stateChanged();
      if (on) Engine.resume();
      if (!game.user.isGM && get("autoOpen")) {
        if (on) HexcrawlHUD.open();
        else HexcrawlHUD.instance?.close();
      }
    },
    season: environmentChanged,
    region: environmentChanged,
    travel: refreshHUDSoon,
    clock: environmentChanged,
    environment: environmentChanged,
    darkness: on => {
      if (on) environmentChanged();
      else resetDarkness();
    },
    visibilityRules: () => {
      refreshHUDSoon();
      if (isResponsibleGM()) syncAllScenes({ visibility: true, environment: false });
    },
    overlay: () => overlay.draw(),
    animation: () => fx.refresh()
  });
  registerKeybindings();
  Hooks.on(`${MOD}.brush`, refreshHUDSoon);

  const module = game.modules.get(MOD);
  if (module) module.api = {
    open: () => HexcrawlHUD.open(),
    toggle: () => HexcrawlHUD.toggle(),
    state: () => getState(),
    setWeather: (step, trend) => Engine.setWeather(step, trend),
    resetTravel: () => Engine.resetTravel(),
    rerollForecast: () => Engine.rerollForecast(),
    postReport: () => Engine.postReport(),
    refresh: () => syncAllScenes(),
    rules: R
  };
});

Hooks.once("ready", async () => {
  game.socket?.on(Travel.socketName, Travel.onSocket);
  if (get("mode") && get("autoOpen")) HexcrawlHUD.open();
  if (!isResponsibleGM()) return;
  try {
    await migrate();
  }
  catch (err) {
    console.error(`${MOD} | Migration failed`, err);
  }
  // Rework what the party can see with the current rules (they may have changed in an update).
  await syncAllScenes({ visibility: true, environment: false });
  if (get("mode")) Engine.resume();
});

function registerKeybindings() {
  game.keybindings.register(MOD, "toggleTracker", {
    name: "Open or close the Hexcrawl tracker",
    editable: [{ key: "KeyH", modifiers: ["Shift"] }],
    onDown: () => { HexcrawlHUD.toggle(); return true; }
  });
  game.keybindings.register(MOD, "editLandmark", {
    name: "Mark or edit the landmark under the cursor",
    hint: "Hover over a hex on a hexcrawl map and press this to add, edit or remove its landmark.",
    restricted: true,
    editable: [{ key: "KeyL", modifiers: ["Shift"] }],
    onDown: () => {
      const p = canvas?.ready ? canvas.mousePosition : null;
      if (p) editLandmarkAt({ x: p.x, y: p.y });
      return true;
    }
  });
  game.keybindings.register(MOD, "toggleRough", {
    name: "Mark the hex under the cursor as rough ground",
    hint: "Hover over a hex on a hexcrawl map and press this to mark it as rough ground (or open ground again). The GM tab's brush paints many hexes at once.",
    restricted: true,
    editable: [{ key: "KeyR", modifiers: ["Shift"] }],
    onDown: () => {
      const p = canvas?.ready ? canvas.mousePosition : null;
      if (p) toggleRoughAt({ x: p.x, y: p.y });
      return true;
    }
  });
  game.keybindings.register(MOD, "toggleExplored", {
    name: "Reveal or hide the hex under the cursor",
    hint: "Hover over a hex on a hexcrawl map and press this to reveal it to the players (or hide it again).",
    restricted: true,
    editable: [{ key: "KeyE", modifiers: ["Shift"] }],
    onDown: () => {
      const p = canvas?.ready ? canvas.mousePosition : null;
      if (p) toggleExploredAt({ x: p.x, y: p.y });
      return true;
    }
  });
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools || Array.isArray(tokens.tools)) return;
  tokens.tools[MOD] = {
    name: MOD,
    title: "Hexcrawl tracker",
    icon: "fa-solid fa-compass",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => HexcrawlHUD.toggle()
  };
});

/* -------------------------------------------- */
/*  Canvas                                      */
/* -------------------------------------------- */

Hooks.on("canvasReady", () => {
  overlay.attach();
  overlay.draw();
  fx.attach();
  refreshHUDSoon();
  warnAboutTokenVision(canvas.scene);
});

/** Token Vision limits players to their token's own sight, which hides what the party can see. */
function warnAboutTokenVision(scene) {
  if (!game.user.isGM || !scene?.getFlag(MOD, "enabled") || !scene.tokenVision) return;
  ui.notifications.warn("Explorer's Hexcrawl: Token Vision is on for this hexcrawl map, so players only see what their token sees. Turn it off in the tracker's GM tab.");
}

Hooks.on("canvasTearDown", () => {
  if (brush.active) brush.stop();
  overlay.detach();
  fx.detach();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas?.scene?.id) return;
  if (foundry.utils.hasProperty(changes, `flags.${MOD}`)) {
    overlay.draw();
    stateChanged();
  }
  else if ("tokenVision" in changes) refreshHUDSoon();
});

/* -------------------------------------------- */
/*  Time and movement                           */
/* -------------------------------------------- */

Hooks.on("updateWorldTime", worldTime => {
  Engine.onWorldTime(worldTime);
  refreshHUDSoon();
});

/* The party can't travel at night or past the day's hours without the GM's say-so. */
Hooks.on("preMoveToken", (tokenDoc, movement, operation) => Travel.onPreMove(tokenDoc, movement, operation));

Hooks.on("moveToken", (tokenDoc, movement, operation) => {
  if (!isResponsibleGM()) return;
  const scene = tokenDoc.parent;
  if (!isPartyToken(scene, tokenDoc)) return;
  // Ctrl+Z: cover what the undone moves revealed again and give their hours back.
  if (movement?.method === "undo") {
    Engine.undoTravel(partyUndone(scene, tokenDoc));
    return;
  }
  const path = pathFromMovement(scene, tokenDoc, movement);
  const id = movement?.id ?? foundry.utils.randomID();
  partyMoved(scene, tokenDoc, path, id);
  if (Travel.isTravelMethod(movement?.method)) {
    Engine.onPartyMove(scene, tokenDoc, movement, path, { id, approved: !!operation?.[MOD]?.approved });
  }
});
