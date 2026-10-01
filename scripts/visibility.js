/**
 * Hex visibility. Only needs a grid object with getAdjacentOffsets({i, j}), so it works
 * with any Foundry hex orientation and can be tested with a fake grid.
 */

export function hexKey(o) {
  return `${o.i}_${o.j}`;
}

export function parseHexKey(k) {
  const [i, j] = String(k).split("_").map(Number);
  return { i, j };
}

function inBounds(o, b) {
  return o.i >= b.i0 && o.i <= b.i1 && o.j >= b.j0 && o.j <= b.j1;
}

/** Breadth-first hex distances from `start`, out to `maxDist` hexes, within bounds. */
export function hexDistances(grid, start, bounds, maxDist = Infinity) {
  const s = { i: start.i, j: start.j };
  const dist = new Map([[hexKey(s), 0]]);
  const queue = [s];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(hexKey(cur));
    if (d >= maxDist) continue;
    for (const n of grid.getAdjacentOffsets(cur)) {
      const o = { i: n.i, j: n.j };
      if (!inBounds(o, bounds)) continue;
      const k = hexKey(o);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(o);
    }
  }
  return dist;
}

/**
 * Hexes seen from one hex.
 * @param {object} grid
 * @param {{i:number,j:number}} from
 * @param {{i0:number,j0:number,i1:number,j1:number}} bounds
 * @param {object} opts
 * @param {number} opts.sight   Hexes seen around the viewer (1: the hexes next to it)
 * @param {{key:string, reach:number}[]} opts.landmarks   reach: how far away each can be spotted
 * @returns {{seen: Set<string>, landmarks: Map<string, number>}}  landmarks: key → distance in hexes
 */
export function sightFrom(grid, from, bounds, { sight = 1, landmarks = [] } = {}) {
  const maxLandmark = landmarks.reduce((m, l) => Math.max(m, l.reach ?? 0), 0);
  const dist = hexDistances(grid, from, bounds, Math.max(sight, maxLandmark));
  const seen = new Set();
  for (const [k, d] of dist) if (d <= sight) seen.add(k);
  const seenLandmarks = new Map();
  for (const l of landmarks) {
    const d = dist.get(l.key);
    if (d === undefined || d > Math.max(sight, l.reach ?? 0)) continue;
    seen.add(l.key);
    seenLandmarks.set(l.key, d);
  }
  return { seen, landmarks: seenLandmarks };
}

/**
 * What the party sees now (from its current hex), everything it saw along its path, and the
 * landmarks it spotted on the way. From a viewing point the party sees that point's view radius.
 * @param {object} grid
 * @param {{i:number,j:number}[]} path   Hexes passed through; the last entry is the current hex
 * @param {object} bounds
 * @param {object} opts
 * @param {number} opts.sight                    Hexes seen around the party
 * @param {{key:string, reach:number}[]} opts.landmarks
 * @param {Map<string, number>} [opts.viewpoints]  Viewing points: key → hexes seen from there
 * @returns {{visible: Set<string>, passed: Set<string>, spotted: Map<string, {from: {i:number,j:number}, distance: number}>, views: string[]}}
 *   spotted: each landmark seen, with the first hex it was seen from on this path; views: viewing points reached
 */
export function computeVisibility(grid, path, bounds, { sight = 1, landmarks = [], viewpoints = new Map() } = {}) {
  const unique = [];
  for (const o of path) {
    const prev = unique[unique.length - 1];
    if (!prev || prev.i !== o.i || prev.j !== o.j) unique.push({ i: o.i, j: o.j });
  }
  const steps = unique.slice(-60);
  const current = steps[steps.length - 1];
  const passed = new Set();
  const spotted = new Map();
  const views = [];
  let visible = new Set();
  for (const o of steps) {
    const key = hexKey(o);
    const view = viewpoints.get(key);
    if (view && !views.includes(key)) views.push(key);
    const seen = sightFrom(grid, o, bounds, { sight: Math.max(sight, view ?? 0), landmarks });
    for (const k of seen.seen) passed.add(k);
    for (const [k, distance] of seen.landmarks) if (!spotted.has(k)) spotted.set(k, { from: o, distance });
    if (o === current) visible = seen.seen;
  }
  return { visible, passed, spotted, views };
}
