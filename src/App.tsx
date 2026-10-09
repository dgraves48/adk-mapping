import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import MapPage from "./components/MapPage";
import PeaksPage from "./components/PeaksPage";
import RoutesPage from "./components/RoutesPage";
import SettingsPage from "./components/SettingsPage";
import type { Filters } from "./components/DataTable";
import { loadCoreData, type Campsite, type CoreData } from "./lib/data";
import { getStore, newId, type Ascent, type Route } from "./lib/db";
import { packStatus, type PackStatus } from "./lib/packs";
import { TrailRouter } from "./lib/router";
import { setupMapSources, type MapSetup } from "./map/sources";
import { buildGeometry, thin } from "./lib/routing";

type Tab = "peaks" | "map" | "routes" | "settings";
const TAB_LABEL: Record<Tab, string> = { peaks: "Peak Tracker", map: "Map", routes: "Routes", settings: "Settings" };

function blankRoute(): Route {
  return {
    id: newId(),
    name: "",
    waypoints: [],
    peaks: [],
    campsites: [],
    nights: 0,
    miles: 0,
    gainFt: 0,
    completed: false,
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

export default function App() {
  const [tab, setTab] = useState<Tab>("map");
  const [core, setCore] = useState<CoreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ascents, setAscents] = useState<Ascent[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [myCampsites, setMyCampsites] = useState<Campsite[]>([]);
  const [packs, setPacks] = useState<PackStatus[]>([]);
  const [settings, setSettings] = useState({ tracestrackKey: "", packUrl: "" });
  const [setup, setSetup] = useState<MapSetup | null>(null);
  const [draft, setDraft] = useState<Route | null>(null);
  const [fitKey, setFitKey] = useState<string | null>(null);
  const [routeFilters, setRouteFilters] = useState<Filters>({});

  const router = useMemo(() => (core ? new TrailRouter(core.trails) : null), [core]);

  const reloadData = useCallback(async () => {
    const s = await getStore();
    setAscents(await s.ascents());
    setRoutes(await s.routes());
    setMyCampsites(await s.campsites());
  }, []);

  const reloadMap = useCallback(async (key: string) => {
    setPacks(await packStatus());
    setSetup(await setupMapSources(key || null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await getStore();
        const st = {
          tracestrackKey: (await s.getSetting("tracestrackKey")) ?? "",
          packUrl: (await s.getSetting("packUrl")) ?? "",
        };
        setSettings(st);
        const [c] = await Promise.all([loadCoreData(), reloadData(), reloadMap(st.tracestrackKey)]);
        setCore(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [reloadData, reloadMap]);

  // Your campsites join the built-in ones everywhere: map, suggestions, date guesses.
  const mapCore = useMemo(
    () => (core ? { ...core, campsites: [...core.campsites, ...myCampsites.map((c) => ({ ...c, mine: true }))] } : null),
    [core, myCampsites],
  );

  async function saveCampsite(c: Campsite) {
    const s = await getStore();
    await s.putCampsite(c);
    // keep the name on saved routes that use this campsite in step
    for (const r of routes) {
      if (r.campsites.some((x) => x.id === c.id && x.name !== c.name)) {
        await s.putRoute({ ...r, campsites: r.campsites.map((x) => (x.id === c.id ? { ...x, name: c.name } : x)) });
      }
    }
    await reloadData();
  }

  async function deleteCampsite(c: Campsite) {
    await (await getStore()).deleteCampsite(c.id);
    await reloadData();
  }

  // Routes saved before the all-routes view existed have no stored line: compute it once.
  useEffect(() => {
    if (!router) return;
    const missing = routes.filter((r) => !r.line && r.waypoints.length > 1);
    if (!missing.length) return;
    (async () => {
      const s = await getStore();
      for (const r of missing) {
        const g = await buildGeometry(router, r.waypoints, null, new Map());
        await s.putRoute({ ...r, line: g ? thin(g.coords) : [] });
      }
      await reloadData();
    })();
  }, [routes, router, reloadData]);

  const doneIds = useMemo(() => new Set(ascents.map((a) => a.peakId)), [ascents]);

  async function saveRoute(r: Route) {
    const s = await getStore();
    const route = { ...r, updatedAt: new Date().toISOString() };
    await s.putRoute(route);
    // Ascents logged from a route always mirror the route's current state.
    await s.deleteRouteAscents(route.id);
    if (route.completed) {
      for (const rp of route.peaks) {
        const date = rp.date ?? route.startDate;
        if (date) await s.putAscent({ id: newId(), peakId: rp.peakId, date, notes: "", routeId: route.id });
      }
    }
    setDraft(route);
    await reloadData();
  }

  async function deleteRoute(r: Route) {
    const s = await getStore();
    await s.deleteRoute(r.id);
    await s.deleteRouteAscents(r.id);
    if (draft?.id === r.id) setDraft(null);
    await reloadData();
  }

  function openRoute(r: Route) {
    setDraft(structuredClone(r));
    setFitKey(`${r.id}-${Date.now()}`);
    setTab("map");
  }

  function newRoute() {
    setDraft(blankRoute());
    setTab("map");
  }

  if (error) return <div className="boot error">Couldn't start: {error}</div>;
  if (!core || !mapCore || !router || !setup) return <div className="boot">Loading the High Peaks…</div>;

  const official = core.peaks.filter((p) => p.official && doneIds.has(p.id)).length;

  return (
    <div className="app">
      <nav className="tabs">
        <span className="brand">▲ ADK High Peaks</span>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="spacer" />
        <span className="tally" title="Official 46 completed">
          {official} / 46
        </span>
      </nav>
      <main>
        <div className={`tab ${tab === "peaks" ? "shown" : ""}`}>
          <PeaksPage
            peaks={core.peaks}
            ascents={ascents}
            routes={routes}
            onSaveAscent={async (a) => {
              await (await getStore()).putAscent(a);
              reloadData();
            }}
            onDeleteAscent={async (id) => {
              await (await getStore()).deleteAscent(id);
              reloadData();
            }}
            onShowRoutes={(peakId) => {
              const name = core.peaks.find((p) => p.id === peakId)?.name ?? "";
              setRouteFilters({ peaks: { text: name } });
              setTab("routes");
            }}
          />
        </div>
        <div className={`tab ${tab === "map" ? "shown" : ""}`}>
          <MapPage
            core={mapCore}
            routes={routes}
            onOpenRoute={(id) => {
              const r = routes.find((x) => x.id === id);
              if (r) openRoute(r);
            }}
            router={router}
            setup={setup}
            doneIds={doneIds}
            visible={tab === "map"}
            draft={draft}
            setDraft={setDraft}
            isSaved={!!draft && routes.some((r) => r.id === draft.id)}
            fitKey={fitKey}
            onNew={newRoute}
            onSave={saveRoute}
            onCancel={() => setDraft(null)}
            onDelete={deleteRoute}
            onSaveCampsite={saveCampsite}
            onDeleteCampsite={deleteCampsite}
          />
        </div>
        <div className={`tab ${tab === "routes" ? "shown" : ""}`}>
          <RoutesPage
            routes={routes}
            peaks={core.peaks}
            filters={routeFilters}
            onFilters={setRouteFilters}
            onOpen={openRoute}
            onNew={newRoute}
            onDelete={deleteRoute}
          />
        </div>
        <div className={`tab ${tab === "settings" ? "shown" : ""}`}>
          <SettingsPage
            packs={packs}
            tracestrackKey={settings.tracestrackKey}
            packUrl={settings.packUrl}
            onSetting={async (k, v) => {
              await (await getStore()).setSetting(k, v);
              setSettings((s) => ({ ...s, [k]: v }));
              if (k === "tracestrackKey") reloadMap(v);
            }}
            onPacksChanged={() => reloadMap(settings.tracestrackKey)}
            onDataImported={reloadData}
          />
        </div>
      </main>
    </div>
  );
}
