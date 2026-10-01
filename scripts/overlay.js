/**
 * Draws the hexcrawl "fog of war" over a hexcrawl map: unexplored hexes are covered,
 * explored hexes are dimmed, and hexes the party can see right now are clear.
 * Everything is drawn from the scene's flags, so every client shows the same picture.
 */
import { MOD } from "./constants.js";
import { get } from "./settings.js";
import { parseHexKey } from "./visibility.js";

const LANDMARK_COLOR = 0xe0b040;
const VIEWPOINT_COLOR = 0x6fb6e0;
const ROUGH_FILL = 0x9a6a2e;
const ROUGH_EDGE = 0x5a3510;

const isPixiV8 = () => String(globalThis.PIXI?.VERSION ?? "").startsWith("8");

function fillPoly(g, points, color) {
  if (isPixiV8()) g.poly(points).fill({ color, alpha: 1 });
  else {
    g.beginFill(color, 1);
    g.drawPolygon(points);
    g.endFill();
  }
}

function disc(g, x, y, r, fill, fillAlpha, ring, ringWidth) {
  if (isPixiV8()) g.circle(x, y, r).fill({ color: fill, alpha: fillAlpha }).stroke({ width: ringWidth, color: ring, alpha: 0.95 });
  else {
    g.lineStyle(ringWidth, ring, 0.95);
    g.beginFill(fill, fillAlpha);
    g.drawCircle(x, y, r);
    g.endFill();
    g.lineStyle(0);
  }
}

async function loadIcon(src) {
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  try {
    if (typeof load === "function") return await load(src);
    return PIXI.Texture.from(src);
  }
  catch (err) {
    console.warn(`${MOD} | Could not load landmark icon ${src}`, err);
    return null;
  }
}

function strokePoly(g, points, width, color, alpha) {
  if (isPixiV8()) g.poly(points).stroke({ width, color, alpha });
  else {
    g.lineStyle(width, color, alpha);
    g.drawPolygon(points);
    g.lineStyle(0);
  }
}

/** Hex corner points, pushed outwards by `pad` pixels (negative shrinks). */
function hexPoints(grid, offset, pad = 0) {
  const c = grid.getCenterPoint(offset);
  const pts = [];
  for (const v of grid.getVertices(offset)) {
    const dx = v.x - c.x;
    const dy = v.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    pts.push(v.x + (dx / len) * pad, v.y + (dy / len) * pad);
  }
  return pts;
}

/**
 * Give a Graphics object an overall opacity. An alpha filter composites the layer as a
 * whole, so the overlapping hex edges don't show as darker seams.
 */
function setLayerAlpha(g, alpha) {
  const AlphaFilter = globalThis.PIXI?.AlphaFilter ?? globalThis.PIXI?.filters?.AlphaFilter;
  if (alpha >= 0.999 || !AlphaFilter) {
    g.filters = null;
    g.alpha = alpha;
    return;
  }
  g.alpha = 1;
  let f = g.filters?.[0];
  if (!(f instanceof AlphaFilter)) {
    f = isPixiV8() ? new AlphaFilter({ alpha }) : new AlphaFilter(alpha);
    g.filters = [f];
  }
  f.alpha = alpha;
}

function colorNumber(value, fallback = 0x1b1a17) {
  try {
    const n = Number(foundry.utils.Color.from(value));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  catch {
    return fallback;
  }
}

function clamp01(n, fallback) {
  n = Number(n);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

function makeLabel(text, grid, offset, dim, below = 0.2, onIcon = false) {
  const Precise = foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText;
  const TextClass = Precise ?? PIXI.Text;
  const style = CONFIG.canvasTextStyle?.clone?.()
    ?? new PIXI.TextStyle({ fontFamily: "Signika", fill: "#ffffff", stroke: "#111111", strokeThickness: 4 });
  style.fontSize = Math.max(12, Math.round(grid.size * 0.16));
  const label = new TextClass(text, style);
  const c = grid.getCenterPoint(offset);
  if (onIcon) {
    // Across the bottom of the icon's ring, so it stays inside its own hex.
    label.anchor?.set(0.5, 0.5);
    label.position.set(c.x, c.y + 0.4 * Math.min(grid.sizeX ?? grid.size, grid.sizeY ?? grid.size));
  }
  else {
    label.anchor?.set(0.5, 0);
    label.position.set(c.x, c.y + grid.size * below);
  }
  if (dim) label.alpha = 0.65;
  return label;
}

export class HexOverlay {
  container = null;

  attach() {
    this.detach();
    const parent = canvas?.interface;
    if (!parent) return;
    const c = new PIXI.Container();
    c.eventMode = "none";
    c.interactiveChildren = false;
    this.explored = c.addChild(new PIXI.Graphics());
    this.hidden = c.addChild(new PIXI.Graphics());
    this.rough = c.addChild(new PIXI.Graphics());
    this.marks = c.addChild(new PIXI.Graphics());
    this.icons = c.addChild(new PIXI.Container());
    this.labels = c.addChild(new PIXI.Container());

    // Sit just under the controls layer (rulers, cursors, pings) so those stay on top.
    const controls = canvas.controls;
    if (controls && controls.parent === parent) {
      c.zIndex = (controls.zIndex ?? 0) - 1;
      parent.addChildAt(c, parent.getChildIndex(controls));
    }
    else {
      c.zIndex = 999;
      parent.addChild(c);
    }
    this.container = c;
  }

  detach() {
    if (this.container && !this.container.destroyed) this.container.destroy({ children: true });
    this.container = null;
  }

  /** Rough hexes shown to the GM while the rough-ground brush is on (null hides them). */
  roughPreview = null;

  setRoughPreview(hexes) {
    this.roughPreview = hexes ? new Set(hexes) : null;
    this.drawRough();
  }

  drawRough() {
    const g = this.rough;
    if (!g || g.destroyed) return;
    g.clear();
    const grid = canvas?.grid;
    if (!this.roughPreview || !game.user.isGM || !grid?.isHexagonal) return;
    setLayerAlpha(g, 0.55);
    const pad = -Math.max(1.5, grid.size * 0.02);
    for (const key of this.roughPreview) {
      const pts = hexPoints(grid, parseHexKey(key), pad);
      fillPoly(g, pts, ROUGH_FILL);
      strokePoly(g, pts, Math.max(2, grid.size * 0.025), ROUGH_EDGE, 1);
    }
  }

  draw() {
    const c = this.container;
    if (!c || c.destroyed || !canvas?.ready) return;
    this.explored.clear();
    this.hidden.clear();
    this.rough.clear();
    this.marks.clear();
    for (const child of this.labels.removeChildren()) child.destroy();
    for (const child of this.icons.removeChildren()) child.destroy();
    const generation = (this.generation = (this.generation ?? 0) + 1);

    const scene = canvas.scene;
    const grid = canvas.grid;
    const f = scene?.flags?.[MOD] ?? {};
    const active = !!(f.enabled && grid?.isHexagonal);
    c.visible = active;
    if (!active) return;

    const isGM = game.user.isGM;
    const color = colorNumber(get("hiddenColor"));
    const exploredAlpha = clamp01(get("exploredOpacity"), 0.45);
    const gmAlpha = clamp01(get("gmOpacity"), 0.5);
    setLayerAlpha(this.hidden, isGM ? gmAlpha : 1);
    setLayerAlpha(this.explored, isGM ? gmAlpha * exploredAlpha : exploredAlpha);

    const visible = new Set(f.visible ?? []);
    const revealed = new Set(get("keepExplored") ? (f.revealed ?? []) : []);
    const [i0, j0, i1, j1] = grid.getOffsetRange(canvas.dimensions.sceneRect);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i}_${j}`;
        if (visible.has(key)) continue;
        fillPoly(revealed.has(key) ? this.explored : this.hidden, hexPoints(grid, { i, j }, 1.5), color);
      }
    }

    this.drawRough();

    // Landmarks: the GM sees them all, outlined; players see the ones the party has discovered.
    const discovered = Array.isArray(f.discovered) ? new Set(f.discovered) : null;
    const known = l => !!l.known || (discovered ? discovered.has(l.key) : visible.has(l.key) || revealed.has(l.key));
    for (const l of f.landmarks ?? []) {
      if (!l?.key) continue;
      const isKnown = known(l);
      if (!isGM && !isKnown) continue;
      const offset = parseHexKey(l.key);
      const color = l.kind === "viewpoint" ? VIEWPOINT_COLOR : LANDMARK_COLOR;
      if (isGM) strokePoly(this.marks, hexPoints(grid, offset, -grid.size * 0.06), Math.max(2, grid.size * 0.03), color, 0.9);
      const dim = isGM && !isKnown;
      if (l.icon) this.drawIcon(l, grid, offset, { dim, underParty: l.key === f.partyHex, generation });
      if (l.name) this.labels.addChild(makeLabel(l.name, grid, offset, dim, l.icon ? 0.3 : 0.2, !!l.icon));
    }
  }

  /** A landmark's icon: a dark disc with a gold ring, and the image on top once it loads. */
  drawIcon(landmark, grid, offset, { dim, underParty, generation }) {
    const c = grid.getCenterPoint(offset);
    // The icon fills 90% of the hex, so it reads at a glance.
    const r = 0.45 * Math.min(grid.sizeX ?? grid.size, grid.sizeY ?? grid.size);
    const alpha = underParty ? 0.35 : dim ? 0.6 : 1;
    const ring = new PIXI.Graphics();
    const color = landmark.kind === "viewpoint" ? VIEWPOINT_COLOR : LANDMARK_COLOR;
    disc(ring, c.x, c.y, r, 0x1b1a17, 0.85, color, Math.max(2.5, grid.size * 0.035));
    ring.alpha = alpha;
    this.icons.addChild(ring);
    loadIcon(landmark.icon).then(texture => {
      if (!texture || generation !== this.generation || !this.icons || this.icons.destroyed) return;
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor?.set(0.5);
      sprite.width = sprite.height = r * 1.5;
      sprite.position.set(c.x, c.y);
      if (String(landmark.icon).startsWith("icons/svg/")) sprite.tint = 0xf3e7c9; // Foundry's white icons
      sprite.alpha = alpha;
      this.icons.addChild(sprite);
    });
  }
}
