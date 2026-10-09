import Flatbush from "flatbush";
import { distance, projectOnSegment, type LngLat } from "./geo";

/** Compact trail network, as written by scripts/build_core.py. */
export interface TrailData {
  coords: number[]; // lon,lat interleaved
  ele: number[]; // metres, one per node
  ways: { k: TrailKind; n?: string; i: number[] }[];
}
export type TrailKind = "trail" | "herd" | "track" | "road";

/** A position on the network: a fraction `t` along segment `seg`. */
export interface Snap {
  seg: number;
  t: number;
  point: LngLat;
  dist: number; // metres from the query point
}

export interface PathResult {
  coords: LngLat[];
  ele: number[];
  length: number;
}

/** Binary min-heap keyed by float priority, storing int node ids. */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    const { ids, pri } = this;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }
  pop(): number {
    const { ids, pri } = this;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}

export class TrailRouter {
  readonly nodeCount: number;
  private coords: Float64Array;
  private ele: Float32Array;
  // CSR adjacency
  private adjStart: Int32Array;
  private adjNode: Int32Array;
  private adjLen: Float32Array;
  // segments (consecutive node pairs along ways)
  private segA: Int32Array;
  private segB: Int32Array;
  private segLen: Float32Array;
  readonly segKind: TrailKind[];
  private index: Flatbush;

  constructor(data: TrailData) {
    this.nodeCount = data.ele.length;
    this.coords = Float64Array.from(data.coords);
    this.ele = Float32Array.from(data.ele);

    let segCount = 0;
    for (const w of data.ways) segCount += w.i.length - 1;
    this.segA = new Int32Array(segCount);
    this.segB = new Int32Array(segCount);
    this.segLen = new Float32Array(segCount);
    this.segKind = new Array(segCount);
    const degree = new Int32Array(this.nodeCount);
    let s = 0;
    for (const w of data.ways) {
      for (let j = 0; j < w.i.length - 1; j++, s++) {
        const a = w.i[j], b = w.i[j + 1];
        this.segA[s] = a;
        this.segB[s] = b;
        this.segLen[s] = distance(this.pt(a), this.pt(b));
        this.segKind[s] = w.k;
        degree[a]++;
        degree[b]++;
      }
    }

    this.adjStart = new Int32Array(this.nodeCount + 1);
    for (let i = 0; i < this.nodeCount; i++) this.adjStart[i + 1] = this.adjStart[i] + degree[i];
    this.adjNode = new Int32Array(this.adjStart[this.nodeCount]);
    this.adjLen = new Float32Array(this.adjStart[this.nodeCount]);
    const fill = this.adjStart.slice(0, this.nodeCount);
    for (let i = 0; i < segCount; i++) {
      const a = this.segA[i], b = this.segB[i], len = this.segLen[i];
      this.adjNode[fill[a]] = b;
      this.adjLen[fill[a]++] = len;
      this.adjNode[fill[b]] = a;
      this.adjLen[fill[b]++] = len;
    }

    this.index = new Flatbush(Math.max(segCount, 1));
    for (let i = 0; i < segCount; i++) {
      const a = this.pt(this.segA[i]), b = this.pt(this.segB[i]);
      this.index.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    }
    if (segCount === 0) this.index.add(0, 0, 0, 0);
    this.index.finish();
  }

  pt(i: number): LngLat {
    return [this.coords[2 * i], this.coords[2 * i + 1]];
  }

  /** Nearest point on the trail network to p, or null if nothing within maxDist metres. */
  nearest(p: LngLat, maxDist = 5000): Snap | null {
    // Flatbush ranks by planar degree distance; over-fetch and re-rank in metres.
    const cand = this.index.neighbors(p[0], p[1], 40, maxDist / 80000);
    let best: Snap | null = null;
    for (const seg of cand) {
      if (seg >= this.segA.length) continue;
      const pr = projectOnSegment(p, this.pt(this.segA[seg]), this.pt(this.segB[seg]));
      if (pr.dist <= maxDist && (!best || pr.dist < best.dist)) best = { seg, t: pr.t, point: pr.point, dist: pr.dist };
    }
    return best;
  }

  eleAt(s: Snap): number {
    const a = this.ele[this.segA[s.seg]], b = this.ele[this.segB[s.seg]];
    return a + (b - a) * s.t;
  }

  /** Shortest path along the network between two snapped positions (A*). */
  route(from: Snap, to: Snap): PathResult | null {
    const fa = this.segA[from.seg], fb = this.segB[from.seg], fl = this.segLen[from.seg];
    const ta = this.segA[to.seg], tb = this.segB[to.seg], tl = this.segLen[to.seg];

    let best = Infinity;
    let bestEnd = -1; // node through which we reach the target segment; -2 = same segment
    if (from.seg === to.seg) {
      best = Math.abs(from.t - to.t) * fl;
      bestEnd = -2;
    }

    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const target = to.point;
    const h = (i: number) => distance(this.pt(i), target);
    const heap = new Heap();
    const seed = (node: number, cost: number) => {
      if (cost < g[node]) {
        g[node] = cost;
        prev[node] = -1;
        heap.push(node, cost + h(node));
      }
    };
    seed(fa, from.t * fl);
    seed(fb, (1 - from.t) * fl);
    const tailCost = (node: number) =>
      node === ta ? to.t * tl : node === tb ? (1 - to.t) * tl : Infinity;

    const done = new Uint8Array(n);
    while (heap.size) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (g[u] + h(u) >= best) break;
      const tc = tailCost(u);
      if (g[u] + tc < best) {
        best = g[u] + tc;
        bestEnd = u;
      }
      for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) {
        const v = this.adjNode[e];
        const ng = g[u] + this.adjLen[e];
        if (ng < g[v]) {
          g[v] = ng;
          prev[v] = u;
          heap.push(v, ng + h(v));
        }
      }
    }
    if (bestEnd === -1) return null;

    const coords: LngLat[] = [from.point];
    const ele: number[] = [this.eleAt(from)];
    if (bestEnd >= 0) {
      const nodes: number[] = [];
      for (let u = bestEnd; u !== -1; u = prev[u]) nodes.push(u);
      nodes.reverse();
      for (const u of nodes) {
        coords.push(this.pt(u));
        ele.push(this.ele[u]);
      }
    }
    coords.push(to.point);
    ele.push(this.eleAt(to));
    return { coords, ele, length: best };
  }
}
