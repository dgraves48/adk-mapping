export type LngLat = [number, number];

const R = 6371008.8; // mean earth radius, m
const RAD = Math.PI / 180;

export const M_PER_MILE = 1609.344;
export const FT_PER_M = 3.28084;

export function distance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Project p onto segment ab using a local equirectangular approximation
 * (accurate to well under a metre over trail-segment lengths).
 * Returns the fraction t along ab and the distance from p in metres.
 */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { t: number; dist: number; point: LngLat } {
  const kx = Math.cos(p[1] * RAD);
  const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * kx, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { t, dist: distance(p, point), point };
}

/** Closest approach of point p to a polyline: distance (m) and distance along the line (m). */
export function closestOnLine(p: LngLat, line: LngLat[]): { dist: number; along: number } {
  let best = { dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = distance(line[i], line[i + 1]);
    const pr = projectOnSegment(p, line[i], line[i + 1]);
    if (pr.dist < best.dist) best = { dist: pr.dist, along: acc + pr.t * seg };
    acc += seg;
  }
  return best;
}

/** Bounding box [w, s, e, n] around p, padded by `metres`. */
export function bboxAround(p: LngLat, metres: number): [number, number, number, number] {
  const dLat = metres / 111320;
  const dLon = metres / (111320 * Math.cos(p[1] * RAD));
  return [p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat];
}
