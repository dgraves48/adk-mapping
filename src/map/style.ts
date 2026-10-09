import { layers as basemapLayers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export interface StyleOptions {
  /** Offline vector basemap available (pmtiles://basemap) */
  vectorBasemap: boolean;
  /** Online raster fallback when there is no vector basemap */
  raster?: { tiles: string[]; attribution: string; maxzoom: number };
  /** DEM tile URL for hillshade (terrarium) */
  demTiles?: string;
  /** maplibre-contour vector tile URL */
  contourTiles?: string;
  /** extent of the DEM tiles, [w, s, e, n] */
  demBounds?: [number, number, number, number];
}

export const COLORS = {
  trail: "#c62828",
  herd: "#c62828",
  track: "#8d6e63",
  contour: "#a1887f",
  contourLabel: "#8d6e63",
  water: "#a5c8e8",
  route: "#1565c0",
  routeCasing: "#ffffff",
  peakDone: "#1b7a2e",
  peakTodo: "#37474f",
  mine: "#00838f",
};

/** Protomaps "light" tuned toward a topo look: warmer land, greener forest, bluer water. */
function topoFlavor(): Flavor {
  const f: Flavor = {
    ...namedFlavor("light"),
    background: "#f4f1e8",
    earth: "#f4f1e8",
    park_a: "#dfe9d0",
    park_b: "#d3e2c0",
    wood_a: "#cfe0bd",
    wood_b: "#c2d8ad",
    scrub_a: "#dde8cc",
    scrub_b: "#d5e3c2",
    water: COLORS.water,
  };
  delete f.pois;
  return f;
}

const DROP = new Set(["roads_oneway", "roads_shields", "roads_other", "roads_tunnels_other", "roads_bridges_other"]);

function vectorBase(): LayerSpecification[] {
  return basemapLayers("protomaps", topoFlavor(), { lang: "en" })
    .filter((l) => !DROP.has(l.id))
    .map((l) => {
      // We ship no sprite sheet; strip the few icon references.
      if (l.type === "symbol" && l.layout && "icon-image" in l.layout) {
        const { ["icon-image"]: _, ...layout } = l.layout as Record<string, unknown>;
        return { ...l, layout } as LayerSpecification;
      }
      return l;
    });
}

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Medium"];
const FONT_ITALIC = ["Noto Sans Italic"];

function terrainLayers(o: StyleOptions): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  if (o.demTiles) {
    out.push({
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      paint: {
        "hillshade-exaggeration": 0.45,
        "hillshade-shadow-color": "#5d5345",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#5d5345",
      },
    });
  }
  if (o.contourTiles) {
    out.push(
      {
        id: "contours",
        type: "line",
        source: "contours",
        "source-layer": "contours",
        paint: {
          "line-color": COLORS.contour,
          "line-opacity": ["case", [">", ["get", "level"], 0], 0.85, 0.5],
          "line-width": ["case", [">", ["get", "level"], 0], 1.1, 0.5],
        },
      },
      {
        id: "contour-labels",
        type: "symbol",
        source: "contours",
        "source-layer": "contours",
        filter: [">", ["get", "level"], 0],
        layout: {
          "symbol-placement": "line",
          "text-field": ["concat", ["number-format", ["get", "ele"], {}], "'"],
          "text-font": FONT,
          "text-size": 10,
          "text-padding": 40,
        },
        paint: { "text-color": COLORS.contourLabel, "text-halo-color": "#f4f1e8", "text-halo-width": 1.5 },
      },
    );
  }
  return out;
}

/** Trails, campsites, peaks, trailheads from the core data (GeoJSON sources added by MapView). */
export function overlayLayers(): LayerSpecification[] {
  return [
    {
      id: "trails-track",
      type: "line",
      source: "trails",
      filter: ["==", ["get", "k"], "track"],
      minzoom: 11,
      paint: { "line-color": COLORS.track, "line-width": 1.4, "line-dasharray": [4, 2] },
    },
    {
      id: "trails-herd",
      type: "line",
      source: "trails",
      filter: ["==", ["get", "k"], "herd"],
      minzoom: 11,
      paint: { "line-color": COLORS.herd, "line-width": 1.3, "line-dasharray": [1, 2] },
    },
    {
      id: "trails",
      type: "line",
      source: "trails",
      filter: ["==", ["get", "k"], "trail"],
      paint: {
        "line-color": COLORS.trail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2, 16, 3],
        "line-dasharray": [3, 1.5],
      },
    },
    {
      id: "trail-labels",
      type: "symbol",
      source: "trails",
      filter: ["all", ["has", "n"], ["!=", ["get", "k"], "road"]],
      minzoom: 13,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "n"],
        "text-font": FONT_ITALIC,
        "text-size": 11,
        "text-offset": [0, 0.8],
      },
      paint: { "text-color": "#8e2020", "text-halo-color": "#fff", "text-halo-width": 1.5 },
    },
    {
      id: "trailheads",
      type: "symbol",
      source: "trailheads",
      minzoom: 11,
      layout: {
        "icon-image": "trailhead",
        "icon-allow-overlap": true,
        "text-field": ["step", ["zoom"], "", 13, ["get", "name"]],
        "text-font": FONT,
        "text-size": 10,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#1a3d6e", "text-halo-color": "#fff", "text-halo-width": 1.5 },
    },
    {
      id: "campsites",
      type: "symbol",
      source: "campsites",
      minzoom: 11,
      layout: {
        "icon-image": [
          "case",
          ["get", "mine"],
          ["match", ["get", "kind"], "lean-to", "leanto-mine", "campsite-mine"],
          ["match", ["get", "kind"], "lean-to", "leanto", "campsite"],
        ],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["case", ["get", "mine"], 1, 0],
        // your own sites are labelled from further out
        "text-field": ["step", ["zoom"], "", 12, ["case", ["get", "mine"], ["get", "name"], ""], 14, ["get", "name"]],
        "text-font": FONT,
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": ["case", ["get", "mine"], COLORS.mine, "#6d4c41"],
        "text-halo-color": "#fff",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "other-peaks",
      type: "symbol",
      source: "other-peaks",
      minzoom: 11,
      layout: {
        "icon-image": "peak-other",
        "text-field": ["concat", ["get", "name"], "\n", ["number-format", ["get", "elevationFt"], {}], "'"],
        "text-font": FONT,
        "text-size": 10,
        "text-offset": [0, 0.7],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": "#4e4e4e", "text-halo-color": "#fff", "text-halo-width": 1.5 },
    },
    {
      id: "peaks",
      type: "symbol",
      source: "peaks",
      layout: {
        "icon-image": ["case", ["get", "done"], "peak-done", "peak-todo"],
        "icon-allow-overlap": true,
        "symbol-sort-key": ["-", 0, ["get", "elevationFt"]],
        "text-field": ["concat", ["get", "name"], "\n", ["number-format", ["get", "elevationFt"], {}], "'"],
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13],
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": ["case", ["get", "done"], COLORS.peakDone, "#212121"],
        "text-halo-color": "#fff",
        "text-halo-width": 1.8,
      },
    },
  ];
}

export function buildStyle(o: StyleOptions): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  let base: LayerSpecification[];
  if (o.vectorBasemap) {
    sources.protomaps = {
      type: "vector",
      url: "pmtiles://basemap",
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps',
    };
    base = vectorBase();
  } else {
    base = [{ id: "background", type: "background", paint: { "background-color": "#f4f1e8" } }];
    if (o.raster) {
      sources.raster = { type: "raster", tiles: o.raster.tiles, tileSize: 256, maxzoom: o.raster.maxzoom, attribution: o.raster.attribution };
      base.push({ id: "raster", type: "raster", source: "raster" });
    }
  }
  if (o.demTiles) {
    sources.dem = { type: "raster-dem", tiles: [o.demTiles], tileSize: 256, maxzoom: 13, encoding: "terrarium", bounds: o.demBounds };
  }
  if (o.contourTiles) {
    sources.contours = { type: "vector", tiles: [o.contourTiles], maxzoom: 15, bounds: o.demBounds };
  }

  // Terrain goes under roads/labels on the vector basemap; on top (subtle) of rasters.
  let layers: LayerSpecification[];
  if (o.vectorBasemap) {
    const at = base.findIndex((l) => l.id === "water");
    layers = [...base.slice(0, at), ...terrainLayers(o), ...base.slice(at)];
  } else {
    layers = [...base, ...terrainLayers({ ...o, contourTiles: undefined })];
  }

  return {
    version: 8,
    glyphs: `${location.origin}/fonts/{fontstack}/{range}.pbf`,
    sources,
    layers,
  };
}
