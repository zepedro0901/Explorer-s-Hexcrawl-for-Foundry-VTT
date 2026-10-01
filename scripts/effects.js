/**
 * Storm animations drawn on top of Foundry's own weather effects:
 * lightning flashes in thunderstorms, and blowing wind in blizzards and sandstorms.
 * Drawn in screen space (canvas.overlay) and run locally on every client.
 */
import { MOD } from "./constants.js";
import { get } from "./settings.js";
import { getState, conditions } from "./state.js";
import { MAX_STEP } from "./rules.js";

const isPixiV8 = () => String(globalThis.PIXI?.VERSION ?? "").startsWith("8");
const rand = (a, b) => a + Math.random() * (b - a);

function reducedMotion() {
  try {
    return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }
  catch {
    return false;
  }
}

function strokePath(g, points, width, color, alpha) {
  if (points.length < 2) return;
  if (isPixiV8()) {
    g.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    g.stroke({ width, color, alpha, cap: "round", join: "round" });
  }
  else {
    g.lineStyle(width, color, alpha);
    g.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) g.lineTo(p.x, p.y);
    g.lineStyle(0);
  }
}

function fillRect(g, x, y, w, h, color, alpha) {
  if (isPixiV8()) g.rect(x, y, w, h).fill({ color, alpha });
  else {
    g.beginFill(color, alpha);
    g.drawRect(x, y, w, h);
    g.endFill();
  }
}

/** Which storm animation the current scene should show, or null. */
export function stormKind() {
  const scene = canvas?.scene;
  if (!scene?.getFlag(MOD, "enabled")) return null;
  if (!get("mode") || !get("weatherEffects") || !get("animatedWeather")) return null;
  const state = getState();
  if (!state.initialized || state.weather.step !== MAX_STEP) return null;
  const label = conditions(state).weather.label;
  if (label === "Sandstorm") return "sandstorm";
  if (label === "Blizzard") return "blizzard";
  return "thunderstorm";
}

const WIND = {
  blizzard: { color: 0xffffff, count: 150, speed: [900, 1600], len: [40, 120], alpha: [0.2, 0.55], width: [1, 2.2],
    slope: 0.2, haze: { color: 0xe6eeff, alpha: 0.14 } },
  sandstorm: { color: 0xd9b77a, count: 180, speed: [700, 1300], len: [30, 95], alpha: [0.2, 0.5], width: [1, 2.6],
    slope: 0.08, haze: { color: 0xc4955a, alpha: 0.24 } }
};

export class WeatherFX {
  kind = null;
  container = null;
  streaks = [];
  elapsed = 0;
  nextStrike = 0;
  flashAlpha = 0;
  boltLife = 0;
  flicker = null;
  size = { w: 0, h: 0 };

  attach() {
    this.detach();
    const parent = canvas?.overlay;
    const ticker = canvas?.app?.ticker;
    if (!parent || !ticker) return;
    const c = new PIXI.Container();
    c.eventMode = "none";
    c.interactiveChildren = false;
    this.haze = c.addChild(new PIXI.Graphics());
    this.wind = c.addChild(new PIXI.Graphics());
    this.bolt = c.addChild(new PIXI.Graphics());
    this.flash = c.addChild(new PIXI.Graphics());
    parent.addChild(c);
    this.container = c;
    this._tick = () => this.tick(ticker.deltaMS);
    ticker.add(this._tick);
    this.refresh();
  }

  detach() {
    if (this._tick) canvas?.app?.ticker?.remove(this._tick);
    this._tick = null;
    if (this.container && !this.container.destroyed) this.container.destroy({ children: true });
    this.container = null;
    this.kind = null;
    this.streaks = [];
  }

  /** Start, switch or stop the animation to match the current weather. */
  refresh() {
    if (!this.container || this.container.destroyed) return;
    const kind = stormKind();
    if (kind === this.kind) return;
    this.kind = kind;
    this.streaks = [];
    this.flashAlpha = 0;
    this.boltLife = 0;
    this.flicker = null;
    for (const g of [this.haze, this.wind, this.bolt, this.flash]) g.clear();
    this.size = { w: 0, h: 0 };
    this.container.visible = !!kind;
    if (kind === "thunderstorm") this.nextStrike = rand(1500, 5000);
  }

  screen() {
    const s = canvas.app.renderer.screen;
    return { w: s.width, h: s.height };
  }

  tick(ms) {
    if (!this.kind || !this.container || this.container.destroyed) return;
    ms = Math.min(Number(ms) || 16, 100);
    this.elapsed += ms;
    if (this.kind === "thunderstorm") this.tickLightning(ms);
    else this.tickWind(ms);
  }

  /* ---------------- Wind ---------------- */

  spawnStreak(cfg, w, h, anywhere) {
    const len = rand(...cfg.len);
    return {
      x: anywhere ? rand(-len, w) : rand(-w * 0.4, -len),
      y: anywhere ? rand(-h * 0.1, h) : rand(-h * 0.3, h),
      len,
      speed: rand(...cfg.speed),
      alpha: rand(...cfg.alpha),
      width: rand(...cfg.width)
    };
  }

  tickWind(ms) {
    const cfg = WIND[this.kind];
    const { w, h } = this.screen();
    if (w !== this.size.w || h !== this.size.h) {
      this.size = { w, h };
      this.haze.clear();
      fillRect(this.haze, 0, 0, w, h, cfg.haze.color, cfg.haze.alpha);
      const count = Math.round(cfg.count * Math.min(1.6, (w * h) / (1920 * 1080)));
      this.streaks = Array.from({ length: count }, () => this.spawnStreak(cfg, w, h, true));
    }
    // Gusts: the wind speeds up and slackens.
    const t = this.elapsed;
    const gust = 0.7 + 0.35 * Math.sin(t / 1300) + 0.15 * Math.sin(t / 370);
    this.haze.alpha = 0.85 + 0.15 * Math.sin(t / 900);
    this.wind.clear();
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      const d = (s.speed * gust * ms) / 1000;
      s.x += d;
      s.y += d * cfg.slope;
      if (s.x - s.len > w || s.y - s.len * cfg.slope > h) {
        this.streaks[i] = this.spawnStreak(cfg, w, h, false);
        continue;
      }
      strokePath(this.wind, [{ x: s.x - s.len, y: s.y - s.len * cfg.slope }, { x: s.x, y: s.y }],
        s.width, cfg.color, s.alpha * Math.min(1, gust));
    }
  }

  /* ---------------- Lightning ---------------- */

  strike(strength = 1) {
    const { w, h } = this.screen();
    const calm = reducedMotion();
    this.bolt.clear();
    const x0 = rand(w * 0.1, w * 0.9);
    const yEnd = h * rand(0.45, 0.85);
    const steps = Math.round(rand(9, 14));
    const main = [{ x: x0, y: -10 }];
    for (let i = 1; i <= steps; i++) {
      const prev = main[i - 1];
      main.push({ x: prev.x + rand(-w * 0.03, w * 0.03), y: (yEnd * i) / steps });
    }
    const branches = [];
    for (let b = 0; b < Math.round(rand(1, 3)); b++) {
      const from = main[Math.round(rand(2, steps - 2))];
      const dir = Math.random() < 0.5 ? -1 : 1;
      const branch = [from];
      for (let i = 1; i <= 4; i++) {
        const p = branch[i - 1];
        branch.push({ x: p.x + dir * rand(w * 0.01, w * 0.035), y: p.y + rand(h * 0.02, h * 0.05) });
      }
      branches.push(branch);
    }
    for (const path of [main, ...branches]) {
      strokePath(this.bolt, path, 10, 0xbfd6ff, 0.22);
      strokePath(this.bolt, path, path === main ? 2.6 : 1.4, 0xffffff, 0.95);
    }
    this.boltLife = 240;
    this.flashAlpha = (calm ? 0.1 : 0.32) * strength;
  }

  tickLightning(ms) {
    const { w, h } = this.screen();
    this.nextStrike -= ms;
    if (this.nextStrike <= 0) {
      this.strike(1);
      this.flicker = !reducedMotion() && Math.random() < 0.45 ? rand(90, 160) : null;
      this.nextStrike = rand(5000, 16000);
    }
    if (this.flicker !== null) {
      this.flicker -= ms;
      if (this.flicker <= 0) {
        this.flicker = null;
        this.flashAlpha = Math.max(this.flashAlpha, 0.2);
        this.boltLife = Math.max(this.boltLife, 140);
      }
    }
    this.boltLife = Math.max(0, this.boltLife - ms);
    this.bolt.alpha = Math.min(1, this.boltLife / 120);
    this.flashAlpha *= Math.exp(-ms / 140);
    this.flash.clear();
    if (this.flashAlpha > 0.005) fillRect(this.flash, 0, 0, w, h, 0xeef3ff, this.flashAlpha);
  }
}
