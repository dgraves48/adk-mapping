"""Download trails, peaks, campsites and trailheads for the region from Overpass.

The region is split into a grid of small queries so public Overpass servers
don't time out; results are merged and de-duplicated.
"""
import json
import sys
import time
import requests
from config import BBOX, BUILD, USER_AGENT

# Major roads (for road walks between trailheads). Kept separate so they can be
# refreshed without re-downloading everything: `python3 fetch_osm.py roads`.
ROAD_FILTERS = """
  way["highway"~"^(tertiary|secondary|primary|trunk)(_link)?$"]({bb});
"""

FILTERS = ROAD_FILTERS + """
  way["highway"~"^(path|footway|track|bridleway|steps|service|unclassified|residential)$"]({bb});
  node["natural"="peak"]({bb});
  node["tourism"~"^(camp_site|camp_pitch|wilderness_hut)$"]({bb});
  way["tourism"~"^(camp_site|camp_pitch|wilderness_hut)$"]({bb});
  node["amenity"="shelter"]({bb});
  way["amenity"="shelter"]({bb});
  node["highway"="trailhead"]({bb});
  node["amenity"="parking"]["name"~"[Tt]rail"]({bb});
  way["amenity"="parking"]["name"~"[Tt]rail"]({bb});
"""

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
GRID = 3


def query(bb, filters):
    q = f"[out:json][timeout:120];({filters.format(bb=bb)});out body geom;"
    for attempt in range(3):
        for url in MIRRORS:
            try:
                r = requests.post(url, data={"data": q}, headers={"User-Agent": USER_AGENT}, timeout=200)
                r.raise_for_status()
                return r.json()["elements"]
            except requests.RequestException as e:
                print(f"  {url}: {e}")
        time.sleep(10 * (attempt + 1))
    raise SystemExit("all Overpass mirrors failed")


if __name__ == "__main__":
    roads_only = sys.argv[1:] == ["roads"]
    filters, out = (ROAD_FILTERS, BUILD / "osm_roads.json") if roads_only else (FILTERS, BUILD / "osm.json")
    W, S, E, N = BBOX
    dx, dy = (E - W) / GRID, (N - S) / GRID
    seen = {}
    for i in range(GRID):
        for j in range(GRID):
            bb = f"{S + j*dy},{W + i*dx},{S + (j+1)*dy},{W + (i+1)*dx}"
            els = query(bb, filters)
            print(f"cell {i},{j}: {len(els)} elements")
            for e in els:
                seen[(e["type"], e["id"])] = e
    out.write_text(json.dumps({"elements": list(seen.values())}))
    print(f"{len(seen)} elements -> {out} ({out.stat().st_size/1e6:.1f} MB)")
