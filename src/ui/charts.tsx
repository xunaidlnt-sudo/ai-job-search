// Small SVG charts: cumulative lines (S-curves, quantity curves) and stacked
// weekly bars (resource histograms). Single y-axis, thin marks, legend plus
// direct end labels, crosshair/hover tooltips. Colours come from a validated
// categorical order and are assigned by series identity, never by rank.

import { useMemo, useRef, useState } from "react";
import { fmtDate } from "./store";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const OTHER = "#8a8f98";

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: { t: number; v: number | null }[];
}

const W = 640;
const H = 240;
const M = { l: 56, r: 92, t: 12, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function fmtNum(v: number, unit = ""): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : a >= 10 ? v.toFixed(0) : v.toFixed(1);
  return unit ? `${s} ${unit}` : s;
}

function monthTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const d = new Date(lo);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const span = (hi - lo) / 86_400_000;
  const every = span > 900 ? 6 : span > 400 ? 3 : span > 200 ? 2 : 1;
  for (; m.getTime() <= hi; m.setUTCMonth(m.getUTCMonth() + every)) out.push(m.getTime());
  return out;
}

const monthLabel = (t: number) => new Date(t).toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

export function LineChart({
  series,
  markers = [],
  unit = "",
  title,
}: {
  series: LineSeries[];
  markers?: { t: number; label: string; color: string }[];
  unit?: string;
  title: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points);
  const lo = Math.min(...all.map((p) => p.t));
  const hi = Math.max(...all.map((p) => p.t));
  const vmax = niceMax(Math.max(0, ...all.map((p) => p.v ?? 0)));
  const x = (t: number) => M.l + ((t - lo) / Math.max(1, hi - lo)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / vmax) * (H - M.t - M.b);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vmax);

  if (!all.length || !Number.isFinite(lo)) return <p className="muted">No data to chart.</p>;

  const nearest = (s: LineSeries, t: number) => {
    let best: { t: number; v: number | null } | null = null;
    for (const p of s.points) if (p.t <= t + 1 && (!best || p.t > best.t)) best = p;
    return best;
  };

  // Direct labels at each line's last value, nudged apart so they don't collide.
  const ends = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => p.v !== null);
      return last ? { s, t: last.t, v: last.v!, y: y(last.v!) } : null;
    })
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < M.l || px > W - M.r) return setHoverT(null);
    setHoverT(lo + ((px - M.l) / (W - M.l - M.r)) * (hi - lo));
  };

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="legend-row">
        {series.map((s) => (
          <span key={s.id} className="legend-item">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="tick">
                {fmtNum(v)}
              </text>
            </g>
          ))}
          {monthTicks(lo, hi).map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="tick">
              {monthLabel(t)}
            </text>
          ))}
          {markers.map((m) => (
            <g key={m.label}>
              <line x1={x(m.t)} x2={x(m.t)} y1={M.t} y2={H - M.b} stroke={m.color} strokeWidth="1.5" strokeDasharray="3 3" />
              <text x={x(m.t) + 3} y={M.t + 9} className="tick">
                {m.label}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const pts = s.points.filter((p) => p.v !== null);
            const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join("");
            return <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />;
          })}
          {ends.map((e) => (
            <text key={e.s.id} x={W - M.r + 6} y={e.y + 4} className="end-label">
              {e.s.label} {fmtNum(e.v)}
            </text>
          ))}
          {hoverT !== null && (
            <g pointerEvents="none">
              <line x1={x(hoverT)} x2={x(hoverT)} y1={M.t} y2={H - M.b} className="crosshair" />
              {series.map((s) => {
                const p = nearest(s, hoverT);
                return p && p.v !== null ? <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r="4" fill={s.color} stroke="#fff" strokeWidth="2" /> : null;
              })}
            </g>
          )}
        </svg>
        {hoverT !== null && (
          <div className="tooltip" style={{ left: `${(x(hoverT) / W) * 100}%` }}>
            <b>{fmtDate(hoverT)}</b>
            {series.map((s) => {
              const p = nearest(s, hoverT);
              return (
                <div key={s.id}>
                  <span className="swatch" style={{ background: s.color }} /> {s.label}: {p && p.v !== null ? fmtNum(p.v, unit) : "–"}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </figure>
  );
}

export interface StackSeries {
  id: string;
  label: string;
  color: string;
}

export function StackedBars({
  bars,
  series,
  unit = "",
  title,
  marker,
}: {
  bars: { t: number; values: Record<string, number> }[];
  series: StackSeries[];
  unit?: string;
  title: string;
  marker?: { t: number; label: string; color: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = useMemo(() => bars.map((b) => series.reduce((t, s) => t + (b.values[s.id] ?? 0), 0)), [bars, series]);
  if (!bars.length) return <p className="muted">No resource assignments to chart.</p>;
  const vmax = niceMax(Math.max(...totals));
  const lo = bars[0].t;
  const step = bars.length > 1 ? bars[1].t - bars[0].t : 7 * 86_400_000;
  const hi = bars[bars.length - 1].t + step;
  const x = (t: number) => M.l + ((t - lo) / (hi - lo)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / vmax) * (H - M.t - M.b);
  const bw = Math.max(2, x(lo + step) - x(lo) - 2); // 2px gap between bars
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vmax);

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {series.length > 1 && (
        <div className="legend-row">
          {series.map((s) => (
            <span key={s.id} className="legend-item">
              <span className="swatch" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
          {ticksY.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className="tick">
                {fmtNum(v)}
              </text>
            </g>
          ))}
          {monthTicks(lo, hi).map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="tick">
              {monthLabel(t)}
            </text>
          ))}
          {bars.map((b, i) => {
            let acc = 0;
            const segs = series
              .map((s) => {
                const v = b.values[s.id] ?? 0;
                if (v <= 0) return null;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                // 2px surface gap between stacked segments
                return <rect key={s.id} x={x(b.t) + 1} y={y1 + 1} width={bw} height={Math.max(0, y0 - y1 - 2)} fill={s.color} rx="1" />;
              })
              .filter(Boolean);
            return (
              <g key={b.t} onPointerEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55}>
                {/* hit target taller than the bar */}
                <rect x={x(b.t)} y={M.t} width={bw + 2} height={H - M.t - M.b} fill="transparent" />
                {segs}
              </g>
            );
          })}
          {marker && (
            <g pointerEvents="none">
              <line x1={x(marker.t)} x2={x(marker.t)} y1={M.t} y2={H - M.b} stroke={marker.color} strokeWidth="1.5" strokeDasharray="3 3" />
              <text x={x(marker.t) + 3} y={M.t + 9} className="tick">
                {marker.label}
              </text>
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${(x(bars[hover].t) / W) * 100}%` }}>
            <b>Week of {fmtDate(bars[hover].t)}</b>
            {series
              .filter((s) => (bars[hover].values[s.id] ?? 0) > 0)
              .map((s) => (
                <div key={s.id}>
                  <span className="swatch" style={{ background: s.color }} /> {s.label}: {fmtNum(bars[hover].values[s.id], unit)}
                </div>
              ))}
            <div>
              Total: <b>{fmtNum(totals[hover], unit)}</b>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
