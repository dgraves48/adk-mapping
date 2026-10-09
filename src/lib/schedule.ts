import type { Peak } from "./data";
import type { Route, RoutePeak } from "./db";
import { addDays } from "./dates";
import { closestIndex, dayBreaks, type RouteGeometry } from "./routing";

/**
 * Guess which day of the trip each peak is climbed on. Each campsite stop marked
 * for the night ends a day; with no such stops the nights are spread evenly.
 */
export function guessPeakDays(route: Route, geom: RouteGeometry | null, peaks: Peak[]): Map<string, number> {
  const days = new Map<string, number>();
  if (!geom || route.nights <= 0) {
    route.peaks.forEach((rp) => days.set(rp.peakId, 0));
    return days;
  }
  const breaks = dayBreaks(route.waypoints, geom);
  for (const rp of route.peaks) {
    const peak = peaks.find((x) => x.id === rp.peakId);
    if (!peak) continue;
    const { idx } = closestIndex(geom, peak.lngLat);
    const day = breaks.length
      ? breaks.filter((b) => b < idx).length
      : Math.min(route.nights, Math.floor((geom.dist[idx] / geom.length) * (route.nights + 1)));
    days.set(rp.peakId, day);
  }
  return days;
}

/** Fill peak dates from the start date, keeping any date the user typed in themselves. */
export function autofillPeakDates(route: Route, geom: RouteGeometry | null, peaks: Peak[], force = false): RoutePeak[] {
  if (!route.startDate) return route.peaks;
  const days = guessPeakDays(route, geom, peaks);
  return route.peaks.map((rp) =>
    force || !rp.date || rp.dateAuto ? { ...rp, date: addDays(route.startDate!, days.get(rp.peakId) ?? 0), dateAuto: true } : rp,
  );
}
