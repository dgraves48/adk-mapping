import { useEffect, useMemo, useRef, useState } from "react";
import { FT_PER_M, M_PER_MILE } from "../lib/geo";
import type { RouteGeometry } from "../lib/routing";

export interface ProfileMarker {
  kind: "peak" | "camp" | "day";
  idx: number; // route coordinate index
  label: string;
}

interface Props {
  geom: RouteGeometry;
  markers?: ProfileMarker[];
  onHover(idx: number | null): void;
}

const H = 176;
const PAD = { l: 44, r: 10, t: 30, b: 22 };
const LABEL_W = 70; // approx. px a label needs before another can share its row

function niceStep(range: number, target: number) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/** Elevation (ft) against distance (mi), with a crosshair that also marks the spot on the map. */
export default function ElevationProfile({ geom, markers = [], onHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const d = useMemo(() => {
    const mi = geom.dist.map((x) => x / M_PER_MILE);
    const ft = geom.ele.map((e) => e * FT_PER_M);
    const maxX = mi[mi.length - 1] || 1;
    let lo = Math.min(...ft), hi = Math.max(...ft);
    const yStep = niceStep(Math.max(hi - lo, 200), 4);
    lo = Math.floor(lo / yStep) * yStep;
    hi = Math.ceil(hi / yStep) * yStep;
    const xStep = niceStep(maxX, 5);
    return { mi, ft, maxX, lo, hi, yStep, xStep };
  }, [geom]);

  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (v: number) => PAD.l + (v / d.maxX) * iw;
  const y = (v: number) => PAD.t + ih - ((v - d.lo) / (d.hi - d.lo)) * ih;
  const line = d.mi.map((m, i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(d.ft[i]).toFixed(1)}`).join("");
  const area = `${line}L${x(d.maxX)},${y(d.lo)}L${x(0)},${y(d.lo)}Z`;

  const yTicks: number[] = [];
  for (let v = d.lo; v <= d.hi + 1e-6; v += d.yStep) yTicks.push(v);
  const xTicks: number[] = [];
  for (let v = 0; v <= d.maxX + 1e-6; v += d.xStep) xTicks.push(v);

  // Peak and campsite labels sit above the plot in two staggered rows; one that won't fit is dropped
  // (its marker stays, and the hover tooltip names it).
  const placed = useMemo(() => {
    const rows: number[] = [-Infinity, -Infinity];
    return [...markers]
      .filter((m) => m.kind !== "day")
      .sort((a, b) => a.idx - b.idx)
      .map((m) => {
        const px = PAD.l + (d.mi[m.idx] / d.maxX) * (W - PAD.l - PAD.r);
        const row = rows.findIndex((r) => px - r >= LABEL_W);
        if (row >= 0) rows[row] = px;
        return { ...m, px, row };
      });
  }, [markers, d, W]);

  const near = hover != null ? markers.filter((m) => m.kind !== "day" && Math.abs(d.mi[m.idx] - d.mi[hover]) < d.maxX * 0.02) : [];

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - r.left - PAD.l) / iw) * d.maxX;
    if (mx < 0 || mx > d.maxX) return leave();
    // binary search nearest distance
    let lo = 0, hi = d.mi.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d.mi[mid] < mx) lo = mid;
      else hi = mid;
    }
    const idx = mx - d.mi[lo] < d.mi[hi] - mx ? lo : hi;
    setHover(idx);
    onHover(idx);
  }
  function leave() {
    setHover(null);
    onHover(null);
  }

  return (
    <div ref={box} className="profile">
      <svg width={W} height={H} onPointerMove={move} onPointerLeave={leave} role="img" aria-label="Elevation profile">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.l - 6} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - 6} className="tick" textAnchor="middle">
            {+v.toFixed(1)} mi
          </text>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {markers
          .filter((m) => m.kind === "day")
          .map((m) => (
            <g key={`day-${m.idx}`}>
              <line x1={x(d.mi[m.idx])} x2={x(d.mi[m.idx])} y1={PAD.t} y2={PAD.t + ih} className="day-line" />
              <text x={x(d.mi[m.idx]) + 3} y={PAD.t + ih - 4} className="day-label">
                {m.label}
              </text>
            </g>
          ))}
        {placed.map((m, i) => {
          const cx = x(d.mi[m.idx]), cy = y(d.ft[m.idx]);
          return (
            <g key={`${m.kind}-${m.idx}-${i}`} className={`mk ${m.kind}`}>
              {m.row >= 0 && <line x1={cx} x2={cx} y1={m.row ? 21 : 11} y2={cy - 6} className="leader" />}
              {m.kind === "peak" ? (
                <path d={`M${cx},${cy - 7} L${cx + 5},${cy + 2} L${cx - 5},${cy + 2} Z`} />
              ) : (
                <circle cx={cx} cy={cy} r={4.5} />
              )}
              {m.row >= 0 && (
                <text x={cx} y={m.row ? 18 : 8} textAnchor="middle">
                  {m.label.length > 14 ? `${m.label.slice(0, 13)}…` : m.label}
                </text>
              )}
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={x(d.mi[hover])} x2={x(d.mi[hover])} y1={PAD.t} y2={PAD.t + ih} className="crosshair" />
            <circle cx={x(d.mi[hover])} cy={y(d.ft[hover])} r={4} className="dot" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="profile-tip" style={{ left: Math.min(x(d.mi[hover]) + 8, W - 110) }}>
          <strong>{Math.round(d.ft[hover]).toLocaleString()} ft</strong>
          <span>{d.mi[hover].toFixed(2)} mi</span>
          {near.map((m) => (
            <span key={`${m.kind}-${m.idx}`} className="tip-mark">
              {m.kind === "peak" ? "▲" : "⛺"} {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
