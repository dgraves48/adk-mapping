"""Build packs/terrain.pmtiles: terrarium DEM tiles for hillshade + contours.

Elevations are rounded to whole metres (blue channel zeroed) and stored as
lossless WebP, which roughly halves the size versus the source PNGs.
"""
import io
import sqlite3
import subprocess
from PIL import Image
from config import BBOX, BUILD, PACKS, ROOT
from terrain import MAX_Z, download_all, tile_path

PMTILES = ROOT / "tools" / "pmtiles"


def encode(path):
    img = Image.open(path).convert("RGB")
    r, g, b = img.split()
    img = Image.merge("RGB", (r, g, b.point(lambda _: 0)))
    buf = io.BytesIO()
    img.save(buf, "WEBP", lossless=True, quality=100, method=6)
    return buf.getvalue()


if __name__ == "__main__":
    tiles = download_all()
    mb = BUILD / "terrain.mbtiles"
    mb.unlink(missing_ok=True)
    db = sqlite3.connect(mb)
    db.execute("CREATE TABLE metadata (name TEXT, value TEXT)")
    db.execute("CREATE TABLE tiles (zoom_level INT, tile_column INT, tile_row INT, tile_data BLOB)")
    w, s, e, n = BBOX
    db.executemany("INSERT INTO metadata VALUES (?, ?)", [
        ("name", "ADK terrain"), ("format", "webp"), ("type", "baselayer"),
        ("minzoom", "6"), ("maxzoom", str(MAX_Z)), ("bounds", f"{w},{s},{e},{n}"),
        ("attribution", "Terrain: Mapzen terrarium / USGS 3DEP"),
        ("encoding", "terrarium"),
    ])
    png_total = webp_total = 0
    for z, x, y in tiles:
        p = tile_path(z, x, y)
        data = encode(p)
        png_total += p.stat().st_size
        webp_total += len(data)
        db.execute("INSERT INTO tiles VALUES (?, ?, ?, ?)", (z, x, (2 ** z - 1) - y, data))
    db.commit()
    db.close()
    out = PACKS / "terrain.pmtiles"
    out.unlink(missing_ok=True)
    subprocess.run([str(PMTILES), "convert", str(mb), str(out)], check=True, capture_output=True)
    print(f"{len(tiles)} tiles: png {png_total/1e6:.1f} MB -> webp {webp_total/1e6:.1f} MB; {out} ({out.stat().st_size/1e6:.1f} MB)")
