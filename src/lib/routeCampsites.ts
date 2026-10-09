import type { Campsite } from "./data";
import type { Route, RouteCampsite } from "./db";

/** Campsites that are stops on the route line, in route order, without repeats. */
export function stopCampsites(route: Route, all: Campsite[]): RouteCampsite[] {
  const out: RouteCampsite[] = [];
  for (const w of route.waypoints) {
    if (!w.campsiteId || out.some((c) => c.id === w.campsiteId)) continue;
    const c = all.find((x) => x.id === w.campsiteId);
    out.push({ id: w.campsiteId, name: c?.name ?? "Campsite" });
  }
  return out;
}

/** Name-only campsites. Older routes listed campsites without stops; those are kept here. */
export function extraCampsites(route: Route): RouteCampsite[] {
  return route.extraCampsites ?? route.campsites.filter((c) => !c.id || !route.waypoints.some((w) => w.campsiteId === c.id));
}

/** Route with `campsites` rebuilt from its stops plus extras. */
export function syncCampsites(route: Route, all: Campsite[]): Route {
  const extras = extraCampsites(route);
  const stops = stopCampsites(route, all);
  return { ...route, extraCampsites: extras, campsites: [...stops, ...extras.filter((e) => !stops.some((s) => s.id && s.id === e.id))] };
}
