import type { FeatureCollection } from "geojson";
import type { Campsite, OtherPeak, Peak, Trailhead } from "./data";
import type { TrailData } from "./router";

export function trailsGeoJSON(t: TrailData): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: t.ways
      .filter((w) => w.k !== "road")
      .map((w) => ({
        type: "Feature",
        properties: { k: w.k, n: w.n },
        geometry: { type: "LineString", coordinates: w.i.map((i) => [t.coords[2 * i], t.coords[2 * i + 1]]) },
      })),
  };
}

export function pointsGeoJSON<T extends { lngLat: [number, number] }>(
  items: T[],
  props: (x: T) => Record<string, unknown>,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((x) => ({
      type: "Feature",
      properties: props(x),
      geometry: { type: "Point", coordinates: x.lngLat },
    })),
  };
}

export const peaksGeoJSON = (peaks: Peak[], done: Set<string>) =>
  pointsGeoJSON(peaks, (p) => ({ id: p.id, name: p.name, elevationFt: p.elevationFt, done: done.has(p.id) }));
export const otherPeaksGeoJSON = (peaks: OtherPeak[]) =>
  pointsGeoJSON(peaks, (p) => ({ name: p.name, elevationFt: p.elevationFt }));
export const campsitesGeoJSON = (c: Campsite[]) =>
  pointsGeoJSON(c, (x) => ({ id: x.id, name: x.name, kind: x.kind, mine: !!x.mine }));
export const trailheadsGeoJSON = (t: Trailhead[]) => pointsGeoJSON(t, (x) => ({ id: x.id, name: x.name }));
