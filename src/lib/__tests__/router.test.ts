import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TrailRouter, type TrailData } from "../router";
import { buildGeometry, computeLeg, snapPoint } from "../routing";
import { M_PER_MILE, FT_PER_M, type LngLat } from "../geo";

const data: TrailData = JSON.parse(readFileSync("public/data/trails.json", "utf8"));
const peaks = JSON.parse(readFileSync("public/data/peaks.json", "utf8")).tracked;
const router = new TrailRouter(data);
const peak = (id: string): LngLat => peaks.find((p: any) => p.id === id).lngLat;
const LOJ: LngLat = [-73.9583, 44.1830]; // Adirondak Loj / High Peaks Info Center lot

describe("TrailRouter", () => {
  it("routes Adirondak Loj to Marcy at about 7.4 miles", () => {
    const leg = computeLeg(router, snapPoint(router, LOJ).lngLat, peak("mount-marcy"));
    const mi = leg.length / M_PER_MILE;
    console.log("Loj→Marcy", mi.toFixed(2), "mi");
    expect(mi).toBeGreaterThan(6.8);
    expect(mi).toBeLessThan(8.0);
  });

  it("computes a Cascade + Porter out-and-back with plausible gain", async () => {
    const th = snapPoint(router, [-73.8869, 44.2187]).lngLat; // Cascade trailhead on Rt 73
    const wps = [th, peak("cascade-mountain"), peak("porter-mountain"), th].map((p, i) => ({ id: String(i), lngLat: p, snapped: true }));
    const g = (await buildGeometry(router, wps, null, new Map()))!;
    console.log("Cascade+Porter", (g.length / M_PER_MILE).toFixed(2), "mi", Math.round(g.gain * FT_PER_M), "ft");
    expect(g.length / M_PER_MILE).toBeGreaterThan(5);
    expect(g.length / M_PER_MILE).toBeLessThan(7.5);
    expect(g.gain * FT_PER_M).toBeGreaterThan(1800);
  });

  it("draws a straight line to a point placed with snap off", () => {
    const a = snapPoint(router, LOJ).lngLat, b = peak("mount-marcy");
    const leg = computeLeg(router, a, b, true);
    expect(leg.length / M_PER_MILE).toBeLessThan(5.5); // crow-flies, not the 7 mi trail
    expect(leg.coords[0]).toEqual(a);
    expect(leg.coords[leg.coords.length - 1]).toEqual(b);
  });

  it("goes off-trail to a point that isn't on a trail", () => {
    const off: LngLat = [-73.93, 44.115]; // ~500 m off the Marcy trail
    const leg = computeLeg(router, snapPoint(router, LOJ).lngLat, off);
    expect(leg.coords[leg.coords.length - 1]).toEqual(off);
  });
});
