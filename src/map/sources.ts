import * as maplibregl from "maplibre-gl";
import mlcontour from "maplibre-contour";
import { Protocol } from "pmtiles";
import { ElevationSampler } from "../lib/elevation";
import { openPack } from "../lib/packs";
import type { StyleOptions } from "./style";

export interface MapSetup {
  style: StyleOptions;
  sampler: ElevationSampler | null;
  offlineBasemap: boolean;
  offlineTerrain: boolean;
  /** extent of the installed topo pack, [w, s, e, n] */
  bounds: [number, number, number, number] | null;
}

const FT = 3.28084;
const CONTOUR_FT = {
  // zoom: [minor, major] contour interval in feet
  10: [400, 2000],
  11: [200, 1000],
  12: [100, 500],
  13: [100, 500],
  14: [50, 250],
  15: [20, 100],
};

let protocol: Protocol | null = null;
let setupCount = 0;

/**
 * Work out map sources: offline packs when installed, otherwise online tiles.
 * Called again whenever packs or settings change.
 */
export async function setupMapSources(tracestrackKey: string | null): Promise<MapSetup> {
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  }
  const n = ++setupCount;
  const style: StyleOptions = { vectorBasemap: false };

  const basemap = await openPack("basemap");
  let bounds: MapSetup["bounds"] = null;
  if (basemap) {
    protocol.add(basemap);
    const h = await basemap.getHeader();
    bounds = [h.minLon, h.minLat, h.maxLon, h.maxLat];
    style.vectorBasemap = true;
  } else if (tracestrackKey) {
    style.raster = {
      tiles: [`https://tile.tracestrack.com/topo__/{z}/{x}/{y}.png?key=${tracestrackKey}`],
      attribution: '© <a href="https://www.tracestrack.com/">Tracestrack</a> © OpenStreetMap',
      maxzoom: 19,
    };
  } else {
    style.raster = {
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) © OpenStreetMap',
      maxzoom: 17,
    };
  }

  const terrain = await openPack("terrain");
  let dem: InstanceType<typeof mlcontour.DemSource>;
  if (terrain) {
    const h = await terrain.getHeader();
    style.demBounds = [h.minLon, h.minLat, h.maxLon, h.maxLat];
    // Contours are computed on the main thread so they can read tiles straight from the pack.
    dem = new mlcontour.DemSource({ url: `pmdem${n}://{z}/{x}/{y}`, id: `dem${n}`, encoding: "terrarium", maxzoom: 13, worker: false });
    (dem.manager as unknown as { getTile: unknown }).getTile = async (url: string) => {
      const [z, x, y] = url.split("://")[1].split("/").map(Number);
      const tile = await terrain.getZxy(z, x, y);
      if (!tile) throw new Error(`no terrain tile ${url}`);
      return { data: new Blob([tile.data], { type: "image/webp" }) };
    };
  } else {
    dem = new mlcontour.DemSource({
      url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      id: `dem${n}`,
      encoding: "terrarium",
      maxzoom: 13,
      worker: true,
    });
  }
  dem.setupMaplibre(maplibregl);
  style.demTiles = dem.sharedDemProtocolUrl;
  style.contourTiles = dem.contourProtocolUrl({
    multiplier: FT,
    thresholds: CONTOUR_FT,
    contourLayer: "contours",
    elevationKey: "ele",
    levelKey: "level",
    extent: 4096,
    buffer: 1,
  });

  return {
    style,
    sampler: terrain ? new ElevationSampler(terrain) : null,
    offlineBasemap: !!basemap,
    offlineTerrain: !!terrain,
    bounds,
  };
}
