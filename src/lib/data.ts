import type { LngLat } from "./geo";
import type { TrailData } from "./router";

export interface Peak {
  id: string;
  name: string;
  official: boolean;
  elevationFt: number;
  lngLat: LngLat;
}
export interface OtherPeak {
  name: string;
  elevationFt: number;
  lngLat: LngLat;
}
export interface Campsite {
  id: string;
  name: string;
  kind: "campsite" | "lean-to" | "hut";
  lngLat: LngLat;
  /** added by the user rather than from OpenStreetMap */
  mine?: boolean;
  notes?: string;
}
export interface Trailhead {
  id: string;
  name: string;
  lngLat: LngLat;
}

export interface CoreData {
  trails: TrailData;
  peaks: Peak[];
  otherPeaks: OtherPeak[];
  campsites: Campsite[];
  trailheads: Trailhead[];
}

async function get<T>(name: string): Promise<T> {
  const r = await fetch(`/data/${name}`);
  if (!r.ok) throw new Error(`failed to load ${name}`);
  return r.json();
}

export async function loadCoreData(): Promise<CoreData> {
  const [trails, peaks, campsites, trailheads] = await Promise.all([
    get<TrailData>("trails.json"),
    get<{ tracked: Peak[]; other: OtherPeak[] }>("peaks.json"),
    get<Campsite[]>("campsites.json"),
    get<Trailhead[]>("trailheads.json"),
  ]);
  return { trails, peaks: peaks.tracked, otherPeaks: peaks.other, campsites, trailheads };
}
