// Small SVG charts: cumulative lines (S-curves, quantity curves) and stacked
// weekly bars (resource histograms). Single y-axis, thin marks, legend plus
// direct end labels, crosshair/hover tooltips. Colours come from a validated
// categorical order and are assigned by series identity, never by rank.

import { useMemo, useRef, useState } from "react";
import { fmtDate } from "./store";
import { monthShort } from "../core/dates";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const OTHER = "#8a8f98";

export interface LineSeries {
  /** Shorter name for the label at the line end. */
  short?: string;
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: { t: number; v: number | null }[];
}

const W0 = 640;
const H0 = 240;
const M0 = { l: 56, r: 92, t: 12, b: 26 };
const W = W0;
const M = M0;
const H = H0;

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

const monthLabel = (t: number) => `${monthShort(new Date(t))} ${String(new Date(t).getUTCFullYear()).slice(2)}`;

export function LineChart({
  series,
  markers = [],
  unit = "",
  title,
  yMax,
  fmt = fmtNum,
  area = false,
  legend = true,
  compact = false,
}: {
  series: LineSeries[];
  /** Fill under each line (low opacity). */
  area?: boolean;
  legend?: boolean;
  /** Small-multiple size: narrower canvas, no end labels, readable ticks. */
  compact?: boolean;
  markers?: { t: number; label: string; color: string }[];
  unit?: string;
  title: string;
  /** Fixed top of the y-axis (e.g. 1 for 0–100% charts). */
  yMax?: number;
  /** Value formatter for ticks, labels and tooltips. */
  fmt?: (v: number, unit?: string) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const W = compact ? 340 : W0;
  const H = compact ? 190 : H0;
  const M = compact ? { l: 40, r: 10, t: 10, b: 24 } : M0;
  const all = series.flatMap((s) => s.points);
  const lo = Math.min(...all.map((p) => p.t));
  const hi = Math.max(...all.map((p) => p.t));
  const vmax = yMax ?? niceMax(Math.max(0, ...all.map((p) => p.v ?? 0)));
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
      {title && <figcaption>{title}</figcaption>}
      <div className="legend-row" hidden={!legend}>
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
                {fmt(v)}
              </text>
            </g>
          ))}
          {monthTicks(lo, hi).filter((_, i, a) => !compact || a.length <= 5 || i % Math.ceil(a.length / 5) === 0).map((t) => (
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
            const fill =
              area && !s.dashed && pts.length > 1 ? `${d}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(pts[0].t).toFixed(1)},${y(0)}Z` : null;
            return (
              <g key={s.id}>
                {fill && <path d={fill} fill={s.color} opacity="0.12" />}
                <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />
              </g>
            );
          })}
          {!compact && ends.map((e) => (
            <text key={e.s.id} x={W - M.r + 6} y={e.y + 4} className="end-label">
              {e.s.short ?? e.s.label} {fmt(e.v)}
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
                  <span className="swatch" style={{ background: s.color }} /> {s.label}: {p && p.v !== null ? fmt(p.v, unit) : "–"}
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

/** Grouped bars per period (e.g. monthly planned vs actual progress). */
export function PeriodBars({
  periods,
  series,
  fmt = fmtNum,
  title,
}: {
  periods: { t: number; values: Record<string, number | null> }[];
  series: StackSeries[];
  fmt?: (v: number) => string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!periods.length) return null;
  const Hh = 150;
  const vmax = niceMax(Math.max(0, ...periods.flatMap((p) => series.map((s) => p.values[s.id] ?? 0))));
  const band = (W - M.l - M.r) / periods.length;
  const bw = Math.max(2, (band - 4) / series.length - 2);
  const y = (v: number) => Hh - M.b - (v / vmax) * (Hh - M.t - M.b);
  return (
    <figure className="chart">
      {title && <figcaption>{title}</figcaption>}
      <div className="legend-row">
        {series.map((s) => (
          <span key={s.id} className="legend-item">
            <span className="swatch" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={title || "Period progress"} onPointerLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={M.l} x2={W - M.r} y1={y(f * vmax)} y2={y(f * vmax)} className="grid" />
              <text x={M.l - 6} y={y(f * vmax) + 4} textAnchor="end" className="tick">
                {fmt(f * vmax)}
              </text>
            </g>
          ))}
          {periods.map((p, i) => (
            <g key={p.t} onPointerEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55}>
              <rect x={M.l + i * band} y={M.t} width={band} height={Hh - M.t - M.b} fill="transparent" />
              {series.map((s, k) => {
                const v = p.values[s.id];
                if (v === null || v === undefined || v <= 0) return null;
                return <rect key={s.id} x={M.l + i * band + 2 + k * (bw + 2)} y={y(v)} width={bw} height={Math.max(0, Hh - M.b - y(v))} fill={s.color} rx="1" />;
              })}
              {i % Math.max(1, Math.ceil(periods.length / 10)) === 0 && (
                <text x={M.l + i * band + band / 2} y={Hh - 8} textAnchor="middle" className="tick">
                  {monthLabel(p.t)}
                </text>
              )}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${((M.l + hover * band) / W) * 100}%` }}>
            <b>{monthLabel(periods[hover].t)}</b>
            {series.map((s) => (
              <div key={s.id}>
                <span className="swatch" style={{ background: s.color }} /> {s.label}: {periods[hover].values[s.id] == null ? "–" : fmt(periods[hover].values[s.id]!)}
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

export const pct = (v: number) => `${(v * 100).toFixed(v * 100 >= 10 || v === 0 ? 0 : 1)}%`;
export const pct2 = (v: number) => `${(v * 100).toFixed(2)}%`;

/** Status colours: fixed, never reused for series; always shown with a label. */
export const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", neutral: "#8a8f98", info: "#2a78d6" } as const;

/**
 * Half-dial gauge. Bands come from the "bad" and "good" limits; the needle
 * shows the value. Direction follows the limits (good > bad: higher is better).
 */
export function Gauge({
  value,
  min = 0,
  max,
  good,
  bad,
  label,
  fmt,
  accent,
}: {
  value: number | null;
  min?: number;
  max: number;
  good?: number;
  bad?: number;
  label: string;
  fmt: (v: number) => string;
  accent?: string;
}) {
  const R = 80;
  const cx = 100;
  const cy = 96;
  const f = (v: number) => Math.min(1, Math.max(0, (v - min) / Math.max(1e-9, max - min)));
  const pt = (fr: number, r = R) => [cx - r * Math.cos(Math.PI * fr), cy - r * Math.sin(Math.PI * fr)] as const;
  const arc = (a: number, b: number, r = R) => {
    const [x0, y0] = pt(a, r);
    const [x1, y1] = pt(b, r);
    return `M${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };
  const bands: { a: number; b: number; color: string }[] = [];
  if (good !== undefined && bad !== undefined) {
    const up = good >= bad;
    const lo = f(Math.min(good, bad));
    const hi = f(Math.max(good, bad));
    bands.push({ a: 0, b: lo, color: up ? STATUS.critical : STATUS.good }, { a: lo, b: hi, color: STATUS.warning }, { a: hi, b: 1, color: up ? STATUS.good : STATUS.critical });
  }
  const tone =
    value === null || good === undefined || bad === undefined
      ? null
      : good >= bad
        ? value >= good
          ? "good"
          : value < bad
            ? "critical"
            : "warning"
        : value <= good
          ? "good"
          : value > bad
            ? "critical"
            : "warning";
  const [nx, ny] = pt(value === null ? 0 : f(value), R - 18);
  return (
    <figure className="gauge">
      <svg viewBox="-6 -8 212 126" role="img" aria-label={`${label}: ${value === null ? "no data" : fmt(value)}`}>
        <path d={arc(0, 1)} className="gauge-track" strokeWidth="12" fill="none" />
        {bands.map((b, i) => b.b > b.a && <path key={i} d={arc(b.a, b.b, R + 11)} stroke={b.color} strokeWidth="4" fill="none" />)}
        {value !== null && <path d={arc(0, Math.max(0.002, f(value)))} stroke={tone ? STATUS[tone] : accent ?? SERIES[0]} strokeWidth="12" fill="none" />}
        {value !== null && <line x1={cx} y1={cy} x2={nx} y2={ny} className="gauge-needle" strokeWidth="2.5" strokeLinecap="round" />}
        <circle cx={cx} cy={cy} r="4" className="gauge-hub" />
        <text x={cx - R} y={cy + 16} textAnchor="middle" className="tick">
          {fmt(min)}
        </text>
        <text x={cx + R} y={cy + 16} textAnchor="middle" className="tick">
          {fmt(max)}
        </text>
      </svg>
      <figcaption>
        <span className="gauge-value">{value === null ? "–" : fmt(value)}</span>
        {tone && <span className={`status-pill ${tone}`}>{tone === "good" ? "On target" : tone === "warning" ? "Watch" : "Behind"}</span>}
      </figcaption>
    </figure>
  );
}

/** Donut with a legend that carries the labels and counts. */
export function Donut({ slices, total, caption = "activities" }: { slices: { id: string; label: string; value: number; color: string }[]; total?: string; caption?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const sum = slices.reduce((t, s) => t + s.value, 0);
  if (!sum) return <p className="muted">Nothing to show.</p>;
  const R = 52;
  const r = 34;
  let a0 = -Math.PI / 2;
  const paths = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const a1 = a0 + (s.value / sum) * Math.PI * 2;
      const gap = slices.filter((x) => x.value > 0).length > 1 ? 0.02 : 0;
      const p = (a: number, rr: number) => `${(60 + rr * Math.cos(a)).toFixed(2)},${(60 + rr * Math.sin(a)).toFixed(2)}`;
      const large = a1 - a0 - 2 * gap > Math.PI ? 1 : 0;
      const full = s.value === sum;
      const d = full
        ? `M60,${60 - R}A${R},${R} 0 1 1 59.99,${60 - R}ZM60,${60 - r}A${r},${r} 0 1 0 60.01,${60 - r}Z`
        : `M${p(a0 + gap, R)}A${R},${R} 0 ${large} 1 ${p(a1 - gap, R)}L${p(a1 - gap, r)}A${r},${r} 0 ${large} 0 ${p(a0 + gap, r)}Z`;
      a0 = a1;
      return { ...s, d };
    });
  const h = slices.find((s) => s.id === hover);
  return (
    <figure className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(", ")} onPointerLeave={() => setHover(null)}>
        {paths.map((s) => (
          <path key={s.id} d={s.d} fill={s.color} fillRule="evenodd" opacity={hover && hover !== s.id ? 0.4 : 1} onPointerEnter={() => setHover(s.id)} />
        ))}
        <text x="60" y="58" textAnchor="middle" className="donut-total">
          {h ? h.value : (total ?? sum)}
        </text>
        <text x="60" y="72" textAnchor="middle" className="tick">
          {h ? `${Math.round((h.value / sum) * 100)}%` : caption}
        </text>
      </svg>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.id} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)} className={hover === s.id ? "on" : ""}>
            <span className="swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Horizontal paired bars per group: e.g. plan % and actual % by discipline. */
export function GroupBars({
  rows,
  series,
  fmt,
  max = 1,
  legend = true,
}: {
  rows: { key: string; label: string; values: Record<string, number> }[];
  series: StackSeries[];
  fmt: (v: number) => string;
  max?: number;
  legend?: boolean;
}) {
  if (!rows.length) return <p className="muted">No groups to show.</p>;
  return (
    <figure className="gbars">
      {legend && (
        <div className="legend-row">
          {series.map((s) => (
            <span key={s.id} className="legend-item">
              <span className="swatch" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="gbars-grid">
        {rows.map((r) => (
          <div key={r.key} className="gbars-row" title={`${r.label}: ${series.map((s) => `${s.label} ${fmt(r.values[s.id] ?? 0)}`).join(" · ")}`}>
            <span className="gbars-label">{r.label}</span>
            <span className="gbars-bars">
              {series.map((s) => (
                <span key={s.id} className="gbars-line">
                  <span className="gbars-bar" style={{ width: `${Math.min(100, Math.max(0, ((r.values[s.id] ?? 0) / max) * 100))}%`, background: s.color }} />
                  <span className="gbars-val">{fmt(r.values[s.id] ?? 0)}</span>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}
