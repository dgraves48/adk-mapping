import { describe, expect, it } from "vitest";
import { autofillPeakDates } from "../schedule";
import { isWinter } from "../dates";
import type { Route } from "../db";
import { dayBreaks, dayStats, type RouteGeometry, type Waypoint } from "../routing";

// A straight 10 km west→east route: start, campsite stop in the middle, finish.
const coords: [number, number][] = Array.from({ length: 11 }, (_, i) => [-74 + i * 0.0125, 44.1]);
const geom: RouteGeometry = {
  coords,
  ele: coords.map((_, i) => (i <= 5 ? i * 100 : 500 - (i - 5) * 50)),
  dist: coords.map((_, i) => i * 1000),
  waypointIdx: [0, 5, 10],
  length: 10000,
  gain: 0,
  loss: 0,
};
const peaks = [
  { id: "a", name: "A", official: true, elevationFt: 4000, lngLat: [-73.99, 44.1] as [number, number] },
  { id: "b", name: "B", official: true, elevationFt: 4000, lngLat: [-73.88, 44.1] as [number, number] },
];
const wps = (night?: boolean): Waypoint[] => [
  { id: "s", lngLat: coords[0], snapped: true },
  { id: "c", lngLat: coords[5], snapped: true, campsiteId: "camp", night },
  { id: "e", lngLat: coords[10], snapped: true },
];
const base: Route = {
  id: "r", name: "t", waypoints: wps(), peaks: [{ peakId: "a" }, { peakId: "b" }], campsites: [],
  nights: 1, miles: 0, gainFt: 0, completed: true, startDate: "2026-08-14", endDate: "2026-08-15", notes: "", updatedAt: "",
};

describe("days", () => {
  it("a campsite stop marked for the night ends day 1", () => {
    expect(dayBreaks(wps(), geom)).toEqual([5]);
    expect(dayBreaks(wps(false), geom)).toEqual([]);
  });
  it("splits miles and climb per day", () => {
    const d = dayStats(geom, [5]);
    expect(d.map((x) => +x.miles.toFixed(2))).toEqual([3.11, 3.11]);
    expect(Math.round(d[0].gainFt)).toBe(1640); // 500 m up on day 1
    expect(Math.round(d[1].lossFt)).toBe(820); // 250 m down on day 2
  });
});

describe("autofillPeakDates", () => {
  it("puts peaks after a night stop on the next day", () => {
    expect(autofillPeakDates(base, geom, peaks).map((p) => p.date)).toEqual(["2026-08-14", "2026-08-15"]);
  });
  it("keeps dates the user typed", () => {
    const r = { ...base, peaks: [{ peakId: "a", date: "2026-08-20", dateAuto: false }, { peakId: "b" }] };
    expect(autofillPeakDates(r, geom, peaks)[0].date).toBe("2026-08-20");
  });
  it("spreads nights evenly when there are no campsite stops", () => {
    const r = { ...base, waypoints: [wps()[0], wps()[2]] };
    const g = { ...geom, waypointIdx: [0, 10] };
    expect(autofillPeakDates(r, g, peaks).map((p) => p.date)).toEqual(["2026-08-14", "2026-08-15"]);
  });
});

describe("isWinter", () => {
  it("uses Dec 21 – Mar 20", () => {
    expect(["2026-12-21", "2027-01-15", "2027-03-20"].every(isWinter)).toBe(true);
    expect(["2026-12-20", "2027-03-21", "2026-07-04"].some(isWinter)).toBe(false);
  });
});
