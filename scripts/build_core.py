"""Turn build/osm.json into the small core data bundled with the app (public/data):

  trails.json     routable trail/road network with per-node elevation
  peaks.json      tracked peaks (official 46 + extra 4000-footers) and other named summits
  campsites.json  lean-tos and designated campsites
  trailheads.json trailheads and trail parking
"""
import json
import math
import re
from config import APP_DATA, BBOX, BUILD
from peaks_list import PEAKS
from terrain import Sampler

FT = 3.28084
SIMPLIFY_M = 2.0

TRAIL = {"path", "footway", "bridleway", "steps"}
NO_FOOT = {"no", "private"}
FOOT_OK = {"yes", "designated", "permissive"}


def slug(name):
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-").replace("--", "-")


def kind(tags):
    hw = tags["highway"]
    if hw in TRAIL:
        if tags.get("informal") == "yes" or tags.get("trail_visibility") in ("bad", "horrible", "no"):
            return "herd"
        return "trail"
    return "track" if hw == "track" else "road"


def walkable(tags):
    if tags.get("foot") in NO_FOOT:
        return False
    if tags.get("access") in ("no", "private") and tags.get("foot") not in FOOT_OK:
        return False
    if tags.get("service") in ("driveway", "parking_aisle", "drive-through"):
        return False
    return True


def xy(lon, lat, lat0):
    return (lon * 111320 * math.cos(math.radians(lat0)), lat * 110540)


def simplify(pts, keep, tol):
    """Douglas-Peucker on local metres; `keep` marks indices that must survive."""
    lat0 = pts[0][1]
    P = [xy(*p, lat0) for p in pts]
    out = {0, len(pts) - 1} | {i for i in range(len(pts)) if keep[i]}
    anchors = sorted(out)
    stack = list(zip(anchors, anchors[1:]))
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        (ax, ay), (bx, by) = P[a], P[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = P[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            out.add(bi)
            stack += [(a, bi), (bi, b)]
    return sorted(out)


def center(e):
    if e["type"] == "node":
        return e["lon"], e["lat"]
    g = e.get("geometry") or []
    if not g:
        b = e["bounds"]
        return (b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2
    return sum(p["lon"] for p in g) / len(g), sum(p["lat"] for p in g) / len(g)


def in_bbox(lon, lat):
    w, s, e, n = BBOX
    return w <= lon <= e and s <= lat <= n


def write(name, obj):
    p = APP_DATA / name
    p.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"{name}: {p.stat().st_size/1e3:.0f} kB")


def build_trails(els, dem):
    ways = [e for e in els if e["type"] == "way" and "highway" in e.get("tags", {})
            and walkable(e["tags"]) and e.get("geometry")]
    use = {}
    for w in ways:
        for n in w["nodes"]:
            use[n] = use.get(n, 0) + 1
    endpoints = {w["nodes"][0] for w in ways} | {w["nodes"][-1] for w in ways}

    index, coords, ele = {}, [], []

    def node(nid, lon, lat):
        if nid not in index:
            index[nid] = len(index)
            coords.extend((round(lon, 5), round(lat, 5)))
            ele.append(round(dem(lon, lat)))
        return index[nid]

    out = []
    for w in ways:
        pts = [(g["lon"], g["lat"]) for g in w["geometry"]]
        keep = [use[n] > 1 or n in endpoints for n in w["nodes"]]
        idx = simplify(pts, keep, SIMPLIFY_M)
        rec = {"k": kind(w["tags"]), "i": [node(w["nodes"][i], *pts[i]) for i in idx]}
        name = w["tags"].get("name")
        if name:
            rec["n"] = name
        out.append(rec)
    print(f"trails: {len(out)} ways, {len(ele)} nodes (from {len(use)})")
    return {"coords": coords, "ele": ele, "ways": out}


def build_peaks(els, dem):
    osm = [e for e in els if e.get("tags", {}).get("natural") == "peak" and e["tags"].get("name")]
    by_name = {}
    for p in osm:
        by_name.setdefault(p["tags"]["name"], []).append(p)

    def osm_ele(p):
        try:
            return float(p["tags"]["ele"])
        except (KeyError, ValueError):
            return dem(p["lon"], p["lat"])

    tracked, used = [], set()
    for name, elev, official, alts in PEAKS:
        cands = [p for a in alts for p in by_name.get(a, [])]
        if not cands:
            raise SystemExit(f"peak not found in OSM: {name}")
        p = max(cands, key=osm_ele)
        used.add(p["id"])
        tracked.append({
            "id": slug(name), "name": name, "official": official,
            "elevationFt": elev if elev else round(osm_ele(p) * FT / 10) * 10,
            "lngLat": [round(p["lon"], 5), round(p["lat"], 5)],
        })
    others = [{
        "name": p["tags"]["name"],
        "elevationFt": round(osm_ele(p) * FT),
        "lngLat": [round(p["lon"], 5), round(p["lat"], 5)],
    } for p in osm if p["id"] not in used and in_bbox(p["lon"], p["lat"])]
    return {"tracked": tracked, "other": others}


def dist_m(a, b):
    kx = 111320 * math.cos(math.radians(a[1]))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def name_unnamed(sites, trails):
    """Give unnamed sites a findable name: near a named site, else on a named trail."""
    generic = re.compile(r"^(Campsite|Lean-to)( #?\w+)?$")
    named = [s for s in sites if not generic.match(s["name"])]
    lines = []
    for w in trails["ways"]:
        if w.get("n") and w["k"] != "road":
            pts = [(trails["coords"][2 * i], trails["coords"][2 * i + 1]) for i in w["i"]]
            lines.append((w["n"], pts))
    for s in sites:
        if s in named:
            continue
        near = min(named, key=lambda n: dist_m(n["lngLat"], s["lngLat"]), default=None)
        if near and dist_m(near["lngLat"], s["lngLat"]) < 800:
            s["name"] = f"{s['name']} near {near['name']}"
            continue
        best = min(((dist_m(p, s["lngLat"]), n) for n, pts in lines for p in pts), default=None)
        if best and best[0] < 400:
            s["name"] = f"{s['name']} on {best[1]}"
    counts = {}
    for s in sites:
        counts[s["name"]] = counts.get(s["name"], 0) + 1
    seen = {}
    for s in sites:
        if counts[s["name"]] > 1:
            seen[s["name"]] = seen.get(s["name"], 0) + 1
            s["name"] = f"{s['name']} ({seen[s['name']]})"
    return sites


def build_campsites(els):
    out, seen = [], set()
    for e in els:
        t = e.get("tags", {})
        tourism, amenity = t.get("tourism"), t.get("amenity")
        if tourism in ("camp_site", "camp_pitch", "wilderness_hut"):
            k = "hut" if tourism == "wilderness_hut" else "campsite"
        elif amenity == "shelter" and t.get("shelter_type") in (None, "lean_to", "basic_hut"):
            k = "lean-to"
        else:
            continue
        lon, lat = center(e)
        if not in_bbox(lon, lat):
            continue
        name = t.get("name") or ""
        if name.startswith("#") or not name:
            ref = name or t.get("ref", "")
            name = f"{'Lean-to' if k == 'lean-to' else 'Campsite'} {ref}".strip()
        key = (name, round(lon, 4), round(lat, 4))
        if key in seen:
            continue
        seen.add(key)
        out.append({"id": f"{e['type'][0]}{e['id']}", "name": name, "kind": k,
                    "lngLat": [round(lon, 5), round(lat, 5)]})
    return out


def build_trailheads(els):
    out = []
    for e in els:
        t = e.get("tags", {})
        if t.get("highway") != "trailhead" and t.get("amenity") != "parking":
            continue
        lon, lat = center(e)
        if in_bbox(lon, lat):
            out.append({"id": f"{e['type'][0]}{e['id']}", "name": t.get("name") or "Trailhead",
                        "lngLat": [round(lon, 5), round(lat, 5)]})
    return out


if __name__ == "__main__":
    els = json.loads((BUILD / "osm.json").read_text())["elements"]
    roads = BUILD / "osm_roads.json"  # from `fetch_osm.py roads`; a full fetch already includes them
    if roads.exists():
        seen = {(e["type"], e["id"]) for e in els}
        els += [e for e in json.loads(roads.read_text())["elements"] if (e["type"], e["id"]) not in seen]
    dem = Sampler()
    trails = build_trails(els, dem)
    write("trails.json", trails)
    write("peaks.json", build_peaks(els, dem))
    write("campsites.json", name_unnamed(build_campsites(els), trails))
    write("trailheads.json", build_trailheads(els))
