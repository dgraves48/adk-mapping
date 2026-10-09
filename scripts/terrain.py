"""Terrarium elevation tiles (AWS open data, USGS 3DEP in the US): download, cache, sample."""
import io
import math
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image
from config import BBOX, BUILD, USER_AGENT

CACHE = BUILD / "terrarium"
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
MAX_Z = 13


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tiles_for_bbox(z, bbox=BBOX):
    w, s, e, n = bbox
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    return [(z, x, y) for x in range(int(x0), int(x1) + 1) for y in range(int(y0), int(y1) + 1)]


def tile_path(z, x, y):
    return CACHE / str(z) / str(x) / f"{y}.png"


def download(t):
    p = tile_path(*t)
    if p.exists():
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(URL.format(z=t[0], x=t[1], y=t[2]), headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    p.write_bytes(r.content)
    return p


def download_all(min_z=6, max_z=MAX_Z):
    tiles = [t for z in range(min_z, max_z + 1) for t in tiles_for_bbox(z)]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(download, tiles))
    return tiles


class Sampler:
    """Bilinear elevation lookup (metres) from cached max-zoom tiles."""

    def __init__(self, z=MAX_Z):
        self.z = z
        self.tiles = {}

    def _px(self, x, y):
        img = self.tiles.get((x, y))
        if img is None:
            img = Image.open(download((self.z, x, y))).convert("RGB").load()
            self.tiles[(x, y)] = img
        return img

    def _elev(self, gx, gy):
        tx, px = divmod(gx, 256)
        ty, py = divmod(gy, 256)
        r, g, b = self._px(tx, ty)[px, py]
        return r * 256 + g + b / 256 - 32768

    def __call__(self, lon, lat):
        fx, fy = lonlat_to_tile(lon, lat, self.z)
        gx, gy = fx * 256 - 0.5, fy * 256 - 0.5
        ix, iy = int(math.floor(gx)), int(math.floor(gy))
        ax, ay = gx - ix, gy - iy
        e00, e10 = self._elev(ix, iy), self._elev(ix + 1, iy)
        e01, e11 = self._elev(ix, iy + 1), self._elev(ix + 1, iy + 1)
        return (e00 * (1 - ax) + e10 * ax) * (1 - ay) + (e01 * (1 - ax) + e11 * ax) * ay
