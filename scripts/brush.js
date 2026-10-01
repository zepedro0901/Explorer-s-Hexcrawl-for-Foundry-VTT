/**
 * The rough-ground brush: the GM clicks or drags over hexes to mark them as rough ground
 * (or open again). Rough hexes are stored in the scene's "rough" flag and cost more
 * hours to travel through.
 */
import { MOD } from "./constants.js";
import { hexKey } from "./visibility.js";

function hexcrawlScene() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene || !canvas.ready) return null;
  if (!scene.getFlag(MOD, "enabled")) {
    ui.notifications.warn("Turn this scene into a hexcrawl map first (Hexcrawl tracker → GM tab).");
    return null;
  }
  return scene;
}

/** The <canvas> element the map is drawn on (PIXI 7: view, PIXI 8: canvas). */
const boardElement = () => canvas?.app?.view ?? canvas?.app?.canvas ?? null;

/** A canvas point from a mouse event's screen position. */
function canvasPoint(event) {
  if (typeof canvas.canvasCoordinatesFromClient === "function") {
    return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  }
  const rect = boardElement().getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

export class RoughBrush {
  /** The overlay that previews rough hexes while painting (set by main.js). */
  overlay = null;
  active = false;
  hexes = null;
  mode = null;
  dragging = false;

  constructor() {
    this._down = this.onDown.bind(this);
    this._move = this.onMove.bind(this);
    this._up = this.onUp.bind(this);
    this._key = this.onKey.bind(this);
  }

  toggle() {
    return this.active ? this.stop() : this.start();
  }

  start() {
    const scene = hexcrawlScene();
    if (!scene || this.active) return false;
    this.active = true;
    this.sceneId = scene.id;
    this.hexes = new Set(scene.getFlag(MOD, "rough") ?? []);
    // Capture on the window so a click on the map never reaches Foundry's token controls.
    window.addEventListener("pointerdown", this._down, true);
    window.addEventListener("pointermove", this._move, true);
    window.addEventListener("pointerup", this._up, true);
    window.addEventListener("keydown", this._key, true);
    this.overlay?.setRoughPreview(this.hexes);
    ui.notifications.info("Painting rough ground: click or drag over hexes to mark them rough, or open again. Press Esc (or the brush button) when you're done.");
    Hooks.callAll(`${MOD}.brush`, true);
    return true;
  }

  async stop() {
    if (!this.active) return;
    window.removeEventListener("pointerdown", this._down, true);
    window.removeEventListener("pointermove", this._move, true);
    window.removeEventListener("pointerup", this._up, true);
    window.removeEventListener("keydown", this._key, true);
    this.active = false;
    this.dragging = false;
    await this.commit();
    this.hexes = null;
    this.overlay?.setRoughPreview(null);
    Hooks.callAll(`${MOD}.brush`, false);
  }

  /** Save the painted hexes to the scene. */
  async commit() {
    const scene = game.scenes.get(this.sceneId);
    if (!scene || !this.hexes) return;
    const next = [...this.hexes].sort();
    const prev = [...(scene.getFlag(MOD, "rough") ?? [])].sort();
    if (next.length === prev.length && next.every((k, i) => k === prev[i])) return;
    await scene.setFlag(MOD, "rough", next);
  }

  paint(event) {
    if (!canvas?.ready || canvas.scene?.id !== this.sceneId) return;
    const key = hexKey(canvas.grid.getOffset(canvasPoint(event)));
    if (!this.mode) this.mode = this.hexes.has(key) ? "open" : "rough";
    const had = this.hexes.has(key);
    if (this.mode === "rough" && !had) this.hexes.add(key);
    else if (this.mode === "open" && had) this.hexes.delete(key);
    else return;
    this.overlay?.setRoughPreview(this.hexes);
  }

  onDown(event) {
    if (event.button !== 0 || !event.target || event.target !== boardElement()) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.mode = null;
    this.paint(event);
  }

  onMove(event) {
    if (this.dragging) this.paint(event);
  }

  onUp(event) {
    if (!this.dragging || event.button !== 0) return;
    this.dragging = false;
    this.mode = null;
    this.commit();
  }

  onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.stop();
  }
}

export const brush = new RoughBrush();

/** Mark the hex at a canvas point as rough ground, or open again (Shift+R). */
export async function toggleRoughAt(point) {
  const scene = hexcrawlScene();
  if (!scene) return;
  const key = hexKey(canvas.grid.getOffset(point));
  const rough = new Set(scene.getFlag(MOD, "rough") ?? []);
  if (rough.has(key)) rough.delete(key);
  else rough.add(key);
  await scene.setFlag(MOD, "rough", [...rough].sort());
  ui.notifications.info(rough.has(key) ? "Marked as rough ground." : "Marked as open ground.");
  if (brush.active) {
    brush.hexes = rough;
    brush.overlay?.setRoughPreview(rough);
  }
}
