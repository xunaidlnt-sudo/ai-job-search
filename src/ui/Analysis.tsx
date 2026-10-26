import { useMemo, useState } from "react";
import { evm, evmByWbs, resourceHistogram, sCurves, type Measure } from "../core/evm";
import { COUNT_KEY, numericPropertyKeys, quantityCurve, takeoff } from "../core/quantities";
import { scheduleRange } from "../core/simulation";
import { fmtNum, LineChart, OTHER, SERIES, StackedBars } from "./charts";
import { fmtDate, useStore } from "./store";

const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(0)}%`);
const idx = (v: number | null) => (v === null ? "–" : v.toFixed(2));

function MeasureToggle({ value, onChange, hasCost }: { value: Measure; onChange: (m: Measure) => void; hasCost: boolean }) {
  return (
    <div className="seg">
      <button className={value === "cost" ? "active" : ""} onClick={() => onChange("cost")} disabled={!hasCost}>
        Cost
      </button>
      <button className={value === "hours" ? "active" : ""} onClick={() => onChange("hours")}>
        Labour hours
      </button>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="tile" title={hint}>
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function CostPanel() {
  const schedule = useStore((s) => s.schedule);
  const time = useStore((s) => s.time);
  const hasCost = !!schedule?.assignments?.some((a) => a.budgetCost > 0);
  const [measure, setMeasure] = useState<Measure>("cost");
  const m = hasCost ? measure : "hours";
  const unit = m === "cost" ? "" : "h";
  const metrics = useMemo(() => (schedule ? evm(schedule, m) : null), [schedule, m]);
  const curves = useMemo(() => (schedule ? sCurves(schedule, m) : []), [schedule, m]);
  const wbs = useMemo(() => (schedule ? evmByWbs(schedule, m) : []), [schedule, m]);
  const [showTable, setShowTable] = useState(false);

  if (!schedule) return <div className="empty">Load a schedule first.</div>;
  if (!metrics || metrics.bac === 0) return <div className="empty">No costs or labour hours in this schedule. Assign resources in the Activity tab, or import a resource-loaded P6 / MS Project file.</div>;

  const tone = (v: number | null) => (v === null ? undefined : v >= 1 ? "good" : v < 0.95 ? "bad" : undefined);
  return (
    <div className="analysis">
      <div className="analysis-bar">
        <MeasureToggle value={m} onChange={setMeasure} hasCost={hasCost} />
        <span className="muted">As of data date {fmtDate(schedule.dataDate)}</span>
      </div>
      <div className="tiles">
        <Tile label="Budget (BAC)" value={fmtNum(metrics.bac, unit)} />
        <Tile label="Planned (PV)" value={fmtNum(metrics.pv, unit)} hint={`${pct(metrics.plannedPct)} of budget planned by the data date`} />
        <Tile label="Earned (EV)" value={fmtNum(metrics.ev, unit)} hint={`${pct(metrics.earnedPct)} of budget earned`} />
        <Tile label="Actual (AC)" value={fmtNum(metrics.ac, unit)} />
        <Tile label="SPI" value={idx(metrics.spi)} tone={tone(metrics.spi)} hint="Schedule performance: EV / PV" />
        <Tile label="CPI" value={idx(metrics.cpi)} tone={tone(metrics.cpi)} hint="Cost performance: EV / AC" />
        <Tile label="EAC" value={fmtNum(metrics.eac, unit)} hint={`Actual + remaining. Performance-based (BAC/CPI): ${metrics.eacCpi ? fmtNum(metrics.eacCpi, unit) : "–"}`} />
        <Tile label="VAC" value={fmtNum(metrics.vac, unit)} tone={metrics.vac < 0 ? "bad" : "good"} hint="Budget minus EAC" />
      </div>
      <LineChart
        title={`Cumulative ${m === "cost" ? "cost" : "labour hours"} (S-curve)`}
        unit={unit}
        series={[
          { id: "pv", label: "Planned", color: SERIES[0], points: curves.map((p) => ({ t: p.t, v: p.pv })) },
          { id: "ev", label: "Earned", color: SERIES[1], points: curves.map((p) => ({ t: p.t, v: p.ev })) },
          { id: "ac", label: "Actual", color: SERIES[2], points: curves.map((p) => ({ t: p.t, v: p.ac })) },
          { id: "fc", label: "Forecast", color: SERIES[3], dashed: true, points: curves.map((p) => ({ t: p.t, v: p.forecast })) },
        ]}
        markers={[
          ...(schedule.dataDate !== null ? [{ t: schedule.dataDate, label: "Data date", color: "#1f6feb" }] : []),
          { t: time, label: "", color: "#2e9d4f" },
        ]}
      />
      <div className="analysis-bar">
        <h4>By WBS</h4>
        <button className="link" onClick={() => setShowTable(!showTable)}>
          {showTable ? "Hide curve table" : "Show curve as table"}
        </button>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>WBS</th>
            <th>BAC</th>
            <th>PV</th>
            <th>EV</th>
            <th>AC</th>
            <th>SPI</th>
            <th>CPI</th>
            <th>EAC</th>
          </tr>
        </thead>
        <tbody>
          {wbs.map(({ wbs: w, metrics: x }) => (
            <tr key={w.id}>
              <td>
                {w.code} {w.name}
              </td>
              <td>{fmtNum(x.bac)}</td>
              <td>{fmtNum(x.pv)}</td>
              <td>{fmtNum(x.ev)}</td>
              <td>{fmtNum(x.ac)}</td>
              <td className={tone(x.spi) ?? ""}>{idx(x.spi)}</td>
              <td className={tone(x.cpi) ?? ""}>{idx(x.cpi)}</td>
              <td>{fmtNum(x.eac)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {showTable && (
        <table className="data">
          <thead>
            <tr>
              <th>Week</th>
              <th>Planned</th>
              <th>Earned</th>
              <th>Actual</th>
              <th>Forecast</th>
            </tr>
          </thead>
          <tbody>
            {curves.map((p) => (
              <tr key={p.t}>
                <td>{fmtDate(p.t)}</td>
                <td>{fmtNum(p.pv)}</td>
                <td>{p.ev === null ? "" : fmtNum(p.ev)}</td>
                <td>{p.ac === null ? "" : fmtNum(p.ac)}</td>
                <td>{fmtNum(p.forecast)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ResourcePanel() {
  const schedule = useStore((s) => s.schedule);
  const time = useStore((s) => s.time);
  const [baseline, setBaseline] = useState(false);
  const [only, setOnly] = useState<string>("");
  const resources = schedule?.resources ?? [];
  // Colour follows the resource, by its fixed position in the resource list.
  const colorOf = useMemo(() => new Map(resources.map((r, i) => [r.id, i < SERIES.length ? SERIES[i] : OTHER])), [resources]);
  const hist = useMemo(
    () => (schedule ? resourceHistogram(schedule, { baseline, resourceIds: only ? [only] : resources.filter((r) => r.type !== "material").map((r) => r.id) }) : null),
    [schedule, baseline, only, resources],
  );
  const totals = useMemo(() => {
    const m = new Map<string, { budget: number; actual: number; remaining: number; cost: number; actualCost: number }>();
    for (const x of schedule?.assignments ?? []) {
      const t = m.get(x.resourceId) ?? { budget: 0, actual: 0, remaining: 0, cost: 0, actualCost: 0 };
      t.budget += x.budgetQty;
      t.actual += x.actualQty;
      t.remaining += x.remainingQty;
      t.cost += x.budgetCost;
      t.actualCost += x.actualCost;
      m.set(x.resourceId, t);
    }
    return m;
  }, [schedule]);

  if (!schedule) return <div className="empty">Load a schedule first.</div>;
  if (!resources.length) return <div className="empty">No resources in this schedule.</div>;
  const chosen = only ? resources.filter((r) => r.id === only) : resources.filter((r) => r.type !== "material");
  const unit = only ? resources.find((r) => r.id === only)?.unit ?? "" : "h";

  return (
    <div className="analysis">
      <div className="analysis-bar">
        <select value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">All labour and equipment</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} – {r.name}
            </option>
          ))}
        </select>
        <div className="seg">
          <button className={!baseline ? "active" : ""} onClick={() => setBaseline(false)}>
            Current
          </button>
          <button className={baseline ? "active" : ""} onClick={() => setBaseline(true)}>
            Baseline
          </button>
        </div>
      </div>
      <StackedBars
        title={`Weekly ${only ? resources.find((r) => r.id === only)?.name : "resource"} usage (${baseline ? "baseline budget" : "actual to date, then remaining"})`}
        unit={unit}
        bars={(hist?.bars ?? []).map((b) => ({ t: b.t, values: b.byResource }))}
        series={chosen.map((r) => ({ id: r.id, label: r.code, color: colorOf.get(r.id)! }))}
        marker={schedule.dataDate !== null ? { t: schedule.dataDate, label: "Data date", color: "#1f6feb" } : { t: time, label: "", color: "#2e9d4f" }}
      />
      <table className="data">
        <thead>
          <tr>
            <th>Resource</th>
            <th>Type</th>
            <th>Rate</th>
            <th>Budget qty</th>
            <th>Actual</th>
            <th>Remaining</th>
            <th>Budget cost</th>
            <th>Actual cost</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const t = totals.get(r.id);
            return (
              <tr key={r.id}>
                <td>
                  <span className="swatch" style={{ background: colorOf.get(r.id) }} /> {r.code} – {r.name}
                </td>
                <td>{r.type}</td>
                <td>
                  {r.pricePerUnit}/{r.unit}
                </td>
                <td>{fmtNum(t?.budget ?? 0, r.unit)}</td>
                <td>{fmtNum(t?.actual ?? 0)}</td>
                <td>{fmtNum(t?.remaining ?? 0)}</td>
                <td>{fmtNum(t?.cost ?? 0)}</td>
                <td>{fmtNum(t?.actualCost ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function QuantityPanel() {
  const { schedule, elements, links, profiles, time, sim } = useStore();
  const keys = useMemo(() => [...numericPropertyKeys(elements), COUNT_KEY], [elements]);
  const [key, setKey] = useState<string>("");
  const k = keys.includes(key) ? key : keys[0];
  const [group, setGroup] = useState<"type" | "activity">("type");
  const data = useMemo(() => (schedule && k ? takeoff(schedule, elements, links, profiles, k, time, sim.dateSource) : null), [schedule, elements, links, profiles, k, time, sim.dateSource]);
  const curve = useMemo(() => {
    if (!schedule || !k) return [];
    const r = scheduleRange(schedule);
    if (!r) return [];
    const pts = Array.from({ length: 41 }, (_, i) => r.start + ((r.finish - r.start) * i) / 40);
    return quantityCurve(schedule, elements, links, profiles, k, pts);
  }, [schedule, elements, links, profiles, k]);

  if (!schedule || !elements.length) return <div className="empty">Load a schedule and a model first.</div>;
  if (!data) return <div className="empty">No numeric properties in the model.</div>;
  const rows = group === "type" ? data.byType : data.byActivity;
  const label = k === COUNT_KEY ? "elements" : k.split(".").pop();

  return (
    <div className="analysis">
      <div className="analysis-bar">
        <select value={k} onChange={(e) => setKey(e.target.value)}>
          {keys.map((x) => (
            <option key={x} value={x}>
              {x === COUNT_KEY ? "Element count" : x}
            </option>
          ))}
        </select>
        <div className="seg">
          <button className={group === "type" ? "active" : ""} onClick={() => setGroup("type")}>
            By type
          </button>
          <button className={group === "activity" ? "active" : ""} onClick={() => setGroup("activity")}>
            By activity
          </button>
        </div>
      </div>
      <div className="tiles">
        <Tile label={`Total ${label}`} value={fmtNum(data.total)} />
        <Tile label={`Installed by ${fmtDate(time)}`} value={fmtNum(data.installed)} hint={`${pct(data.total ? data.installed / data.total : 0)} of total`} />
        <Tile label="Remaining" value={fmtNum(data.total - data.installed)} />
        <Tile label="Not scheduled" value={fmtNum(data.unscheduled)} tone={data.unscheduled > 0 ? "bad" : undefined} hint="Quantity on elements with no link" />
      </div>
      <LineChart
        title={`Installed ${label}, cumulative`}
        series={[
          { id: "cur", label: "Current plan", color: SERIES[0], points: curve.map((p) => ({ t: p.t, v: p.current })) },
          { id: "base", label: "Baseline", color: SERIES[1], dashed: true, points: curve.map((p) => ({ t: p.t, v: p.baseline })) },
        ]}
        markers={[{ t: time, label: "", color: "#2e9d4f" }]}
      />
      <table className="data">
        <thead>
          <tr>
            <th>{group === "type" ? "IFC type" : "Activity"}</th>
            <th>Elements</th>
            <th>Quantity</th>
            <th>Installed</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td>{r.elements}</td>
              <td>{fmtNum(r.quantity)}</td>
              <td>{fmtNum(r.installed)}</td>
              <td>{pct(r.quantity ? r.installed / r.quantity : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
