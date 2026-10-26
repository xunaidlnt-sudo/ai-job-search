import { useMemo, useState } from "react";
import { standardCalendar } from "../core/calendar";
import type { Activity, ActivityStatus, ActivityType, ConstraintType, RelationshipType } from "../core/types";
import { fmtNum } from "./charts";
import { fmtDate, fromInputDate, toInputDate, useStore } from "./store";
import { useTerms } from "./terms";

const TYPES: [ActivityType, string][] = [
  ["task", "Task"],
  ["resource-dependent", "Resource dependent"],
  ["milestone", "Start milestone"],
  ["finish-milestone", "Finish milestone"],
  ["loe", "Level of effort"],
  ["wbs-summary", "WBS summary"],
];
const CONSTRAINTS: [ConstraintType | "", string][] = [
  ["", "None"],
  ["start-on-or-after", "Start on or after"],
  ["start-on-or-before", "Start on or before"],
  ["finish-on-or-after", "Finish on or after"],
  ["finish-on-or-before", "Finish on or before"],
  ["start-on", "Start on"],
  ["finish-on", "Finish on"],
  ["mandatory-start", "Mandatory start"],
  ["mandatory-finish", "Mandatory finish"],
  ["as-late-as-possible", "As late as possible"],
];
const REL_TYPES: RelationshipType[] = ["FS", "SS", "FF", "SF"];

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Add a 5-day task after the selected activity (FS link), or at the data date. */
export function addActivityAfterSelected() {
  const st = useStore.getState();
  const schedule = st.schedule;
  if (!schedule) return;
  const act = schedule.activities.find((a) => a.id === st.selectedActivity) ?? null;
  const cals = schedule.calendars ?? [];
  const cal = cals.find((c) => c.id === (act?.calendarId ?? schedule.defaultCalendarId)) ?? cals[0] ?? standardCalendar();
  const hpd = cal.hoursPerDay || 8;
  let n = schedule.activities.length + 1;
  let code = `A${n * 10}`;
  while (schedule.activities.some((a) => a.code === code)) code = `A${(n += 1) * 10}`;
  const start = schedule.dataDate ?? Date.now();
  const a: Activity = {
    id: uid("new"),
    code,
    name: "New activity",
    wbsId: act?.wbsId ?? schedule.wbs[0]?.id ?? null,
    type: "task",
    status: "not-started",
    percentComplete: 0,
    start,
    finish: start,
    baselineStart: null,
    baselineFinish: null,
    actualStart: null,
    actualFinish: null,
    totalFloatHours: null,
    originalDurationHours: 5 * hpd,
    remainingDurationHours: 5 * hpd,
    critical: false,
    calendarId: act?.calendarId ?? schedule.defaultCalendarId ?? null,
    codes: {},
  };
  st.addActivity(a);
  if (act) st.addRelationship({ id: uid("rel"), predecessorId: act.id, successorId: a.id, type: "FS", lagHours: 0 });
  st.selectActivity(a.id);
  st.setStatus(`Added ${code}${act ? ` after ${act.code}` : ""}. Press F9 to schedule it.`);
}

export function deleteSelectedActivity() {
  const st = useStore.getState();
  const act = st.schedule?.activities.find((a) => a.id === st.selectedActivity);
  if (!act || !window.confirm(`Delete ${act.code} ${act.name} and its relationships?`)) return;
  st.deleteActivity(act.id);
  st.selectActivity(null);
}

export function ActivityEditor() {
  const st = useStore();
  const { schedule, selectedActivity } = st;
  const act = schedule?.activities.find((a) => a.id === selectedActivity) ?? null;
  const cal = useMemo(() => {
    const cals = schedule?.calendars ?? [];
    return cals.find((c) => c.id === (act?.calendarId ?? schedule?.defaultCalendarId)) ?? cals[0] ?? standardCalendar();
  }, [schedule, act]);
  const hpd = cal.hoursPerDay || 8;

  if (!schedule) return <div className="empty">Load or create a schedule first.</div>;

  const newActivity = () => addActivityAfterSelected();

  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={newActivity}>+ New activity{act ? " after this" : ""}</button>
        <button
          disabled={!act}
          onClick={deleteSelectedActivity}
        >
          Delete
        </button>
        <span className="muted">{act ? `${act.code} · ${act.status.replace("-", " ")}` : "Pick an activity in the Gantt"}</span>
      </div>
      {act && <Fields act={act} hpd={hpd} />}
    </div>
  );
}

function Fields({ act, hpd }: { act: Activity; hpd: number }) {
  const st = useStore();
  const terms = useTerms();
  const schedule = st.schedule!;
  const up = (patch: Partial<Activity>) => st.updateActivity(act.id, patch);
  const days = (h: number | null | undefined) => (h === null || h === undefined ? "" : String(Math.round((h / hpd) * 100) / 100));
  const preds = schedule.relationships.filter((r) => r.successorId === act.id);
  const succs = schedule.relationships.filter((r) => r.predecessorId === act.id);
  const byId = new Map(schedule.activities.map((a) => [a.id, a]));
  const [newPred, setNewPred] = useState({ code: "", type: "FS" as RelationshipType, lag: "0" });
  const [newField, setNewField] = useState({ key: "", value: "" });
  const resources = schedule.resources ?? [];
  const assignments = (schedule.assignments ?? []).filter((x) => x.activityId === act.id);
  const resById = new Map(resources.map((r) => [r.id, r]));

  const setStatus = (status: ActivityStatus) => {
    const now = schedule.dataDate ?? Date.now();
    if (status === "not-started") up({ status, actualStart: null, actualFinish: null, percentComplete: 0, remainingDurationHours: act.originalDurationHours });
    if (status === "in-progress") up({ status, actualStart: act.actualStart ?? act.start ?? now, actualFinish: null });
    if (status === "complete") up({ status, actualStart: act.actualStart ?? act.start ?? now, actualFinish: act.actualFinish ?? act.finish ?? now, percentComplete: 100, remainingDurationHours: 0 });
  };

  const addPred = () => {
    const p = schedule.activities.find((a) => a.code.toLowerCase() === newPred.code.trim().toLowerCase());
    if (!p) return st.setStatus(`No activity with ID ${newPred.code}.`);
    if (p.id === act.id) return st.setStatus("An activity cannot be its own predecessor.");
    st.addRelationship({ id: uid("rel"), predecessorId: p.id, successorId: act.id, type: newPred.type, lagHours: (Number(newPred.lag) || 0) * hpd });
    setNewPred({ code: "", type: "FS", lag: "0" });
  };

  return (
    <div className="stack editor-body">
      <section className="grid2">
        <label>
          {terms.activityId}
          <input value={act.code} onChange={(e) => up({ code: e.target.value })} />
        </label>
        <label>
          Type
          <select value={act.type} onChange={(e) => up({ type: e.target.value as ActivityType })}>
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="span2">
          Name
          <input value={act.name} onChange={(e) => up({ name: e.target.value })} />
        </label>
        <label>
          WBS
          <select value={act.wbsId ?? ""} onChange={(e) => up({ wbsId: e.target.value || null })}>
            <option value="">(project)</option>
            {schedule.wbs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Calendar
          <select value={act.calendarId ?? ""} onChange={(e) => up({ calendarId: e.target.value || null })}>
            <option value="">Project default</option>
            {(schedule.calendars ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid2">
        <h4 className="span2">Duration and progress</h4>
        <label>
          Original duration (days)
          <input
            type="number"
            min={0}
            step={0.5}
            value={days(act.originalDurationHours)}
            onChange={(e) => {
              const h = Math.max(0, Number(e.target.value) || 0) * hpd;
              up({ originalDurationHours: h, remainingDurationHours: act.status === "not-started" ? h : act.remainingDurationHours });
            }}
          />
        </label>
        <label>
          Remaining (days)
          <input
            type="number"
            min={0}
            step={0.5}
            value={days(act.remainingDurationHours)}
            disabled={act.status === "complete"}
            onChange={(e) => up({ remainingDurationHours: Math.max(0, Number(e.target.value) || 0) * hpd })}
          />
        </label>
        <label>
          Status
          <select value={act.status} onChange={(e) => setStatus(e.target.value as ActivityStatus)}>
            <option value="not-started">Not started</option>
            <option value="in-progress">In progress</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <label>
          % complete
          <input
            type="number"
            min={0}
            max={100}
            value={act.percentComplete}
            disabled={act.status !== "in-progress"}
            onChange={(e) => up({ percentComplete: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </label>
        <label>
          Actual start
          <input type="datetime-local" value={toInputDate(act.actualStart)} disabled={act.status === "not-started"} onChange={(e) => up({ actualStart: fromInputDate(e.target.value) })} />
        </label>
        <label>
          Actual finish
          <input type="datetime-local" value={toInputDate(act.actualFinish)} disabled={act.status !== "complete"} onChange={(e) => up({ actualFinish: fromInputDate(e.target.value) })} />
        </label>
        <label>
          Constraint
          <select
            value={act.constraint?.type ?? ""}
            onChange={(e) => up({ constraint: e.target.value ? { type: e.target.value as ConstraintType, date: act.constraint?.date ?? act.start } : null })}
          >
            {CONSTRAINTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Constraint date
          <input
            type="datetime-local"
            value={toInputDate(act.constraint?.date ?? null)}
            disabled={!act.constraint || act.constraint.type === "as-late-as-possible"}
            onChange={(e) => act.constraint && up({ constraint: { ...act.constraint, date: fromInputDate(e.target.value) } })}
          />
        </label>
      </section>

      <section>
        <h4>Dates</h4>
        <table className="props">
          <tbody>
            <tr>
              <td>Start / Finish</td>
              <td>
                {fmtDate(act.start)} → {fmtDate(act.finish)}
              </td>
            </tr>
            <tr>
              <td>Late start / finish</td>
              <td>{act.lateStart != null ? `${fmtDate(act.lateStart)} → ${fmtDate(act.lateFinish)}` : "run Schedule (F9)"}</td>
            </tr>
            <tr>
              <td>Baseline</td>
              <td>{act.baselineStart != null ? `${fmtDate(act.baselineStart)} → ${fmtDate(act.baselineFinish)}` : "none"}</td>
            </tr>
            <tr>
              <td>Total / free float</td>
              <td className={act.critical ? "bad" : ""}>
                {act.totalFloatHours != null ? `${days(act.totalFloatHours)}d` : "–"} / {act.freeFloatHours != null ? `${days(act.freeFloatHours)}d` : "–"}
                {act.critical ? " · critical" : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h4>Predecessors ({preds.length})</h4>
        <RelTable rels={preds} other={(r) => byId.get(r.predecessorId)} hpd={hpd} />
        <div className="row">
          <input placeholder={terms.activityId} value={newPred.code} onChange={(e) => setNewPred({ ...newPred, code: e.target.value })} list="activity-codes" style={{ width: 110 }} />
          <select value={newPred.type} onChange={(e) => setNewPred({ ...newPred, type: e.target.value as RelationshipType })}>
            {REL_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input type="number" step={0.5} value={newPred.lag} onChange={(e) => setNewPred({ ...newPred, lag: e.target.value })} style={{ width: 64 }} title="Lag (days)" />
          <button onClick={addPred} disabled={!newPred.code.trim()}>
            Add
          </button>
        </div>
        <datalist id="activity-codes">
          {schedule.activities.map((a) => (
            <option key={a.id} value={a.code}>
              {a.name}
            </option>
          ))}
        </datalist>
      </section>

      <section>
        <h4>Successors ({succs.length})</h4>
        <RelTable rels={succs} other={(r) => byId.get(r.successorId)} hpd={hpd} />
      </section>

      <section>
        <h4>Resources and cost</h4>
        {assignments.length > 0 && (
          <table className="props compact">
            <thead>
              <tr>
                <td>Resource</td>
                <td>Budget</td>
                <td>Actual</td>
                <td>Remain</td>
                <td>Budget cost</td>
                <td />
              </tr>
            </thead>
            <tbody>
              {assignments.map((x) => {
                const r = resById.get(x.resourceId);
                const rate = r?.pricePerUnit ?? 0;
                const setQty = (k: "budgetQty" | "actualQty" | "remainingQty", v: number) => {
                  const cost = { budgetQty: "budgetCost", actualQty: "actualCost", remainingQty: "remainingCost" }[k] as "budgetCost";
                  st.upsertAssignment({ ...x, [k]: v, [cost]: v * rate });
                };
                return (
                  <tr key={x.id}>
                    <td title={r?.name}>{r?.code ?? x.resourceId}</td>
                    {(["budgetQty", "actualQty", "remainingQty"] as const).map((k) => (
                      <td key={k}>
                        <input type="number" min={0} value={Math.round(x[k] * 100) / 100} onChange={(e) => setQty(k, Math.max(0, Number(e.target.value) || 0))} />
                      </td>
                    ))}
                    <td>{fmtNum(x.budgetCost)}</td>
                    <td>
                      <button className="link" onClick={() => st.deleteAssignment(x.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {resources.length ? (
          <select
            value=""
            onChange={(e) => {
              const r = resById.get(e.target.value);
              if (!r) return;
              const qty = r.type === "material" ? 1 : act.originalDurationHours ?? 0;
              st.upsertAssignment({
                id: uid("asg"),
                activityId: act.id,
                resourceId: r.id,
                budgetQty: qty,
                actualQty: 0,
                remainingQty: qty,
                budgetCost: qty * r.pricePerUnit,
                actualCost: 0,
                remainingCost: qty * r.pricePerUnit,
              });
            }}
          >
            <option value="">+ Assign resource…</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} – {r.name} ({r.pricePerUnit}/{r.unit})
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">No resources in this schedule. Import a P6 or MS Project file that has them.</p>
        )}
      </section>

      <section>
        <h4>User fields</h4>
        {Object.entries(act.userFields ?? {}).map(([k, v]) => (
          <div className="row" key={k}>
            <span style={{ width: 110 }} className="muted">
              {k}
            </span>
            <input value={v} onChange={(e) => up({ userFields: { ...act.userFields, [k]: e.target.value } })} />
            <button
              className="link"
              onClick={() => {
                const next = { ...act.userFields };
                delete next[k];
                up({ userFields: next });
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <input placeholder="Field" value={newField.key} onChange={(e) => setNewField({ ...newField, key: e.target.value })} style={{ width: 110 }} />
          <input placeholder="Value" value={newField.value} onChange={(e) => setNewField({ ...newField, value: e.target.value })} />
          <button
            disabled={!newField.key.trim()}
            onClick={() => {
              up({ userFields: { ...act.userFields, [newField.key.trim()]: newField.value } });
              setNewField({ key: "", value: "" });
            }}
          >
            Add
          </button>
        </div>
        <p className="muted">User fields can drive link rules (Rules tab → activity field).</p>
      </section>
    </div>
  );
}

function RelTable({ rels, other, hpd }: { rels: import("../core/types").Relationship[]; other: (r: import("../core/types").Relationship) => Activity | undefined; hpd: number }) {
  const st = useStore();
  if (!rels.length) return <p className="muted">None.</p>;
  return (
    <table className="props compact">
      <tbody>
        {rels.map((r) => {
          const a = other(r);
          return (
            <tr key={r.id}>
              <td>
                <button className="link" onClick={() => a && st.selectActivity(a.id)}>
                  {a?.code ?? "?"}
                </button>{" "}
                <span className="muted">{a?.name}</span>
              </td>
              <td>
                <select value={r.type} onChange={(e) => st.updateRelationship(r.id, { type: e.target.value as RelationshipType })}>
                  {REL_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  step={0.5}
                  value={Math.round((r.lagHours / hpd) * 100) / 100}
                  onChange={(e) => st.updateRelationship(r.id, { lagHours: (Number(e.target.value) || 0) * hpd })}
                  title="Lag (days)"
                  style={{ width: 56 }}
                />
              </td>
              <td>
                <button className="link" onClick={() => st.deleteRelationship(r.id)}>
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
