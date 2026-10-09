import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
// Bundle MapLibre's tile worker (and the chunk it imports) so the packaged app can load it.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import type { CoreData } from "../lib/data";
import type { LngLat } from "../lib/geo";
import { FT_PER_M } from "../lib/geo";
import { campsitesGeoJSON, otherPeaksGeoJSON, peaksGeoJSON, trailheadsGeoJSON, trailsGeoJSON } from "../lib/geojson";
import { closestIndex, legOfIndex, type RouteGeometry, type Waypoint } from "../lib/routing";
import { addIcons } from "./icons";
import type { MapSetup } from "./sources";
import { buildStyle, COLORS, overlayLayers } from "./style";

export interface MapEditHandlers {
  add(p: LngLat): void;
  /** clicked a campsite: route to it as a stop */
  addCampsite(id: string): void;
  /** clicked a peak (icon or name): put the point exactly on the summit */
  addSummit(p: LngLat): void;
  move(id: string, p: LngLat): void;
  insert(leg: number, p: LngLat): void;
  remove(id: string): void;
}

interface Props {
  core: CoreData;
  setup: MapSetup;
  doneIds: Set<string>;
  geom: RouteGeometry | null;
  waypoints: Waypoint[];
  editing: MapEditHandlers | null;
  hoverIdx: number | null;
  visible: boolean;
  fitKey: string | null; // when this changes, zoom to the route
  /** waiting for a click to place a new campsite */
  placing: boolean;
  onPlace(p: LngLat): void;
  /** one of your campsites is open for editing: show a draggable marker */
  campEdit: { lngLat: LngLat; onMove(p: LngLat): void } | null;
  onEditCampsite(id: string): void;
  /** saved routes to draw when "show all routes" is on */
  allRoutes: { id: string; name: string; completed: boolean; line: LngLat[] }[] | null;
  onOpenRoute(id: string): void;
}

export const ROUTE_DONE = "#2e7d32";
export const ROUTE_PLANNED = "#7b1fa2";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const HOME: [number, number, number, number] = [-74.25, 44.03, -73.68, 44.40];

maplibregl.setWorkerUrl(workerUrl);

/** Map button that zooms back out to the whole downloaded map area. */
class FitControl implements maplibregl.IControl {
  private el?: HTMLDivElement;
  constructor(private bounds: () => [number, number, number, number]) {}
  onAdd(map: MLMap) {
    this.el = document.createElement("div");
    this.el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fit-ctrl";
    b.title = "Center on the High Peaks map";
    b.setAttribute("aria-label", b.title);
    b.innerHTML =
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M2 16 L7.5 6 L11 12 L13 9 L18 16 Z" fill="currentColor"/></svg>';
    b.onclick = () => map.fitBounds(this.bounds(), { padding: 20, duration: 800 });
    this.el.appendChild(b);
    return this.el;
  }
  onRemove() {
    this.el?.remove();
  }
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const campMarker = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(p);
  latest.current = p;

  const trailsFC = useRef<FeatureCollection | null>(null);
  trailsFC.current ??= trailsGeoJSON(p.core.trails);

  // ----- create map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: buildStyle(p.setup.style),
      bounds: HOME,
      maxBounds: [-74.9, 43.6, -73.0, 44.8],
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map; // for UI tests
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new FitControl(() => latest.current.setup.bounds ?? HOME), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    map.on("style.load", () => installOverlays(map));
    map.on("styleimagemissing", () => addIcons(map));

    map.on("click", (e) => onClick(map, e));
    map.on("contextmenu", (e) => e.preventDefault());
    map.on("mousedown", "route-line-hit", (e) => startLineDrag(map, e));
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: "route-tip" });
    map.on("mousemove", "all-routes-hit", (e) => {
      if (latest.current.editing) return;
      const f = e.features?.[0];
      if (f) tip.setLngLat(e.lngLat).setText(String(f.properties.name || "Untitled")).addTo(map);
    });
    map.on("mouseleave", "all-routes-hit", () => tip.remove());
    for (const layer of ["peaks", "other-peaks", "campsites", "trailheads", "route-line-hit", "all-routes-hit"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- swap style when packs / online sources change
  const firstSetup = useRef(true);
  useEffect(() => {
    if (firstSetup.current) {
      firstSetup.current = false;
      return;
    }
    mapRef.current?.setStyle(buildStyle(p.setup.style), { diff: false });
  }, [p.setup]);

  function installOverlays(map: MLMap) {
    addIcons(map);
    const cur = latest.current;
    const add = (id: string, data: FeatureCollection) => {
      if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
    };
    add("trails", trailsFC.current!);
    add("peaks", peaksGeoJSON(cur.core.peaks, cur.doneIds));
    add("other-peaks", otherPeaksGeoJSON(cur.core.otherPeaks));
    add("campsites", campsitesGeoJSON(cur.core.campsites));
    add("trailheads", trailheadsGeoJSON(cur.core.trailheads));
    add("route", routeFC(cur.geom));
    add("all-routes", allRoutesFC(cur.allRoutes));
    add("hover", EMPTY);
    for (const l of overlayLayers()) {
      // route goes under the point features
      if (l.id === "trailheads") addRouteLayers(map);
      if (!map.getLayer(l.id)) map.addLayer(l);
    }
    map.addLayer({
      id: "hover",
      type: "circle",
      source: "hover",
      paint: { "circle-radius": 6, "circle-color": COLORS.route, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });
  }

  function addRouteLayers(map: MLMap) {
    map.addLayer({
      id: "all-routes-casing",
      type: "line",
      source: "all-routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#fff", "line-width": 6, "line-opacity": 0.8 },
    });
    map.addLayer({
      id: "all-routes-line",
      type: "line",
      source: "all-routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["case", ["get", "completed"], ROUTE_DONE, ROUTE_PLANNED],
        "line-width": 3,
        "line-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "all-routes-hit",
      type: "line",
      source: "all-routes",
      paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 },
    });
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": COLORS.routeCasing, "line-width": 8, "line-opacity": 0.9 },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": COLORS.route, "line-width": 4.5 },
    });
    // invisible wide line to make clicking the route easy
    map.addLayer({
      id: "route-line-hit",
      type: "line",
      source: "route",
      paint: { "line-color": "#000", "line-width": 16, "line-opacity": 0 },
    });
  }

  function onClick(map: MLMap, e: MapMouseEvent) {
    const cur = latest.current;
    if (cur.placing) {
      cur.onPlace([e.lngLat.lng, e.lngLat.lat]);
      return;
    }
    if (cur.campEdit) return;
    if (cur.editing) {
      const camp = map.queryRenderedFeatures(e.point, { layers: ["campsites"] })[0];
      if (camp) {
        cur.editing.addCampsite(String(camp.properties.id));
        return;
      }
      const peak = map.queryRenderedFeatures(e.point, { layers: ["peaks", "other-peaks"] })[0];
      if (peak && peak.geometry.type === "Point") {
        cur.editing.addSummit(peak.geometry.coordinates as LngLat);
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ["route-line-hit"] });
      const pt: LngLat = [e.lngLat.lng, e.lngLat.lat];
      if (hit.length && cur.geom) {
        cur.editing.insert(legOfIndex(cur.geom, closestIndex(cur.geom, pt).idx), pt);
      } else {
        cur.editing.add(pt);
      }
      return;
    }
    const routeHit = map.queryRenderedFeatures(e.point, { layers: ["all-routes-hit"] })[0];
    const f = map.queryRenderedFeatures(e.point, { layers: ["peaks", "campsites", "trailheads", "other-peaks"] })[0];
    if (!f && routeHit) {
      cur.onOpenRoute(String(routeHit.properties.id));
      return;
    }
    if (!f) return;
    const props = f.properties as Record<string, string | number | boolean>;
    if (f.layer.id === "campsites" && props.mine) {
      cur.onEditCampsite(String(props.id));
      return;
    }
    let html = `<strong>${props.name}</strong>`;
    if (f.layer.id === "peaks") html += `<br>${Number(props.elevationFt).toLocaleString()} ft${props.done ? " · ✓ climbed" : ""}`;
    if (f.layer.id === "other-peaks") html += `<br>${Number(props.elevationFt).toLocaleString()} ft`;
    if (f.layer.id === "campsites") html += `<br>${props.kind}`;
    new maplibregl.Popup({ offset: 10 }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  }

  /** Drag the route line to pull out a new point in the middle (a plain click still inserts too). */
  function startLineDrag(map: MLMap, e: maplibregl.MapLayerMouseEvent) {
    const cur = latest.current;
    if (!cur.editing || !cur.geom || e.originalEvent.button !== 0) return;
    if (map.queryRenderedFeatures(e.point, { layers: ["campsites", "peaks", "other-peaks"] }).length) return;
    e.preventDefault(); // stops the map from panning
    const leg = legOfIndex(cur.geom, closestIndex(cur.geom, [e.lngLat.lng, e.lngLat.lat]).idx);
    const start = e.point;
    let ghost: maplibregl.Marker | null = null;
    const move = (ev: MapMouseEvent) => {
      if (!ghost && Math.hypot(ev.point.x - start.x, ev.point.y - start.y) < 4) return;
      if (!ghost) {
        const dot = document.createElement("div");
        dot.className = "waypoint ghost";
        ghost = new maplibregl.Marker({ element: dot }).setLngLat(ev.lngLat).addTo(map);
      }
      ghost.setLngLat(ev.lngLat);
    };
    const up = (ev: MapMouseEvent) => {
      map.off("mousemove", move);
      if (ghost) {
        ghost.remove();
        latest.current.editing?.insert(leg, [ev.lngLat.lng, ev.lngLat.lat]);
      }
    };
    map.on("mousemove", move);
    map.once("mouseup", up);
  }

  // ----- data updates
  useEffect(() => {
    (mapRef.current?.getSource("peaks") as GeoJSONSource | undefined)?.setData(peaksGeoJSON(p.core.peaks, p.doneIds));
  }, [p.doneIds, p.core.peaks]);

  useEffect(() => {
    (mapRef.current?.getSource("route") as GeoJSONSource | undefined)?.setData(routeFC(p.geom));
  }, [p.geom]);

  useEffect(() => {
    (mapRef.current?.getSource("campsites") as GeoJSONSource | undefined)?.setData(campsitesGeoJSON(p.core.campsites));
  }, [p.core.campsites]);

  useEffect(() => {
    (mapRef.current?.getSource("all-routes") as GeoJSONSource | undefined)?.setData(allRoutesFC(p.allRoutes));
  }, [p.allRoutes]);

  // ----- draggable marker for the campsite being edited
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!p.campEdit) {
      campMarker.current?.remove();
      campMarker.current = null;
      return;
    }
    if (!campMarker.current) {
      const el = document.createElement("div");
      el.className = "camp-marker";
      el.title = "Drag to move";
      const m = new maplibregl.Marker({ element: el, draggable: true, anchor: "bottom" });
      m.on("dragend", () => {
        const ll = m.getLngLat();
        latest.current.campEdit?.onMove([ll.lng, ll.lat]);
      });
      campMarker.current = m.setLngLat(p.campEdit.lngLat).addTo(map);
    }
    campMarker.current.setLngLat(p.campEdit.lngLat);
  }, [p.campEdit]);

  useEffect(() => {
    const src = mapRef.current?.getSource("hover") as GeoJSONSource | undefined;
    if (!src) return;
    const c = p.hoverIdx != null && p.geom ? p.geom.coords[p.hoverIdx] : null;
    src.setData(c ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }] } : EMPTY);
  }, [p.hoverIdx, p.geom]);

  // ----- waypoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    p.waypoints.forEach((w, i) => {
      seen.add(w.id);
      let m = markers.current.get(w.id);
      if (!m) {
        const dot = document.createElement("div");
        dot.className = "waypoint";
        m = new maplibregl.Marker({ element: dot, draggable: true }).setLngLat(w.lngLat).addTo(map);
        m.on("dragend", () => {
          const ll = m!.getLngLat();
          latest.current.editing?.move(w.id, [ll.lng, ll.lat]);
        });
        dot.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          latest.current.editing?.remove(w.id);
        });
        // Clicking an existing point adds another point there (e.g. click the start to close a loop).
        dot.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const ll = m!.getLngLat();
          latest.current.editing?.add([ll.lng, ll.lat]);
        });
        markers.current.set(w.id, m);
      }
      m.setLngLat(w.lngLat);
      m.setDraggable(!!p.editing);
      const dot = m.getElement();
      const last = i === p.waypoints.length - 1;
      dot.classList.toggle("start", i === 0);
      dot.classList.toggle("end", last && i > 0);
      dot.classList.toggle("offtrail", !w.snapped);
      dot.classList.toggle("free", !!w.free);
      dot.classList.toggle("camp", !!w.campsiteId);
      dot.classList.toggle("night", !!w.campsiteId && w.night !== false);
      dot.textContent = i === 0 ? "S" : last ? "E" : String(i);
      dot.title = p.editing ? "Drag to move · click to route back here · right-click to remove" : "";
    });
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [p.waypoints, p.editing]);

  // ----- fit to route when a route is opened
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.fitKey || !p.waypoints.length) return;
    const pts = p.geom?.coords ?? p.waypoints.map((w) => w.lngLat);
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fitKey, !!p.geom]);

  useEffect(() => {
    if (p.visible) mapRef.current?.resize();
  }, [p.visible]);

  useEffect(() => {
    const c = mapRef.current?.getCanvasContainer();
    if (c) c.classList.toggle("editing", !!p.editing || p.placing);
  }, [p.editing, p.placing]);

  return <div ref={el} className="map" />;
}

function routeFC(g: RouteGeometry | null): FeatureCollection {
  if (!g) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { gainFt: g.gain * FT_PER_M }, geometry: { type: "LineString", coordinates: g.coords } }],
  };
}

function allRoutesFC(routes: Props["allRoutes"]): FeatureCollection {
  if (!routes) return EMPTY;
  return {
    type: "FeatureCollection",
    features: routes
      .filter((r) => r.line.length > 1)
      .map((r) => ({
        type: "Feature",
        properties: { id: r.id, name: r.name, completed: r.completed },
        geometry: { type: "LineString", coordinates: r.line },
      })),
  };
}
