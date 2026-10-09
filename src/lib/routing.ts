import { closestOnLine, distance, FT_PER_M, M_PER_MILE, type LngLat } from "./geo";
import type { TrailRouter } from "./router";
import type { ElevationSampler } from "./elevation";

export interface Waypoint {
  id: string;
  lngLat: LngLat;
  /** Snapped onto a trail when placed. Off-trail points are reached via the closest trail point. */
  snapped: boolean;
  /** Placed with snapping off: legs to and from it are straight lines. */
  free?: boolean;
  /** This point is a stop at a campsite. */
  campsiteId?: string;
  /** For a campsite stop: you spend the night here, so a new day starts. Defaults to true. */
  night?: boolean;
}

export interface Leg {
  coords: LngLat[];
  ele: number[];
  length: number;
}

export interface RouteGeometry {
  coords: LngLat[];
  ele: number[];
  /** cumulative distance (m) per coord */
  dist: number[];
  /** index into coords where each waypoint sits */
  waypointIdx: number[];
  length: number;
  gain: number;
  loss: number;
}

const ON_TRAIL_M = 3;
const SNAP_MAX_M = 1000;
const OFFTRAIL_STEP_M = 30;

/** Snap a clicked position onto the nearest trail (within 1 km), if there is one. */
export function snapPoint(router: TrailRouter, p: LngLat): { lngLat: LngLat; snapped: boolean } {
  const s = router.nearest(p, SNAP_MAX_M);
  return s ? { lngLat: s.point, snapped: true } : { lngLat: p, snapped: false };
}

/** Straight off-trail line, densified so elevation can be sampled along it. */
function straight(a: LngLat, b: LngLat, eleA: number, eleB: number): Leg {
  const len = distance(a, b);
  const steps = Math.max(1, Math.ceil(len / OFFTRAIL_STEP_M));
  const coords: LngLat[] = [];
  const ele: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    coords.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    ele.push(eleA + (eleB - eleA) * f);
  }
  return { coords, ele, length: len };
}

function concat(parts: Leg[]): Leg {
  const coords: LngLat[] = [];
  const ele: number[] = [];
  let length = 0;
  for (const p of parts) {
    const skip = coords.length ? 1 : 0;
    coords.push(...p.coords.slice(skip));
    ele.push(...p.ele.slice(skip));
    length += p.length;
  }
  return { coords, ele, length };
}

/**
 * Path between two waypoints: along trails, with straight off-trail spurs at
 * either end when a waypoint isn't on a trail. `direct` (a point placed with
 * snapping off) makes the whole leg a straight line.
 */
export function computeLeg(router: TrailRouter, a: LngLat, b: LngLat, direct = false): Leg {
  const sa = router.nearest(a, 20000);
  const sb = router.nearest(b, 20000);
  if (!sa || !sb) return straight(a, b, 0, 0);
  if (direct) return straight(a, b, router.eleAt(sa), router.eleAt(sb));
  const offA = sa.dist > ON_TRAIL_M;
  const offB = sb.dist > ON_TRAIL_M;
  const eA = router.eleAt(sa), eB = router.eleAt(sb);
  // Two off-trail points closer to each other than to the trails: go direct.
  if (offA && offB && distance(a, b) <= sa.dist + sb.dist) return straight(a, b, eA, eB);

  const path = router.route(sa, sb);
  if (!path) return straight(a, b, eA, eB);
  const parts: Leg[] = [];
  if (offA) parts.push(straight(a, sa.point, eA, eA));
  parts.push(path);
  if (offB) parts.push(straight(sb.point, b, eB, eB));
  return concat(parts);
}

/** Assemble legs into one route, refine off-trail elevations, and compute stats. */
export async function buildGeometry(
  router: TrailRouter,
  waypoints: Waypoint[],
  sampler: ElevationSampler | null,
  legCache: Map<string, Leg>,
): Promise<RouteGeometry | null> {
  if (waypoints.length < 2) return null;
  const coords: LngLat[] = [waypoints[0].lngLat];
  const ele: number[] = [0];
  const waypointIdx = [0];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i].lngLat, b = waypoints[i + 1].lngLat;
    const direct = !!(waypoints[i].free || waypoints[i + 1].free);
    const key = `${a[0]},${a[1]}|${b[0]},${b[1]}|${direct}`;
    let leg = legCache.get(key);
    if (!leg) {
      leg = computeLeg(router, a, b, direct);
      legCache.set(key, leg);
    }
    if (i === 0) ele[0] = leg.ele[0];
    coords.push(...leg.coords.slice(1));
    ele.push(...leg.ele.slice(1));
    waypointIdx.push(coords.length - 1);
  }

  // Off-trail stretches only have interpolated elevations; use the DEM if we have it.
  if (sampler) {
    const offIdx: number[] = [];
    for (let i = 0; i < coords.length; i++) {
      const s = router.nearest(coords[i], ON_TRAIL_M);
      if (!s) offIdx.push(i);
    }
    if (offIdx.length) {
      const sampled = await sampler.sample(offIdx.map((i) => coords[i]));
      offIdx.forEach((ci, k) => {
        if (sampled[k] != null) ele[ci] = sampled[k]!;
      });
    }
  }

  const dist = [0];
  for (let i = 1; i < coords.length; i++) dist.push(dist[i - 1] + distance(coords[i - 1], coords[i]));
  const { gain, loss } = climb(ele);
  return { coords, ele, dist, waypointIdx, length: dist[dist.length - 1], gain, loss };
}

/** Total climb with a small hysteresis so DEM noise doesn't inflate the numbers. */
export function climb(ele: number[], threshold = 4): { gain: number; loss: number } {
  let gain = 0, loss = 0;
  let ref = ele[0] ?? 0;
  for (const e of ele) {
    const d = e - ref;
    if (d >= threshold) {
      gain += d;
      ref = e;
    } else if (d <= -threshold) {
      loss -= d;
      ref = e;
    }
  }
  return { gain, loss };
}

/** Coordinate indices where a day ends: campsite stops marked for the night (not the final point). */
export function dayBreaks(waypoints: Waypoint[], geom: RouteGeometry): number[] {
  return waypoints
    .map((w, i) => (i > 0 && i < waypoints.length - 1 && w.campsiteId && w.night !== false ? geom.waypointIdx[i] : -1))
    .filter((i) => i >= 0);
}

export interface DayStats {
  day: number; // 0-based
  from: number; // coord index
  to: number;
  miles: number;
  gainFt: number;
  lossFt: number;
}

export function dayStats(geom: RouteGeometry, breaks: number[]): DayStats[] {
  const edges = [0, ...breaks, geom.coords.length - 1];
  const out: DayStats[] = [];
  for (let d = 0; d < edges.length - 1; d++) {
    const from = edges[d], to = edges[d + 1];
    const { gain, loss } = climb(geom.ele.slice(from, to + 1));
    out.push({ day: d, from, to, miles: (geom.dist[to] - geom.dist[from]) / M_PER_MILE, gainFt: gain * FT_PER_M, lossFt: loss * FT_PER_M });
  }
  return out;
}

/** Index of the route coordinate closest to p, and its distance in metres. */
export function closestIndex(geom: RouteGeometry, p: LngLat): { idx: number; dist: number } {
  let idx = 0, best = Infinity;
  geom.coords.forEach((c, i) => {
    const d = distance(c, p);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  return { idx, dist: best };
}

/** Which leg (0-based, between waypoint i and i+1) contains coordinate index `idx`. */
export function legOfIndex(geom: RouteGeometry, idx: number): number {
  let leg = 0;
  while (leg < geom.waypointIdx.length - 2 && geom.waypointIdx[leg + 1] <= idx) leg++;
  return leg;
}

export interface Located {
  id: string;
  name: string;
  lngLat: LngLat;
}

/** Features within `radius` metres of the route, ordered by first approach along it. */
export function alongRoute<T extends Located>(geom: RouteGeometry, items: T[], radius: number) {
  const out: { item: T; along: number; dist: number }[] = [];
  for (const item of items) {
    const c = closestOnLine(item.lngLat, geom.coords);
    if (c.dist <= radius) out.push({ item, along: c.along, dist: c.dist });
  }
  return out.sort((a, b) => a.along - b.along);
}

/** Keep roughly every 25 m of the line for the all-routes overview. */
export function thin(coords: LngLat[]): [number, number][] {
  const out: [number, number][] = [];
  let last: LngLat | null = null;
  for (const c of coords) {
    if (!last || Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) > 0.00025) {
      out.push([+c[0].toFixed(5), +c[1].toFixed(5)]);
      last = c;
    }
  }
  const end = coords[coords.length - 1];
  if (end && out.length && (out[out.length - 1][0] !== +end[0].toFixed(5) || out[out.length - 1][1] !== +end[1].toFixed(5)))
    out.push([+end[0].toFixed(5), +end[1].toFixed(5)]);
  return out;
}
