"""Extract the region from the Protomaps planet build into packs/basemap.pmtiles.

Uses HTTP range requests, so only the region's tiles are downloaded.
"""
import datetime
import subprocess
import requests
from config import BBOX, PACKS, ROOT

PMTILES = ROOT / "tools" / "pmtiles"


def latest_build():
    day = datetime.date.today()
    for _ in range(14):
        url = f"https://build.protomaps.com/{day:%Y%m%d}.pmtiles"
        if requests.head(url, timeout=30).status_code == 200:
            return url
        day -= datetime.timedelta(days=1)
    raise SystemExit("no recent Protomaps build found")


if __name__ == "__main__":
    src = latest_build()
    out = PACKS / "basemap.pmtiles"
    bbox = ",".join(str(v) for v in BBOX)
    print(f"extracting {bbox} from {src}")
    subprocess.run([str(PMTILES), "extract", src, str(out), f"--bbox={bbox}", "--maxzoom=15"], check=True)
    print(f"{out} ({out.stat().st_size/1e6:.1f} MB)")
