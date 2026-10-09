import type { Campsite } from "./data";
import type { Waypoint } from "./routing";

export interface Ascent {
  id: string;
  peakId: string;
  date: string; // yyyy-mm-dd
  notes: string;
  routeId?: string | null;
}

export interface RoutePeak {
  peakId: string;
  date?: string;
  /** date was auto-filled (not typed by the user), so it may be recomputed */
  dateAuto?: boolean;
}

export interface RouteCampsite {
  id?: string; // campsite id when picked from the map data
  name: string;
}

export interface Route {
  id: string;
  name: string;
  waypoints: Waypoint[];
  peaks: RoutePeak[];
  /** every campsite on the route (stops first, then name-only ones); kept for the Routes table */
  campsites: RouteCampsite[];
  /** campsites listed without being a stop on the route line (e.g. typed by name) */
  extraCampsites?: RouteCampsite[];
  /** simplified route line, for drawing all routes on the map */
  line?: [number, number][];
  nights: number;
  miles: number;
  gainFt: number;
  completed: boolean;
  startDate?: string;
  endDate?: string;
  notes: string;
  updatedAt: string;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Storage backend: SQLite inside the Tauri app, localStorage when run in a plain browser. */
interface Store {
  ascents(): Promise<Ascent[]>;
  putAscent(a: Ascent): Promise<void>;
  deleteAscent(id: string): Promise<void>;
  deleteRouteAscents(routeId: string): Promise<void>;
  routes(): Promise<Route[]>;
  putRoute(r: Route): Promise<void>;
  deleteRoute(id: string): Promise<void>;
  campsites(): Promise<Campsite[]>;
  putCampsite(c: Campsite): Promise<void>;
  deleteCampsite(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export const isTauri = "__TAURI_INTERNALS__" in window;

async function sqliteStore(): Promise<Store> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:adk.db");
  type AscentRow = { id: string; peak_id: string; date: string; notes: string; route_id: string | null };
  return {
    async ascents() {
      const rows = await db.select<AscentRow[]>("SELECT * FROM ascents ORDER BY date");
      return rows.map((r) => ({ id: r.id, peakId: r.peak_id, date: r.date, notes: r.notes, routeId: r.route_id }));
    },
    async putAscent(a) {
      await db.execute(
        "INSERT OR REPLACE INTO ascents (id, peak_id, date, notes, route_id) VALUES ($1, $2, $3, $4, $5)",
        [a.id, a.peakId, a.date, a.notes, a.routeId ?? null],
      );
    },
    async deleteAscent(id) {
      await db.execute("DELETE FROM ascents WHERE id = $1", [id]);
    },
    async deleteRouteAscents(routeId) {
      await db.execute("DELETE FROM ascents WHERE route_id = $1", [routeId]);
    },
    async routes() {
      const rows = await db.select<{ data: string }[]>("SELECT data FROM routes");
      return rows.map((r) => JSON.parse(r.data));
    },
    async putRoute(r) {
      await db.execute("INSERT OR REPLACE INTO routes (id, data) VALUES ($1, $2)", [r.id, JSON.stringify(r)]);
    },
    async deleteRoute(id) {
      await db.execute("DELETE FROM routes WHERE id = $1", [id]);
    },
    async campsites() {
      const rows = await db.select<{ data: string }[]>("SELECT data FROM campsites");
      return rows.map((r) => JSON.parse(r.data));
    },
    async putCampsite(c) {
      await db.execute("INSERT OR REPLACE INTO campsites (id, data) VALUES ($1, $2)", [c.id, JSON.stringify(c)]);
    },
    async deleteCampsite(id) {
      await db.execute("DELETE FROM campsites WHERE id = $1", [id]);
    },
    async getSetting(key) {
      const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
      return rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)", [key, value]);
    },
  };
}

function localStore(): Store {
  const read = <T,>(k: string): T[] => JSON.parse(localStorage.getItem(`adk.${k}`) ?? "[]");
  const write = (k: string, v: unknown) => localStorage.setItem(`adk.${k}`, JSON.stringify(v));
  const upsert = <T extends { id: string }>(k: string, item: T) =>
    write(k, [...read<T>(k).filter((x) => x.id !== item.id), item]);
  return {
    async ascents() {
      return read<Ascent>("ascents").sort((a, b) => a.date.localeCompare(b.date));
    },
    async putAscent(a) {
      upsert("ascents", a);
    },
    async deleteAscent(id) {
      write("ascents", read<Ascent>("ascents").filter((a) => a.id !== id));
    },
    async deleteRouteAscents(routeId) {
      write("ascents", read<Ascent>("ascents").filter((a) => a.routeId !== routeId));
    },
    async routes() {
      return read<Route>("routes");
    },
    async putRoute(r) {
      upsert("routes", r);
    },
    async deleteRoute(id) {
      write("routes", read<Route>("routes").filter((r) => r.id !== id));
    },
    async campsites() {
      return read<Campsite>("campsites");
    },
    async putCampsite(c) {
      upsert("campsites", c);
    },
    async deleteCampsite(id) {
      write("campsites", read<Campsite>("campsites").filter((c) => c.id !== id));
    },
    async getSetting(key) {
      return localStorage.getItem(`adk.setting.${key}`);
    },
    async setSetting(key, value) {
      localStorage.setItem(`adk.setting.${key}`, value);
    },
  };
}

let store: Promise<Store> | null = null;
export function getStore(): Promise<Store> {
  store ??= isTauri ? sqliteStore() : Promise.resolve(localStore());
  return store;
}

/** Everything the user has entered, for backup or moving to another device. */
export interface ExportFile {
  app: "adk-mapping";
  version: 1;
  ascents: Ascent[];
  routes: Route[];
  campsites?: Campsite[]; // added after the first release; older backups lack it
}

export async function exportAll(): Promise<ExportFile> {
  const s = await getStore();
  return { app: "adk-mapping", version: 1, ascents: await s.ascents(), routes: await s.routes(), campsites: await s.campsites() };
}

export async function importAll(data: ExportFile): Promise<void> {
  if (data.app !== "adk-mapping") throw new Error("Not an ADK Mapping backup file");
  const s = await getStore();
  for (const a of data.ascents) await s.putAscent(a);
  for (const r of data.routes) await s.putRoute(r);
  for (const c of data.campsites ?? []) await s.putCampsite(c);
}
