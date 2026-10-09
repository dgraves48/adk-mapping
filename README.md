# ADK High Peaks

Desktop app (Tauri 2 + React + MapLibre) for tracking the Adirondack 46 and planning routes in the High Peaks, built to work offline.

## Features

- **Peak Tracker**: the official 46 plus 7 other 4000-footers. Every ascent is logged with notes, and Winter 46 progress (Dec 21 – Mar 20) is tracked separately. The table sorts and filters on every column.
- **Map**: an offline topo map (OSM vector basemap, hillshade, contours in feet) showing trails, herd paths, peaks, lean-tos, campsites and trailheads, with live GPS position.
- **Routes**: click points on the map to build a route along the shortest path on trails and roads. Points snap to trails by default. With snapping off, the new point connects with a straight line. You can drag points, drag or click the line to add a point in between, click an existing point to route back to it, right-click a point to remove it, and undo/redo point edits (⌘Z / ⇧⌘Z).
  - **Campsites:** clicking a campsite makes it a stop. Stops marked "Night" split the trip into days, with a per-day table of miles, gain and loss. The elevation profile shows peaks, campsites and day dividers.
  - **Ascents:** a completed route logs ascents, with each peak's date auto-filled for you to confirm.
  - **All routes:** "Show all routes" draws every saved route (completed in green, planned in purple), filtered by status or peak.

## Storage footprint

| Piece | Size | Notes |
|---|---|---|
| Core data (bundled) | ~2 MB | trails/routing graph, peaks, campsites. Always offline |
| `basemap.pmtiles` (optional) | ~7 MB | water, forest, roads, labels, z0–15 |
| `terrain.pmtiles` (optional) | ~7.4 MB | terrarium DEM z6–13 as lossless WebP: hillshade, contours, off-trail elevation |

Without the optional packs the map falls back to online tiles: Tracestrack Topo if you add an API key in Settings, otherwise OpenTopoMap.

## Develop

```sh
npm install
npm run packs:install   # copy packs/ into the app's data folder
npm run tauri dev       # desktop app
npm run dev             # browser preview at http://localhost:1420 (uses localStorage)
npm test
```

## Rebuilding the data

Requires Python 3 with `requests` and `Pillow`. `tools/pmtiles` is the go-pmtiles CLI.

```sh
npm run data:osm     # Overpass → build/osm.json (trails, roads, peaks, campsites, trailheads)
                     # (cd scripts && python3 fetch_osm.py roads → refresh only the major roads)
npm run data:core    # → public/data/*.json (bundled), node elevations from the DEM
npm run data:packs   # → packs/basemap.pmtiles (Protomaps extract), packs/terrain.pmtiles
```

The region's bounding box is in `scripts/config.py`, and the tracked peak list is in `scripts/peaks_list.py`.

To let the app download packs itself, upload `packs/*.pmtiles` somewhere (for example a GitHub release) and paste that folder URL into Settings → Pack download URL.

## Data sources

- Trails, peaks, campsites: © OpenStreetMap contributors (ODbL), via Overpass
- Basemap: Protomaps daily build (OSM)
- Elevation: AWS Terrain Tiles (terrarium; USGS 3DEP in the US)
- Official 46 elevations: the traditional 46er list

## Mobile later

Tauri 2 builds iOS and Android from the same code (`npm run tauri ios init` / `android init`). Things to expect:

- Swap `navigator.geolocation` for `@tauri-apps/plugin-geolocation` to get background-capable GPS.
- Turn the side panels into bottom sheets.
- Storage (SQLite plugin) and the packs (fs plugin) already work on mobile.
