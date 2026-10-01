import { MOD } from "./constants.js";
import * as R from "./rules.js";
import { hexKey } from "./visibility.js";
import { queueRefresh } from "./sync.js";
import { escapeHTML } from "./chat.js";

function readyScene() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene) return null;
  if (!scene.getFlag(MOD, "enabled")) {
    ui.notifications.warn("Turn this scene into a hexcrawl map first (Hexcrawl tracker → GM tab).");
    return null;
  }
  return scene;
}

const wholeHexes = (text, fallback) => {
  const n = Math.floor(Number(String(text ?? "").trim()));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function readLandmarkForm(form) {
  const el = name => form.elements.namedItem(name);
  const kind = el("hcKind")?.value === "viewpoint" ? "viewpoint" : "poi";
  const far = !!el("hcFar")?.checked;
  return {
    name: String(el("hcName")?.value ?? "").trim(),
    kind,
    sight: far ? wholeHexes(el("hcSight")?.value, R.DEFAULT_FAR_SIGHT) : null,
    view: kind === "viewpoint" ? wholeHexes(el("hcView")?.value, R.DEFAULT_VIEW) : null,
    known: !!el("hcKnown")?.checked,
    icon: readIcon(el("hcIcon"), el("hcIconPick"))
  };
}

/** Show the viewing-point field only for viewing points, and the distance only when seen from afar. */
function wireKindFields(root, dialog) {
  if (!(root instanceof HTMLElement)) return;
  // Grow or shrink the window to fit, so its buttons never end up off screen.
  const fit = () => {
    try { dialog?.setPosition?.({ height: "auto" }); }
    catch { /* not an application window */ }
  };
  const kind = root.querySelector("select[name=hcKind]");
  const far = root.querySelector("input[name=hcFar]");
  const sight = root.querySelector("input[name=hcSight]");
  const update = () => {
    for (const group of root.querySelectorAll("[data-hc-viewpoint]")) group.hidden = kind?.value !== "viewpoint";
    if (sight && far) sight.disabled = !far.checked;
    fit();
  };
  kind?.addEventListener("change", update);
  far?.addEventListener("change", update);
  update();
}

/** The chosen icon: a typed or browsed path wins, then the list choice (works even if the picker isn't wired). */
function readIcon(input, pick) {
  const typed = String(input?.value ?? "").trim();
  const initial = String(input?.dataset?.initial ?? "");
  const picked = String(pick?.value ?? "");
  if (typed !== initial) return typed;
  if (picked !== initial) return picked;
  return typed;
}

/** Foundry's map-note icons, as [label, path] pairs. */
export function landmarkIcons() {
  const icons = CONFIG.JournalEntry?.noteIcons ?? {};
  return Object.entries(icons)
    .map(([label, path]) => [game.i18n?.localize?.(label) ?? label, path])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

const DEFAULT_ICON = "icons/svg/tower.svg";

/** A grid of icon previews. Each tile is a radio button, so picking works without any script. */
function iconGrid(current) {
  const icons = landmarkIcons();
  const known = icons.some(([, path]) => path === current);
  const tile = (value, label, img) => `
    <label class="hc-icon-tile" data-tooltip="${escapeHTML(label)}">
      <input type="radio" name="hcIconPick" value="${escapeHTML(value)}"${value === current ? " checked" : ""}>
      <span class="hc-icon-face">${img ? `<img src="${escapeHTML(img)}" alt="">` : `<i class="fa-solid fa-ban"></i>`}</span>
      <span class="hc-icon-name">${escapeHTML(label)}</span>
    </label>`;
  const tiles = [tile("", "No icon", null)];
  if (current && !known) tiles.push(tile(current, "Custom", current));
  for (const [label, path] of icons) tiles.push(tile(path, label, path));
  return `<div class="hc-icon-grid" role="radiogroup" aria-label="Landmark icon">${tiles.join("")}</div>`;
}

/** Keep the icon grid and the image path in step, and hook up the file browser. */
function wireIconPicker(root) {
  if (!(root instanceof HTMLElement)) return;
  const input = root.querySelector("input[name=hcIcon]");
  const radios = [...root.querySelectorAll("input[name=hcIconPick]")];
  const browse = root.querySelector("button.hc-lm-browse");
  if (!input) return;
  const selectMatching = () => { for (const r of radios) r.checked = r.value === input.value; };
  for (const r of radios) r.addEventListener("change", () => { if (r.checked) input.value = r.value; });
  input.addEventListener("change", selectMatching);
  browse?.addEventListener("click", ev => {
    ev.preventDefault();
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!FP) return;
    const fp = new FP({ type: "image", current: input.value, callback: path => { input.value = path; selectMatching(); } });
    if (typeof fp.browse === "function") fp.browse();
    else fp.render(true);
  });
}

/** Create, edit or remove the landmark in the hex at a canvas point. */
export async function editLandmarkAt(point) {
  const scene = readyScene();
  if (!scene) return;
  const key = hexKey(canvas.grid.getOffset(point));
  const list = foundry.utils.deepClone(scene.getFlag(MOD, "landmarks") ?? []);
  const existing = list.find(l => l.key === key);
  const icon = existing ? (existing.icon ?? "") : (landmarkIcons().some(([, p]) => p === DEFAULT_ICON) ? DEFAULT_ICON : "");

  const lm = R.normalizeLandmark(existing ?? {});
  const discovered = new Set(scene.getFlag(MOD, "discovered") ?? []);
  const kindOptions = Object.entries(R.LANDMARK_KINDS)
    .map(([k, v]) => `<option value="${k}"${k === lm.kind ? " selected" : ""}>${escapeHTML(v.label)}</option>`).join("");

  const content = `
    <div class="form-group">
      <label>Name</label>
      <div class="form-fields"><input type="text" name="hcName" value="${escapeHTML(existing?.name)}" placeholder="The Drowned Tower" autofocus></div>
    </div>
    <div class="form-group">
      <label>Type</label>
      <div class="form-fields"><select name="hcKind">${kindOptions}</select></div>
      <p class="hint">A point of interest is something the party can go to: a cave, a bridge, a lair, a quest, a tower. A viewing point, like a mountain top, lets the party see far across the map.</p>
    </div>
    <div class="form-group" data-hc-viewpoint${lm.kind === "viewpoint" ? "" : " hidden"}>
      <label>Hexes seen from here</label>
      <div class="form-fields"><input type="number" name="hcView" min="1" step="1" value="${lm.view ?? R.DEFAULT_VIEW}"><span class="units">hexes</span></div>
      <p class="hint">When the party reaches this hex, it sees this many hexes in every direction, and discovers the points of interest there.</p>
    </div>
    <div class="form-group">
      <label>Seen from far away</label>
      <div class="form-fields">
        <input type="checkbox" name="hcFar" ${lm.sight ? "checked" : ""}>
        <input type="number" name="hcSight" min="2" step="1" value="${lm.sight ?? R.DEFAULT_FAR_SIGHT}" aria-label="Hexes it can be seen from"${lm.sight ? "" : " disabled"}><span class="units">hexes</span>
      </div>
      <p class="hint">Otherwise the party finds it when it's next to it.</p>
    </div>
    <div class="form-group stacked">
      <label>Icon</label>
      ${iconGrid(icon)}
    </div>
    <div class="form-group">
      <label>Or your own image</label>
      <div class="form-fields">
        <input type="text" name="hcIcon" value="${escapeHTML(icon)}" data-initial="${escapeHTML(icon)}" placeholder="path/to/image.webp">
        <button type="button" class="hc-lm-browse" data-tooltip="Choose an image"><i class="fa-solid fa-file-image"></i></button>
      </div>
    </div>
    <div class="form-group">
      <label>The party knows it</label>
      <div class="form-fields"><input type="checkbox" name="hcKnown" ${lm.known ? "checked" : ""}></div>
      <p class="hint">Its icon and name show on the map from the start (a home town, a place on their map). Otherwise they appear when the party first finds it.</p>
    </div>`;

  const buttons = [{ action: "save", label: existing ? "Save" : "Add landmark", icon: "fa-solid fa-tower-observation",
    default: true, callback: (event, button) => readLandmarkForm(button.form) }];
  if (existing) buttons.push({ action: "remove", label: "Remove", icon: "fa-solid fa-trash" });
  buttons.push({ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: existing ? "Edit landmark" : "New landmark", icon: "fa-solid fa-tower-observation" },
    content, buttons, rejectClose: false,
    classes: ["explorers-hexcrawl-landmark"],
    position: { width: 540 },
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      wireIconPicker(root);
      wireKindFields(root, dialog);
    }
  });

  const updates = {};
  if (result === "remove" && existing) {
    list.splice(list.indexOf(existing), 1);
    if (discovered.delete(key)) updates[`flags.${MOD}.discovered`] = [...discovered].sort();
  }
  else if (result && typeof result === "object") {
    const entry = { key, name: result.name || (result.kind === "viewpoint" ? "Viewing point" : "Landmark"),
      kind: result.kind, sight: result.sight, view: result.view, icon: result.icon, known: result.known };
    if (existing) {
      Object.assign(existing, entry);
      for (const old of ["peak", "range"]) delete existing[old];
    }
    else list.push(entry);
  }
  else return;

  updates[`flags.${MOD}.landmarks`] = list;
  await scene.update(updates);
  queueRefresh(scene);
}

/** Reveal or re-hide the hex at a canvas point by hand. */
export async function toggleExploredAt(point) {
  const scene = readyScene();
  if (!scene) return;
  const key = hexKey(canvas.grid.getOffset(point));
  const revealed = new Set(scene.getFlag(MOD, "revealed") ?? []);
  if (revealed.has(key)) revealed.delete(key);
  else revealed.add(key);
  await scene.setFlag(MOD, "revealed", [...revealed].sort());
}

/** Wait for one click on the map, then hand the clicked point to `onPick`. */
export function pickHexOnCanvas(onPick) {
  if (!canvas?.ready || !canvas.stage) return;
  ui.notifications.info("Click a hex on the map to mark or edit its landmark. Right-click to cancel.");
  const stage = canvas.stage;
  const listener = event => {
    stage.off("pointerdown", listener);
    if (event.button !== 0) return;
    const p = event.getLocalPosition(stage);
    onPick({ x: p.x, y: p.y });
  };
  stage.on("pointerdown", listener);
}
