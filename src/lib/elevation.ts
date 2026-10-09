import type { PMTiles } from "pmtiles";
import type { LngLat } from "./geo";

const Z = 13;

/** Samples terrarium-encoded DEM tiles from the terrain pack. */
export class ElevationSampler {
  private tiles = new Map<string, Promise<ImageData | null>>();
  constructor(private pm: PMTiles) {}

  private tile(x: number, y: number): Promise<ImageData | null> {
    const key = `${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = this.pm.getZxy(Z, x, y).then(async (res) => {
        if (!res) return null;
        const bmp = await createImageBitmap(new Blob([res.data], { type: "image/webp" }));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      }).catch(() => null);
      this.tiles.set(key, t);
    }
    return t;
  }

  async sample(points: LngLat[]): Promise<(number | null)[]> {
    const n = 2 ** Z;
    return Promise.all(
      points.map(async ([lon, lat]) => {
        const fx = ((lon + 180) / 360) * n;
        const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
        const tx = Math.floor(fx), ty = Math.floor(fy);
        const img = await this.tile(tx, ty);
        if (!img) return null;
        const px = Math.min(img.width - 1, Math.floor((fx - tx) * img.width));
        const py = Math.min(img.height - 1, Math.floor((fy - ty) * img.height));
        const o = (py * img.width + px) * 4;
        const d = img.data;
        return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
      }),
    );
  }
}
