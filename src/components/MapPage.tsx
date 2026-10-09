import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campsite, CoreData } from "../lib/data";
import { newId, type Route, type RoutePeak } from "../lib/db";
import { addDays, fmtDate } from "../lib/dates";
import { FT_PER_M, M_PER_MILE, type LngLat } from "../lib/geo";
import type { TrailRouter } from "../lib/router";
import { syncCampsites } from "../lib/routeCampsites";
import {
  alongRoute,
  buildGeometry,
  closestIndex,
  dayBreaks,
  dayStats,
  legOfIndex,
  snapPoint,
  thin,
  type Leg,
  type RouteGeometry,
  type Waypoint,
} from "../lib/routing";
import { autofillPeakDates } from "../lib/schedule";
import MapView, { ROUTE_DONE, ROUTE_PLANNED, type MapEditHandlers } from "../map/MapView";
import type { MapSetup } from "../map/sources";
import ElevationProfile, { type ProfileMarker } from "./ElevationProfile";

const PEAK_RADIUS_M = 150;
const CAMP_RADIUS_M = 250;
const UNDO_LIMIT = 100;

interface Props {
  core: CoreData;
  router: TrailRouter;
  setup: MapSetup;
  doneIds: Set<string>;
  visible: boolean;
  routes: Route[];
  draft: Route | null;
  setDraft(update: (r: Route | null) => Route | null): void;
  isSaved: boolean;
  fitKey: string | null;
  onNew(): void;
  onOpenRoute(id: string): void;
  onSave(route: Route): Promise<void>;
  onCancel(): void;
  onDelete(route: Route): void;
  onSaveCampsite(c: Campsite): Promise<void>;
  onDeleteCampsite(c: Campsite): Promise<void>;
}

/** A campsite being added or edited; `forRoute` adds it to the open route on save. */
type CampForm = Campsite & { isNew: boolean; forRoute: boolean };

/** Nights implied by campsite stops (the final point never starts a new day). */
function stopNights(w: Waypoint[]): number {
  return w.filter((x, i) => i > 0 && i < w.length - 1 && x.campsiteId && x.night !== false).length;
}

export default function MapPage(p: Props) {
  const { core, router, draft, setDraft } = p;
  const [geom, setGeom] = useState<RouteGeometry | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [placing, setPlacing] = useState<{ forRoute: boolean } | null>(null);
  const [camp, setCamp] = useState<CampForm | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [allStatus, setAllStatus] = useState<"all" | "done" | "planned">("all");
  const [allPeak, setAllPeak] = useState("");
  const legCache = useRef(new Map<string, Leg>());

  // ----- undo / redo for the route line (points only)
  const history = useRef<{ past: Waypoint[][]; future: Waypoint[][] }>({ past: [], future: [] });
  const [, bump] = useState(0);
  useEffect(() => {
    history.current = { past: [], future: [] };
    bump((n) => n + 1);
  }, [draft?.id]);

  // History is recorded outside the state updaters: React may run an updater twice.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setWps = useCallback(
    (f: (w: Waypoint[]) => Waypoint[]) => {
      const cur = draftRef.current?.waypoints;
      if (!cur) return;
      const next = f(cur);
      if (next === cur) return;
      const h = history.current;
      h.past = [...h.past.slice(-UNDO_LIMIT + 1), cur];
      h.future = [];
      draftRef.current = { ...draftRef.current!, waypoints: next }; // so a second call before re-render builds on this one
      setDraft((d) => (d ? { ...d, waypoints: next } : d));
      bump((n) => n + 1);
    },
    [setDraft],
  );
  const undo = useCallback(() => {
    const h = history.current, cur = draftRef.current?.waypoints;
    if (!cur || !h.past.length) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [cur, ...h.future];
    draftRef.current = { ...draftRef.current!, waypoints: prev };
    setDraft((d) => (d ? { ...d, waypoints: prev } : d));
    bump((n) => n + 1);
  }, [setDraft]);
  const redo = useCallback(() => {
    const h = history.current, cur = draftRef.current?.waypoints;
    if (!cur || !h.future.length) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past, cur];
    draftRef.current = { ...draftRef.current!, waypoints: next };
    setDraft((d) => (d ? { ...d, waypoints: next } : d));
    bump((n) => n + 1);
  }, [setDraft]);

  useEffect(() => {
    if (!p.visible || !draft) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return; // leave text undo alone
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [p.visible, !!draft, undo, redo]);

  useEffect(() => {
    if (!placing) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [placing]);

  // ----- recompute geometry when waypoints change
  const wps = draft?.waypoints;
  useEffect(() => {
    let stale = false;
    if (!wps || wps.length < 2) {
      setGeom(null);
      if (wps) setDraft((d) => (d && (d.miles || d.gainFt) ? { ...d, miles: 0, gainFt: 0, line: [] } : d));
      return;
    }
    buildGeometry(router, wps, p.setup.sampler, legCache.current).then((g) => {
      if (stale) return;
      setGeom(g);
      if (!g) return;
      const miles = g.length / M_PER_MILE, gainFt = g.gain * FT_PER_M;
      setDraft((d) =>
        d && (Math.abs(d.miles - miles) > 1e-6 || Math.abs(d.gainFt - gainFt) > 1e-6 || !d.line?.length)
          ? { ...d, miles, gainFt, line: thin(g.coords) }
          : d,
      );
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wps, router, p.setup]);

  // ----- campsite list and nights follow the campsite stops
  useEffect(() => {
    if (!draft) return;
    // applied to the latest draft, so it never overwrites an edit made in the meantime
    setDraft((d) => {
      if (!d) return d;
      let next = syncCampsites(d, core.campsites);
      if (d.waypoints.some((w) => w.campsiteId)) {
        const nights = stopNights(d.waypoints);
        if (nights !== next.nights)
          next = { ...next, nights, endDate: next.startDate ? addDays(next.startDate, nights) : next.endDate };
      }
      return JSON.stringify(next) === JSON.stringify(d) ? d : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.waypoints, draft?.extraCampsites, core.campsites]);

  // ----- keep auto-filled peak dates in step with start date / nights / stops
  useEffect(() => {
    if (!draft?.startDate) return;
    const peaks = autofillPeakDates(draft, geom, core.peaks);
    if (JSON.stringify(peaks) !== JSON.stringify(draft.peaks)) setDraft((d) => (d ? { ...d, peaks } : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.startDate, draft?.nights, draft?.waypoints, draft?.peaks.length, geom]);

  // ----- suggestions, days and profile markers
  const nearPeaks = useMemo(() => (geom ? alongRoute(geom, core.peaks, PEAK_RADIUS_M) : []), [geom, core.peaks]);
  const nearCamps = useMemo(() => (geom ? alongRoute(geom, core.campsites, CAMP_RADIUS_M) : []), [geom, core.campsites]);
  const breaks = useMemo(() => (geom && draft ? dayBreaks(draft.waypoints, geom) : []), [geom, draft?.waypoints]);
  const days = useMemo(() => (geom ? dayStats(geom, breaks) : []), [geom, breaks]);
  const markers = useMemo<ProfileMarker[]>(() => {
    if (!geom || !draft) return [];
    const out: ProfileMarker[] = [];
    for (const rp of draft.peaks) {
      const pk = core.peaks.find((x) => x.id === rp.peakId);
      if (!pk) continue;
      const c = closestIndex(geom, pk.lngLat);
      if (c.dist < 500) out.push({ kind: "peak", idx: c.idx, label: pk.name.replace(/^Mount /, "Mt ") });
    }
    draft.waypoints.forEach((w, i) => {
      if (!w.campsiteId) return;
      const c = core.campsites.find((x) => x.id === w.campsiteId);
      out.push({ kind: "camp", idx: geom.waypointIdx[i], label: c?.name ?? "Campsite" });
    });
    breaks.forEach((b, i) => out.push({ kind: "day", idx: b, label: `Day ${i + 2}` }));
    return out;
  }, [geom, draft?.peaks, draft?.waypoints, breaks, core.peaks, core.campsites]);

  // ----- saved routes on the map
  const allRoutes = useMemo(() => {
    if (!showAll) return null;
    const peakId = allPeak;
    return p.routes
      .filter((r) => r.id !== draft?.id)
      .filter((r) => allStatus === "all" || (allStatus === "done") === r.completed)
      .filter((r) => !peakId || r.peaks.some((x) => x.peakId === peakId))
      .map((r) => ({ id: r.id, name: r.name, completed: r.completed, line: r.line ?? [] }));
  }, [showAll, allStatus, allPeak, p.routes, draft?.id]);

  // ----- editing
  const place = (pt: LngLat): Pick<Waypoint, "lngLat" | "snapped" | "free" | "campsiteId" | "night"> =>
    snap
      ? { ...snapPoint(router, pt), free: undefined, campsiteId: undefined, night: undefined }
      : { lngLat: pt, snapped: !!router.nearest(pt, 3), free: true, campsiteId: undefined, night: undefined };

  function campsiteStop(id: string): Waypoint | null {
    const c = core.campsites.find((x) => x.id === id);
    if (!c) return null;
    return { id: newId(), lngLat: c.lngLat, snapped: !!router.nearest(c.lngLat, 3), campsiteId: id, night: true };
  }

  /** Put a campsite stop where it falls along the route (or at the end if there's no route yet). */
  function insertCampsiteStop(id: string) {
    const stop = campsiteStop(id);
    if (!stop) return;
    setWps((w) => {
      if (!geom || w.length < 2) return [...w, stop];
      const leg = legOfIndex(geom, closestIndex(geom, stop.lngLat).idx);
      return [...w.slice(0, leg + 1), stop, ...w.slice(leg + 1)];
    });
  }

  const editing: MapEditHandlers | null =
    draft && !placing && !camp
      ? {
          add: (pt) => setWps((w) => [...w, { id: newId(), ...place(pt) }]),
          addCampsite: (id) => {
            const stop = campsiteStop(id);
            if (stop) setWps((w) => [...w, stop]);
          },
          // Exact summit, not snapped away from it. Snap on: trails plus a spur if the summit is off-trail.
          addSummit: (pt) =>
            setWps((w) => [...w, { id: newId(), lngLat: pt, snapped: !!router.nearest(pt, 3), free: snap ? undefined : true }]),
          move: (id, pt) => setWps((w) => w.map((x) => (x.id === id ? { ...x, ...place(pt) } : x))),
          insert: (leg, pt) => setWps((w) => [...w.slice(0, leg + 1), { id: newId(), ...place(pt) }, ...w.slice(leg + 1)]),
          remove: (id) => setWps((w) => w.filter((x) => x.id !== id)),
        }
      : null;

  const patch = (x: Partial<Route>) => setDraft((d) => (d ? { ...d, ...x } : d));
  const peakName = (id: string) => core.peaks.find((x) => x.id === id)?.name ?? id;
  const campName = (id?: string) => core.campsites.find((x) => x.id === id)?.name ?? "Campsite";
  const extras = draft?.extraCampsites ?? [];

  async function saveCamp(c: CampForm) {
    const { isNew: _n, forRoute, ...site } = c;
    const saved = { ...site, name: site.name.trim() };
    await p.onSaveCampsite(saved);
    if (draft && forRoute) {
      // the new site isn't in core.campsites until the parent reloads, so build the stop directly
      const stop: Waypoint = { id: newId(), lngLat: saved.lngLat, snapped: !!router.nearest(saved.lngLat, 3), campsiteId: saved.id, night: true };
      setWps((w) => {
        if (!geom || w.length < 2) return [...w, stop];
        const leg = legOfIndex(geom, closestIndex(geom, stop.lngLat).idx);
        return [...w.slice(0, leg + 1), stop, ...w.slice(leg + 1)];
      });
    }
    setCamp(null);
  }

  function save() {
    if (!draft) return;
    if (draft.completed) setConfirming(true);
    else p.onSave(draft);
  }

  const stops = draft ? draft.waypoints.map((w, i) => ({ w, i })).filter(({ w }) => w.campsiteId) : [];
  const lastIdx = (draft?.waypoints.length ?? 0) - 1;

  return (
    <div className="map-page">
      <MapView
        core={core}
        setup={p.setup}
        doneIds={p.doneIds}
        geom={geom}
        waypoints={draft?.waypoints ?? []}
        editing={editing}
        hoverIdx={hoverIdx}
        visible={p.visible}
        fitKey={p.fitKey}
        placing={!!placing}
        onPlace={(pt) => {
          setCamp({ id: newId(), name: "", kind: "campsite", lngLat: pt, mine: true, notes: "", isNew: true, forRoute: !!placing?.forRoute });
          setPlacing(null);
        }}
        campEdit={camp && { lngLat: camp.lngLat, onMove: (pt) => setCamp((c) => (c ? { ...c, lngLat: pt } : c)) }}
        onEditCampsite={(id) => {
          const c = core.campsites.find((x) => x.id === id && x.mine);
          if (c) setCamp({ ...c, isNew: false, forRoute: false });
        }}
        allRoutes={allRoutes}
        onOpenRoute={p.onOpenRoute}
      />
      {placing && (
        <div className="place-banner">
          Click the map to place your campsite
          <button onClick={() => setPlacing(null)}>Cancel</button>
        </div>
      )}
      {!draft && !camp && (
        <div className="map-card">
          <button className="primary" onClick={p.onNew}>
            + New route
          </button>
          <button onClick={() => setPlacing({ forRoute: false })} disabled={!!placing}>
            + Add campsite
          </button>
          <div className="all-routes">
            <label className="toggle">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all routes
              <span className="muted small">({p.routes.length})</span>
            </label>
            {showAll && (
              <>
                <select value={allStatus} onChange={(e) => setAllStatus(e.target.value as typeof allStatus)}>
                  <option value="all">Completed and planned</option>
                  <option value="done">Completed only</option>
                  <option value="planned">Planned only</option>
                </select>
                <select value={allPeak} onChange={(e) => setAllPeak(e.target.value)}>
                  <option value="">Any peak</option>
                  {[...core.peaks]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <div className="legend">
                  <span><i className="lg line" style={{ background: ROUTE_DONE }} /> Completed</span>
                  <span><i className="lg line" style={{ background: ROUTE_PLANNED }} /> Planned</span>
                </div>
                <div className="muted small">
                  Showing {allRoutes?.length ?? 0}. Click a route to open it.
                </div>
              </>
            )}
          </div>
          <div className="legend">
            <span><i className="lg trail" /> Trail</span>
            <span><i className="lg herd" /> Herd path</span>
            <span><i className="lg peak-todo" /> Peak</span>
            <span><i className="lg peak-done" /> Climbed</span>
            <span><i className="lg camp" /> Campsite</span>
            <span><i className="lg leanto" /> Lean-to</span>
            <span><i className="lg camp mine" /> My campsite</span>
          </div>
          <div className="muted small">
            {p.setup.offlineBasemap ? "Offline topo map" : "Online map"} · {p.setup.offlineTerrain ? "offline terrain" : "online terrain"}
          </div>
        </div>
      )}
      {camp && (
        <CampsitePanel
          camp={camp}
          onChange={(x) => setCamp((c) => (c ? { ...c, ...x } : c))}
          onSave={() => saveCamp(camp)}
          onCancel={() => setCamp(null)}
          onDelete={async () => {
            if (!confirm(`Delete your campsite “${camp.name}”?`)) return;
            await p.onDeleteCampsite(camp);
            setCamp(null);
          }}
        />
      )}
      {draft && !camp && (
        <aside className="planner">
          <div className="panel-head">
            <input className="title-input" placeholder="Route name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="tools">
            <label className="toggle" title="On: new points snap to the nearest trail. Off: straight line from the previous point.">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to trail
            </label>
            <button onClick={undo} disabled={!history.current.past.length} title="Undo (⌘Z)">
              Undo
            </button>
            <button onClick={redo} disabled={!history.current.future.length} title="Redo (⇧⌘Z)">
              Redo
            </button>
            <button disabled={draft.waypoints.length < 2} onClick={() => setWps((w) => [...w].reverse())}>
              Reverse
            </button>
            <button
              disabled={draft.waypoints.length < 2}
              title="Return the way you came"
              onClick={() =>
                setWps((w) => [
                  ...w,
                  // the return pass doesn't add nights at the same campsites
                  ...w.slice(0, -1).reverse().map((x) => ({ ...x, id: newId(), night: x.campsiteId ? false : x.night })),
                ])
              }
            >
              Out &amp; back
            </button>
            <button
              disabled={draft.waypoints.length < 2}
              title="Add a final point at the start"
              onClick={() => setWps((w) => [...w, { ...w[0], id: newId(), night: w[0].campsiteId ? false : w[0].night }])}
            >
              Back to start
            </button>
            <button disabled={!draft.waypoints.length} onClick={() => setWps(() => [])}>
              Clear
            </button>
          </div>
          {draft.waypoints.length < 2 && (
            <p className="hint">
              Click the map to add points. Click a peak to go to its summit, or a campsite to stop there. Drag a point to move it; drag or click the blue line to
              add a point in between; click an existing point to route back to it; right-click a point to remove it. With snap
              off, new points connect with a straight line.
            </p>
          )}

          <div className="stats">
            <div>
              <strong>{draft.miles.toFixed(1)}</strong>
              <span>miles</span>
            </div>
            <div>
              <strong>{Math.round(draft.gainFt).toLocaleString()}</strong>
              <span>ft gain</span>
            </div>
            <div>
              <strong>{geom ? Math.round(geom.loss * FT_PER_M).toLocaleString() : 0}</strong>
              <span>ft loss</span>
            </div>
            <div>
              <strong>{draft.waypoints.length}</strong>
              <span>points</span>
            </div>
          </div>
          {geom && <ElevationProfile geom={geom} markers={markers} onHover={setHoverIdx} />}
          {geom && days.length > 1 && (
            <table className="days">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>To</th>
                  <th className="right">Miles</th>
                  <th className="right">Gain</th>
                  <th className="right">Loss</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const endStop = draft.waypoints.find((w, i) => w.campsiteId && geom.waypointIdx[i] === d.to);
                  return (
                    <tr
                      key={d.day}
                      onMouseEnter={() => setHoverIdx(d.to)}
                      onMouseLeave={() => setHoverIdx(null)}
                    >
                      <td>
                        {d.day + 1}
                        {draft.startDate && <div className="muted small">{fmtDate(addDays(draft.startDate, d.day)).slice(0, 5)}</div>}
                      </td>
                      <td className="to">{d.day === days.length - 1 ? "Finish" : campName(endStop?.campsiteId)}</td>
                      <td className="right">{d.miles.toFixed(1)}</td>
                      <td className="right">{Math.round(d.gainFt).toLocaleString()}</td>
                      <td className="right">{Math.round(d.lossFt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <section>
            <h3>Peaks</h3>
            <PeakList draft={draft} peakName={peakName} patch={patch} />
            {nearPeaks.filter((n) => !draft.peaks.some((x) => x.peakId === n.item.id)).length > 0 && (
              <div className="suggest">
                <span className="muted small">On this route:</span>
                {nearPeaks
                  .filter((n) => !draft.peaks.some((x) => x.peakId === n.item.id))
                  .map((n) => (
                    <button key={n.item.id} className="chip add" onClick={() => patch({ peaks: [...draft.peaks, { peakId: n.item.id }] })}>
                      + {n.item.name}
                    </button>
                  ))}
              </div>
            )}
            <select
              value=""
              onChange={(e) => e.target.value && patch({ peaks: [...draft.peaks, { peakId: e.target.value }] })}
            >
              <option value="">Add a peak manually…</option>
              {core.peaks
                .filter((x) => !draft.peaks.some((rp) => rp.peakId === x.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </section>

          <section>
            <h3>Trip</h3>
            <div className="form-grid">
              <label>
                Nights
                <input
                  type="number"
                  min={0}
                  value={draft.nights}
                  disabled={stops.length > 0}
                  title={stops.length ? "Set by the campsite stops marked “Night” below" : ""}
                  onChange={(e) => {
                    const nights = Math.max(0, Number(e.target.value) || 0);
                    patch({ nights, endDate: draft.startDate ? addDays(draft.startDate, nights) : draft.endDate });
                  }}
                />
              </label>
              <label className="toggle-cell">
                <input type="checkbox" checked={draft.completed} onChange={(e) => patch({ completed: e.target.checked })} /> Completed
              </label>
              <label>
                Start date
                <input
                  type="date"
                  value={draft.startDate ?? ""}
                  onChange={(e) =>
                    patch({ startDate: e.target.value || undefined, endDate: e.target.value ? addDays(e.target.value, draft.nights) : undefined })
                  }
                />
              </label>
              <label>
                End date
                <input type="date" value={draft.endDate ?? ""} onChange={(e) => patch({ endDate: e.target.value || undefined })} />
              </label>
            </div>
          </section>

          <section>
            <h3>Campsites</h3>
            {stops.length > 0 && (
              <ul className="stops">
                {stops.map(({ w, i }) => (
                  <li key={w.id}>
                    <span className="stop-name">{campName(w.campsiteId)}</span>
                    {i > 0 && i < lastIdx ? (
                      <label className="toggle" title="Spend the night here (starts a new day)">
                        <input
                          type="checkbox"
                          checked={w.night !== false}
                          onChange={(e) => setWps((all) => all.map((x) => (x.id === w.id ? { ...x, night: e.target.checked } : x)))}
                        />
                        Night
                      </label>
                    ) : (
                      <span className="muted small">{i === 0 ? "start" : "finish"}</span>
                    )}
                    <button className="icon" aria-label="Remove stop" onClick={() => setWps((all) => all.filter((x) => x.id !== w.id))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {extras.length > 0 && (
              <ul className="chips">
                {extras.map((c, i) => (
                  <li key={`${c.id ?? c.name}-${i}`} className="chip" title="Listed by name only; not a stop on the route line">
                    {c.name}
                    <button className="icon" onClick={() => patch({ extraCampsites: extras.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {nearCamps.filter((n) => !draft.waypoints.some((w) => w.campsiteId === n.item.id)).length > 0 && (
              <div className="suggest">
                <span className="muted small">Near this route:</span>
                {nearCamps
                  .filter((n) => !draft.waypoints.some((w) => w.campsiteId === n.item.id))
                  .slice(0, 12)
                  .map((n) => (
                    <button key={n.item.id} className="chip add" onClick={() => insertCampsiteStop(n.item.id)}>
                      + {n.item.name}
                    </button>
                  ))}
              </div>
            )}
            <button className="link small-gap" onClick={() => setPlacing({ forRoute: true })} disabled={!!placing}>
              + Place a new campsite on the map
            </button>
            <CampsiteInput
              names={core.campsites.map((c) => c.name)}
              onAdd={(name) => {
                const known = core.campsites.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (known) insertCampsiteStop(known.id);
                else patch({ extraCampsites: [...extras, { name }] });
              }}
            />
          </section>

          <section>
            <h3>Notes</h3>
            <textarea value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </section>

          <div className="panel-actions">
            <button className="primary" onClick={save} disabled={!draft.name.trim()} title={draft.name.trim() ? "" : "Give the route a name"}>
              Save route
            </button>
            <button onClick={p.onCancel}>Close</button>
            {p.isSaved && (
              <button
                className="danger"
                onClick={() => confirm(`Delete route “${draft.name}”? Ascents logged from it are removed too.`) && p.onDelete(draft)}
              >
                Delete
              </button>
            )}
          </div>
        </aside>
      )}
      {confirming && draft && (
        <ConfirmAscents
          draft={draft}
          peakName={peakName}
          onCancel={() => setConfirming(false)}
          onConfirm={(peaks) => {
            setConfirming(false);
            p.onSave({ ...draft, peaks });
          }}
        />
      )}
    </div>
  );
}

function PeakList({ draft, peakName, patch }: { draft: Route; peakName(id: string): string; patch(x: Partial<Route>): void }) {
  if (!draft.peaks.length) return <p className="muted small">No peaks yet. Add the suggestions below or pick one manually.</p>;
  const set = (i: number, rp: RoutePeak) => patch({ peaks: draft.peaks.map((x, j) => (j === i ? rp : x)) });
  return (
    <ul className="route-peaks">
      {draft.peaks.map((rp, i) => (
        <li key={rp.peakId}>
          <span>{peakName(rp.peakId)}</span>
          {draft.startDate && (
            <input
              type="date"
              value={rp.date ?? ""}
              className={rp.dateAuto ? "auto" : ""}
              title={rp.dateAuto ? "Auto-filled from the start date and campsites. Edit to override." : ""}
              onChange={(e) => set(i, { ...rp, date: e.target.value || undefined, dateAuto: false })}
            />
          )}
          <button className="icon" aria-label="Remove" onClick={() => patch({ peaks: draft.peaks.filter((_, j) => j !== i) })}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function CampsitePanel(p: {
  camp: CampForm;
  onChange(x: Partial<CampForm>): void;
  onSave(): void;
  onCancel(): void;
  onDelete(): void;
}) {
  const c = p.camp;
  return (
    <aside className="planner">
      <div className="panel-head">
        <h2>{c.isNew ? "New campsite" : "Edit campsite"}</h2>
      </div>
      <p className="hint">Drag the teal marker to fine-tune the location.</p>
      <div className="form-grid">
        <label className="wide">
          Name
          <input autoFocus value={c.name} placeholder="e.g. Feldspar Brook site" onChange={(e) => p.onChange({ name: e.target.value })} />
        </label>
        <label>
          Type
          <select value={c.kind} onChange={(e) => p.onChange({ kind: e.target.value as Campsite["kind"] })}>
            <option value="campsite">Campsite</option>
            <option value="lean-to">Lean-to</option>
            <option value="hut">Hut / cabin</option>
          </select>
        </label>
        <label>
          Location
          <input readOnly value={`${c.lngLat[1].toFixed(5)}, ${c.lngLat[0].toFixed(5)}`} />
        </label>
        <label className="wide">
          Notes
          <textarea value={c.notes ?? ""} placeholder="Water source, tent pads, views…" onChange={(e) => p.onChange({ notes: e.target.value })} />
        </label>
      </div>
      <div className="panel-actions">
        <button className="primary" disabled={!c.name.trim()} title={c.name.trim() ? "" : "Give the campsite a name"} onClick={p.onSave}>
          Save campsite
        </button>
        <button onClick={p.onCancel}>Cancel</button>
        {!c.isNew && (
          <button className="danger" onClick={p.onDelete}>
            Delete
          </button>
        )}
      </div>
    </aside>
  );
}

function CampsiteInput({ names, onAdd }: { names: string[]; onAdd(name: string): void }) {
  const [v, setV] = useState("");
  const unique = useMemo(() => [...new Set(names)].sort(), [names]);
  const add = () => {
    if (v.trim()) onAdd(v.trim());
    setV("");
  };
  return (
    <div className="inline-add">
      <input
        list="campsite-names"
        placeholder="Add a campsite by name…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <datalist id="campsite-names">
        {unique.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button onClick={add}>Add</button>
    </div>
  );
}

function ConfirmAscents(p: { draft: Route; peakName(id: string): string; onCancel(): void; onConfirm(peaks: RoutePeak[]): void }) {
  const [peaks, setPeaks] = useState(p.draft.peaks.map((rp) => ({ ...rp, date: rp.date ?? p.draft.startDate })));
  const missing = peaks.some((rp) => !rp.date);
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Log ascents</h2>
        <p className="muted">
          This route is marked completed
          {p.draft.startDate ? ` (${fmtDate(p.draft.startDate)}${p.draft.endDate && p.draft.endDate !== p.draft.startDate ? ` – ${fmtDate(p.draft.endDate)}` : ""})` : ""}.
          Check the date for each peak. These ascents are added to your Peak Tracker.
        </p>
        {!peaks.length && <p className="muted">No peaks on this route; nothing to log.</p>}
        <ul className="route-peaks">
          {peaks.map((rp, i) => (
            <li key={rp.peakId}>
              <span>{p.peakName(rp.peakId)}</span>
              <input
                type="date"
                value={rp.date ?? ""}
                min={p.draft.startDate}
                max={p.draft.endDate}
                onChange={(e) => setPeaks(peaks.map((x, j) => (j === i ? { ...x, date: e.target.value, dateAuto: false } : x)))}
              />
            </li>
          ))}
        </ul>
        <div className="panel-actions">
          <button className="primary" disabled={missing} onClick={() => p.onConfirm(peaks)}>
            Save &amp; log {peaks.length} ascent{peaks.length === 1 ? "" : "s"}
          </button>
          <button onClick={p.onCancel}>Back</button>
        </div>
      </div>
    </div>
  );
}
