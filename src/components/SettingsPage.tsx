import { useState } from "react";
import { exportAll, importAll, isTauri, type ExportFile } from "../lib/db";
import { todayIso } from "../lib/dates";
import { downloadPack, importPack, removePack, type PackStatus } from "../lib/packs";

interface Props {
  packs: PackStatus[];
  tracestrackKey: string;
  packUrl: string;
  onSetting(key: "tracestrackKey" | "packUrl", value: string): void;
  onPacksChanged(): void;
  onDataImported(): void;
}

export default function SettingsPage(p: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState(p.tracestrackKey);
  const [url, setUrl] = useState(p.packUrl);

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function backup() {
    const data = JSON.stringify(await exportAll(), null, 1);
    const name = `adk-backup-${todayIso()}.json`;
    if (isTauri) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: name, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) await writeTextFile(path, data);
      if (path) setMsg(`Saved ${path}`);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      a.download = name;
      a.click();
    }
  }

  async function restore() {
    let text: string | null = null;
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path && !Array.isArray(path)) text = await readTextFile(path);
    } else {
      text = await new Promise<string | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = () => (input.files?.[0] ? input.files[0].text().then(resolve) : resolve(null));
        input.click();
      });
    }
    if (!text) return;
    const data: ExportFile = JSON.parse(text);
    await importAll(data);
    setMsg(`Imported ${data.ascents.length} ascents, ${data.routes.length} routes and ${data.campsites?.length ?? 0} campsites.`);
    p.onDataImported();
  }

  const total = p.packs.reduce((s, x) => s + (x.sizeMB ?? 0), 0);

  return (
    <div className="page settings">
      <div className="page-main narrow">
        <h2>Offline maps</h2>
        <p className="muted">
          Trails, peaks, campsites and routing always work offline (they're built into the app, about 2 MB). These optional
          packs add the topo map and terrain. Without them the map uses online tiles. Installed: {total.toFixed(1)} MB.
        </p>
        <table className="data packs">
          <tbody>
            {p.packs.map((s) => (
              <tr key={s.info.id}>
                <td>
                  <strong>{s.info.label}</strong>
                  <div className="muted small">{s.info.detail}</div>
                </td>
                <td>{s.installed ? <span className="yes">Installed · {s.sizeMB?.toFixed(1)} MB</span> : <span className="no">Not installed</span>}</td>
                <td className="right actions">
                  {isTauri && (
                    <>
                      {url && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            run(`Download ${s.info.label}`, async () => {
                              await downloadPack(s.info, url, (f) => setBusy(`Downloading ${s.info.label} ${Math.round(f * 100)}%`));
                              p.onPacksChanged();
                            })
                          }
                        >
                          {s.installed ? "Update" : "Download"}
                        </button>
                      )}
                      <button disabled={!!busy} onClick={() => run("Import", async () => (await importPack(s.info)) && p.onPacksChanged())}>
                        Import file…
                      </button>
                      {s.installed && (
                        <button
                          className="danger"
                          disabled={!!busy}
                          onClick={() => run("Remove", async () => (await removePack(s.info), p.onPacksChanged()))}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isTauri && <p className="muted small">Browser preview: packs are served from the project's packs/ folder.</p>}
        <label className="field">
          Pack download URL <span className="muted small">(folder that hosts basemap.pmtiles and terrain.pmtiles)</span>
          <div className="inline-add">
            <input value={url} placeholder="https://…/releases/download/maps-2026-10" onChange={(e) => setUrl(e.target.value)} />
            <button onClick={() => p.onSetting("packUrl", url.trim())}>Save</button>
          </div>
        </label>

        <h2>Online map</h2>
        <label className="field">
          Tracestrack API key <span className="muted small">(optional; used for the online map when the topo pack isn't installed)</span>
          <div className="inline-add">
            <input value={key} placeholder="free key from tracestrack.com" onChange={(e) => setKey(e.target.value)} />
            <button onClick={() => p.onSetting("tracestrackKey", key.trim())}>Save</button>
          </div>
        </label>
        <p className="muted small">Without a key the online fallback is OpenTopoMap.</p>

        <h2>Your data</h2>
        <p className="muted">
          Ascents, routes and your campsites are stored on this computer{isTauri ? " (SQLite)" : " (browser storage)"}. Back them up, or move them
          to another device, with a JSON file.
        </p>
        <div className="panel-actions">
          <button onClick={() => run("Backup", backup)}>Export backup…</button>
          <button onClick={() => run("Restore", restore)}>Import backup…</button>
        </div>

        {busy && <p className="status">{busy}…</p>}
        {msg && <p className="status">{msg}</p>}
      </div>
    </div>
  );
}
