import { FetchSource, PMTiles, type RangeResponse, type Source } from "pmtiles";
import { isTauri } from "./db";

/**
 * Optional offline map packs. Each is a single PMTiles file kept in the app's
 * data folder (…/packs). Without them the map falls back to online tiles.
 */
export interface PackInfo {
  id: "basemap" | "terrain";
  file: string;
  label: string;
  detail: string;
}

export const PACKS: PackInfo[] = [
  {
    id: "basemap",
    file: "basemap.pmtiles",
    label: "Topo basemap",
    detail: "Water, forest, roads, place names (≈7 MB)",
  },
  {
    id: "terrain",
    file: "terrain.pmtiles",
    label: "Terrain",
    detail: "Hillshade, contour lines, off-trail elevation (≈7 MB)",
  },
];

export interface PackStatus {
  info: PackInfo;
  installed: boolean;
  sizeMB?: number;
}

/** Reads byte ranges from a local file through the Tauri fs plugin. */
class FsSource implements Source {
  private handle: Promise<import("@tauri-apps/plugin-fs").FileHandle>;
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private key: string, path: string) {
    this.handle = import("@tauri-apps/plugin-fs").then((fs) => fs.open(path, { read: true }));
  }
  getKey() {
    return this.key;
  }
  getBytes(offset: number, length: number): Promise<RangeResponse> {
    // One shared handle: serialize seek+read pairs.
    const job = this.lock.then(async () => {
      const fs = await import("@tauri-apps/plugin-fs");
      const h = await this.handle;
      await h.seek(offset, fs.SeekMode.Start);
      const buf = new Uint8Array(length);
      let got = 0;
      while (got < length) {
        const n = await h.read(buf.subarray(got));
        if (!n) break;
        got += n;
      }
      return { data: buf.buffer.slice(0, got) };
    });
    this.lock = job.catch(() => undefined);
    return job;
  }
}

async function packDir(): Promise<string> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), "packs");
}

export async function packPath(p: PackInfo): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  return join(await packDir(), p.file);
}

export async function packStatus(): Promise<PackStatus[]> {
  return Promise.all(
    PACKS.map(async (info) => {
      if (isTauri) {
        const fs = await import("@tauri-apps/plugin-fs");
        const path = await packPath(info);
        if (!(await fs.exists(path))) return { info, installed: false };
        const st = await fs.stat(path);
        return { info, installed: true, sizeMB: st.size / 1e6 };
      }
      // Browser dev mode: vite serves ./packs at /packs
      const r = await fetch(`/packs/${info.file}`, { method: "HEAD" }).catch(() => null);
      const len = Number(r?.headers.get("content-length") ?? 0);
      return r?.ok && len > 0 ? { info, installed: true, sizeMB: len / 1e6 } : { info, installed: false };
    }),
  );
}

/** Open an installed pack, or null if it isn't installed. */
export async function openPack(id: PackInfo["id"]): Promise<PMTiles | null> {
  const status = (await packStatus()).find((s) => s.info.id === id);
  if (!status?.installed) return null;
  if (isTauri) return new PMTiles(new FsSource(id, await packPath(status.info)));
  const src = new FetchSource(`/packs/${status.info.file}`);
  // Keyed by pack id so styles can always refer to pmtiles://<id>.
  return new PMTiles({ getKey: () => id, getBytes: (o, l, s, e) => src.getBytes(o, l, s, e) });
}

/** Copy a .pmtiles file chosen by the user into the packs folder. */
export async function importPack(info: PackInfo): Promise<boolean> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const fs = await import("@tauri-apps/plugin-fs");
  const src = await open({ filters: [{ name: "PMTiles", extensions: ["pmtiles"] }] });
  if (!src || Array.isArray(src)) return false;
  await fs.mkdir(await packDir(), { recursive: true });
  await fs.copyFile(src, await packPath(info));
  return true;
}

/** Download a pack from `baseUrl/<file>` into the packs folder. */
export async function downloadPack(info: PackInfo, baseUrl: string, onProgress: (f: number) => void) {
  const fs = await import("@tauri-apps/plugin-fs");
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/${info.file}`);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  await fs.mkdir(await packDir(), { recursive: true });
  await fs.writeFile(await packPath(info), all);
}

export async function removePack(info: PackInfo) {
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.remove(await packPath(info));
}
