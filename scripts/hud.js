import { MOD, TEMPLATES } from "./constants.js";
import * as R from "./rules.js";
import * as C from "./clock.js";
import { get, set } from "./settings.js";
import { getState, clock, conditions, displayFor, travelSettings } from "./state.js";
import * as Engine from "./engine.js";
import { refreshScene, applyEnvironment, clearMoveLog } from "./sync.js";
import { editLandmarkAt, pickHexOnCanvas } from "./landmarks.js";
import { brush } from "./brush.js";
import { hoursLeft } from "./travel.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const HUD_ID = `${MOD}-hud`;

const hours = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const plural = (n, word) => `${hours(n)} ${word}${n === 1 ? "" : "s"}`;

/** Today's travel, for the tracker. */
export function travelContext(state, cond, t = travelSettings()) {
  const d = R.travelDay(state.travel.hours, t.day);
  const segments = Array.from({ length: Math.min(24, Math.ceil(d.day)) }, (_, i) => ({ filled: i < d.hours }));
  const left = hoursLeft(state, t);
  let status;
  if (left.reason === "night") status = "It's night. The party travels again at dawn.";
  else if (left.hours <= 0 && left.reason === "nightfall") status = "Nightfall. Time to make camp.";
  else if (left.hours <= 0) status = "A full day's travel is done. Time to make camp.";
  else if (left.reason === "nightfall") status = `You can travel ${plural(left.hours, "more hour")} before nightfall.`;
  else status = `You can travel ${plural(left.hours, "more hour")} today.`;
  return {
    auto: t.auto,
    hours: hours(d.hours),
    day: hours(d.day),
    status,
    segments,
    open: hours(cond.hexHours.open),
    rough: hours(cond.hexHours.rough),
    extra: cond.hexHours.extra ? `+${hours(cond.hexHours.extra)} h for the ${cond.weather.label.toLowerCase()}` : ""
  };
}

/** The Hexcrawl tracker: clock, today's weather and travel, and the GM's controls. */
export class HexcrawlHUD extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: HUD_ID,
    classes: [MOD],
    tag: "section",
    window: { title: "Hexcrawl", icon: "fa-solid fa-compass", minimizable: true, resizable: false },
    position: { width: 330, height: "auto", top: 80, left: 120 },
    actions: {
      hcTab: onTab,
      toggleMode: onToggleMode,
      advanceHour: onAdvanceHour,
      advancePhase: onAdvancePhase,
      setWeather: onSetWeather,
      rerollForecast: () => Engine.rerollForecast(),
      postReport: () => Engine.postReport(),
      toggleScene: onToggleScene,
      setParty: onSetParty,
      pickLandmark: () => pickHexOnCanvas(p => editLandmarkAt(p)),
      paintRough: () => brush.toggle(),
      resetTravel: onResetTravel,
      refresh: onRefresh,
      fixVision: onFixVision,
      resetExplored: onResetExplored
    }
  };

  static PARTS = {
    body: { template: TEMPLATES.hud }
  };

  static get instance() {
    return foundry.applications.instances?.get(HUD_ID) ?? null;
  }

  static open() {
    return (this.instance ?? new this()).render({ force: true });
  }

  static toggle() {
    const app = this.instance;
    if (app?.rendered) return app.close();
    return this.open();
  }

  static refresh() {
    const app = this.instance;
    if (app?.rendered) app.render();
  }

  /** The open tab (GM only), kept across re-renders. */
  activeTab = "today";

  async _prepareContext(options) {
    const state = getState();
    const c = clock();
    const t = game.time.worldTime;
    const phaseKey = C.phaseAt(t, c);
    const cond = conditions(state);
    const isGM = game.user.isGM;
    const tab = isGM ? this.activeTab : "today";

    const context = {
      isGM,
      mode: get("mode"),
      initialized: state.initialized,
      day: state.day,
      phase: C.PHASES[phaseKey],
      nextLabel: phaseKey === "day" ? "To nightfall" : "To dawn",
      nextTooltip: phaseKey === "day"
        ? "Advance to nightfall: tomorrow's weather is rolled"
        : "Advance to dawn: the new day's weather arrives",
      time: C.formatClock(t, c),
      weather: cond.weather,
      trend: isGM ? R.TRENDS[cond.trend] : null,
      travel: travelContext(state, cond),
      region: cond.region.key === "default" ? null : cond.region,
      tab,
      tabs: isGM ? [
        { id: "today", label: "Today", icon: "fa-sun" },
        { id: "gm", label: "GM", icon: "fa-dice-d20" }
      ].map(x => ({ ...x, active: x.id === tab })) : null
    };

    if (isGM) {
      const f = state.forecast;
      const fw = f ? displayFor(f.step) : null;
      context.forecast = f ? { label: fw.label, icon: fw.icon, trend: R.TRENDS[f.trend]?.label } : null;
      context.weatherChoices = Object.fromEntries(R.WEATHER.map(w => [String(w.step), displayFor(w.step).label]));
      context.trendChoices = { improving: "Improving", worsening: "Worsening" };
      context.weatherStep = String(state.weather.step);
      context.weatherTrend = state.weather.trend;
      context.seasonChoices = Object.fromEntries(Object.entries(R.SEASONS).map(([k, v]) => [k, v.label]));
      context.season = get("season");
      context.regionChoices = Object.fromEntries(Object.entries(R.REGIONS).map(([k, v]) => [k, v.label]));
      context.regionKey = cond.region.key;
      context.regionSummary = cond.region.summary;

      const scene = canvas?.scene;
      if (scene) {
        const sf = scene.flags?.[MOD] ?? {};
        const party = sf.partyToken ? scene.tokens.get(sf.partyToken) : null;
        const landmarks = sf.landmarks ?? [];
        const discovered = new Set(sf.discovered ?? []);
        context.scene = {
          name: scene.name,
          enabled: !!sf.enabled,
          hex: !!scene.grid?.isHexagonal,
          party: party?.name ?? null,
          landmarkCount: landmarks.length,
          discoveredCount: landmarks.filter(l => l.known || discovered.has(l.key)).length,
          roughCount: (sf.rough ?? []).length,
          painting: brush.active,
          tokenVision: !!scene.tokenVision
        };
      }
    }
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    for (const select of el.querySelectorAll("select[data-setting]")) {
      select.addEventListener("change", ev => set(ev.currentTarget.dataset.setting, ev.currentTarget.value));
    }
  }
}

/* -------------------------------------------- */
/*  Actions (this = the HUD)                    */
/* -------------------------------------------- */

/** Switch tabs without a full re-render. */
function onTab(event, target) {
  const tab = target.dataset.tab;
  this.activeTab = tab;
  for (const button of this.element.querySelectorAll("[data-action=hcTab]")) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of this.element.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== tab;
  this.setPosition({ height: "auto" });
}

async function onToggleMode() {
  await set("mode", !get("mode"));
}

async function onAdvanceHour() {
  await game.time.advance(clock().secondsPerHour);
}

async function onAdvancePhase() {
  const t = game.time.worldTime;
  await game.time.advance(C.nextPhaseStart(t, clock()).time - t);
}

async function onSetWeather() {
  const step = Number(this.element.querySelector("select[name=hcStep]")?.value);
  const trend = this.element.querySelector("select[name=hcTrend]")?.value;
  await Engine.setWeather(step, trend);
}

async function onResetTravel() {
  await Engine.resetTravel();
}

async function onToggleScene() {
  const scene = canvas?.scene;
  if (!scene) return;
  const enable = !scene.getFlag(MOD, "enabled");
  if (enable && !scene.grid?.isHexagonal) {
    return ui.notifications.warn("A hexcrawl map needs a hexagonal grid. Change the grid type in this scene's configuration first.");
  }
  if (!enable && brush.active) await brush.stop();
  const updates = { [`flags.${MOD}.enabled`]: enable };
  // Players must not be limited to their token's own sight: the module decides what they see.
  if (enable && scene.tokenVision) updates.tokenVision = false;
  const miles = Number(get("milesPerHex"));
  if (enable && miles > 0) {
    updates["grid.distance"] = miles;
    updates["grid.units"] = "mi";
  }
  await scene.update(updates);
  if (enable) {
    await refreshScene(scene);
    if (get("mode")) await applyEnvironment(scene);
  }
}

async function onFixVision() {
  const scene = canvas?.scene;
  if (!scene?.tokenVision) return;
  await scene.update({ tokenVision: false });
  ui.notifications.info("Token Vision is off for this map: players now see what the party can see.");
}

async function onSetParty() {
  const scene = canvas?.scene;
  const token = canvas?.tokens?.controlled?.[0];
  if (!scene || !token) return ui.notifications.warn("Select the party's token on the map first.");
  await scene.setFlag(MOD, "partyToken", token.document.id);
  await refreshScene(scene);
}

async function onRefresh() {
  const scene = canvas?.scene;
  if (!scene) return;
  await refreshScene(scene);
  if (get("mode")) await applyEnvironment(scene);
}

async function onResetExplored() {
  const scene = canvas?.scene;
  if (!scene) return;
  const ok = await DialogV2.confirm({
    window: { title: "Reset explored hexes" },
    content: "<p>Hide every hex on this map again, except the ones the party can see right now? Discovered landmarks are forgotten too, unless you've marked them as known.</p>",
    rejectClose: false
  });
  if (!ok) return;
  clearMoveLog(scene);
  await scene.update({ [`flags.${MOD}.revealed`]: [], [`flags.${MOD}.discovered`]: [], [`flags.${MOD}.moves`]: [] });
  await refreshScene(scene);
}
