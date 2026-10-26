import { useMemo, useState } from "react";
import { linkHealth } from "../core/health";
import { activityFields, applyRules, elementPropertyValue, mergeLinks, propertyKeys, suggestRules, unlink, type RuleSuggestion } from "../core/linking";
import { splitElement } from "../core/motion";
import { cloneProfile, STATUS_COLORS } from "../core/profiles";
import type { AppearanceProfile, GrowthDirection, LinkMatch, LinkRule, PhaseAppearance } from "../core/types";
import { fmtDate, useStore, type SideTab } from "./store";

export function SidePanel() {
  const tab = useStore((s) => s.sideTab);
  const setTab = useStore((s) => s.setSideTab);
  return (
    <div className="side">
      <div className="tabs">
        {(["selection", "rules", "tools", "profiles", "display", "check"] as SideTab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "selection" && <SelectionTab />}
        {tab === "rules" && <RulesTab />}
        {tab === "profiles" && <ProfilesTab />}
        {tab === "display" && <DisplayTab />}
        {tab === "check" && <CheckTab />}
        {tab === "tools" && <ToolsTab />}
      </div>
    </div>
  );
}

function SelectionTab() {
  const { elements, selectedElements, selectElements, schedule, selectedActivity, links, setLinks, profiles, setStatus } = useStore();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "install");
  const [propKey, setPropKey] = useState("IfcType");
  const [propValue, setPropValue] = useState("");
  const keys = useMemo(() => propertyKeys(elements), [elements]);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const actById = useMemo(() => new Map((schedule?.activities ?? []).map((a) => [a.id, a])), [schedule]);
  const values = useMemo(() => {
    const s = new Set<string>();
    for (const e of elements) {
      const v = elementPropertyValue(e, propKey);
      if (v) s.add(v);
      if (s.size > 300) break;
    }
    return [...s].sort();
  }, [elements, propKey]);

  const sel = [...selectedElements];
  const one = sel.length === 1 ? byId.get(sel[0]) : undefined;
  const selLinks = links.filter((l) => selectedElements.has(l.elementId));
  const activity = selectedActivity ? actById.get(selectedActivity) : undefined;

  const linkSelected = () => {
    if (!activity || sel.length === 0) return;
    setLinks(mergeLinks(links, sel.map((elementId) => ({ elementId, activityId: activity.id, profileId }))));
    setStatus(`Linked ${sel.length} element(s) to ${activity.code} (${profiles.find((p) => p.id === profileId)?.name}).`);
  };
  const selectByProperty = () => {
    const ids = elements.filter((e) => (elementPropertyValue(e, propKey) ?? "") === propValue).map((e) => e.id);
    selectElements(new Set(ids));
    setStatus(`Selected ${ids.length} element(s) where ${propKey} = ${propValue}.`);
  };

  return (
    <div className="stack">
      <section>
        <h4>Select by property</h4>
        <select value={propKey} onChange={(e) => setPropKey(e.target.value)}>
          {keys.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={propValue} onChange={(e) => setPropValue(e.target.value)}>
          <option value="">— value —</option>
          {values.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <div className="row">
          <button onClick={selectByProperty} disabled={!propValue}>Select</button>
          <button onClick={() => selectElements(new Set())} disabled={sel.length === 0}>Clear selection</button>
        </div>
        <p className="muted">Click in the 3D view to select. Shift/Ctrl-click adds to the selection. Alt-click an activity to select its linked elements; double-click jumps the timeline to its start.</p>
      </section>

      <section>
        <h4>Link selection to activity</h4>
        <p>
          <b>{sel.length}</b> element(s) selected
          <br />
          Activity: {activity ? <b>{activity.code} – {activity.name}</b> : <span className="muted">pick one in the Gantt</span>}
        </p>
        <label>
          Profile
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="primary" disabled={!activity || sel.length === 0} onClick={linkSelected}>Link</button>
          <button
            disabled={!activity}
            title="Select the elements already linked to this activity"
            onClick={() => selectElements(new Set(links.filter((l) => l.activityId === activity!.id).map((l) => l.elementId)))}
          >
            Select linked
          </button>
          <button
            disabled={sel.length === 0 || selLinks.length === 0}
            onClick={() => {
              setLinks(unlink(links, selectedElements, activity?.id));
              setStatus(activity ? `Unlinked selection from ${activity.code}.` : "Removed all links from selection.");
            }}
          >
            Unlink{activity ? " from activity" : " all"}
          </button>
        </div>
      </section>

      {selLinks.length > 0 && (
        <section>
          <h4>Links on selection ({selLinks.length})</h4>
          <ul className="list">
            {selLinks.slice(0, 50).map((l) => {
              const a = actById.get(l.activityId);
              return (
                <li key={`${l.elementId}|${l.activityId}`}>
                  {byId.get(l.elementId)?.name ?? l.elementId} → <b>{a?.code ?? l.activityId}</b> ({profiles.find((p) => p.id === l.profileId)?.name ?? l.profileId})
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {one && (
        <section>
          <h4>Properties</h4>
          <table className="props">
            <tbody>
              <tr><td>Name</td><td>{one.name}</td></tr>
              <tr><td>IfcType</td><td>{one.ifcType}</td></tr>
              <tr><td>GlobalId</td><td>{one.id}</td></tr>
              {Object.entries(one.properties).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function RulesTab() {
  const { elements, schedule, rules, setRules, links, setLinks, profiles, setStatus } = useStore();
  const keys = useMemo(() => propertyKeys(elements), [elements]);
  const fields = useMemo(() => activityFields(schedule), [schedule]);
  const [draft, setDraft] = useState<Omit<LinkRule, "id">>({
    elementProperty: "Name",
    activityField: "code",
    match: "equals",
    profileId: profiles[0]?.id ?? "install",
    caseSensitive: false,
  });

  const run = (subset: LinkRule[]) => {
    if (!schedule) return;
    const found = applyRules(subset, elements, schedule);
    setLinks(mergeLinks(links, found));
    const linkedEls = new Set(found.map((l) => l.elementId)).size;
    setStatus(`Rules created ${found.length} link(s) on ${linkedEls} element(s).`);
  };

  const [suggestions, setSuggestions] = useState<RuleSuggestion[] | null>(null);
  const fieldLabel = (v: string) => fields.find((f) => f.value === v)?.label ?? v;

  return (
    <div className="stack">
      <section>
        <h4>Auto-detect</h4>
        <p className="muted">Scan the model for a property that already holds Activity IDs, names, WBS or activity codes.</p>
        <button
          disabled={!schedule || elements.length === 0}
          onClick={() => {
            const found = suggestRules(elements, schedule!);
            setSuggestions(found);
            setStatus(found.length ? `Found ${found.length} candidate rule(s).` : "No property in the model matches schedule values exactly.");
          }}
        >
          Find matching properties
        </button>
        {suggestions && suggestions.length === 0 && <p className="muted">No exact matches. Try a "contains" rule, or link by selection.</p>}
        {suggestions && suggestions.length > 0 && (
          <ul className="list suggestions">
            {suggestions.map((sg) => (
              <li key={`${sg.elementProperty}|${sg.activityField}`}>
                <code>{sg.elementProperty}</code> = <code>{fieldLabel(sg.activityField)}</code>
                <br />
                <span className="muted">
                  {sg.elementMatches} elements → {sg.activityMatches} activities
                </span>{" "}
                <button
                  className="link"
                  onClick={() =>
                    setDraft({ ...draft, elementProperty: sg.elementProperty, activityField: sg.activityField, match: "equals", caseSensitive: false })
                  }
                >
                  use
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>New rule</h4>
        <p className="muted">Link elements whose property matches an activity field.</p>
        <label>
          Element property
          <select value={draft.elementProperty} onChange={(e) => setDraft({ ...draft, elementProperty: e.target.value })}>
            {keys.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Match
          <select value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as LinkMatch })}>
            <option value="equals">equals</option>
            <option value="contains">contains</option>
            <option value="startsWith">starts with</option>
          </select>
        </label>
        <label>
          Activity field
          <select value={draft.activityField} onChange={(e) => setDraft({ ...draft, activityField: e.target.value })}>
            {fields.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profile
          <select value={draft.profileId} onChange={(e) => setDraft({ ...draft, profileId: e.target.value })}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.caseSensitive} onChange={(e) => setDraft({ ...draft, caseSensitive: e.target.checked })} />
          Case sensitive
        </label>
        <div className="row">
          <button onClick={() => setRules([...rules, { ...draft, id: crypto.randomUUID() }])}>Add rule</button>
          <button className="primary" disabled={!schedule || elements.length === 0} onClick={() => run([{ ...draft, id: "adhoc" }])}>
            Run once
          </button>
        </div>
      </section>
      <section>
        <h4>Saved rules ({rules.length})</h4>
        {rules.length === 0 && <p className="muted">None yet.</p>}
        <ul className="list">
          {rules.map((r) => (
            <li key={r.id}>
              <code>{r.elementProperty}</code> {r.match} <code>{fields.find((f) => f.value === r.activityField)?.label ?? r.activityField}</code> →{" "}
              {profiles.find((p) => p.id === r.profileId)?.name}
              <button className="link" onClick={() => setRules(rules.filter((x) => x !== r))}>remove</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="primary" disabled={!rules.length || !schedule} onClick={() => run(rules)}>Run all rules</button>
          <button disabled={!links.length} onClick={() => { setLinks([]); setStatus("All links cleared."); }}>Clear all links</button>
        </div>
        <p className="muted">{links.length} link(s) in project.</p>
      </section>
    </div>
  );
}

function PhaseEditor({ label, value, onChange }: { label: string; value: PhaseAppearance; onChange: (v: PhaseAppearance) => void }) {
  return (
    <div className="phase">
      <b>{label}</b>
      <label className="check">
        <input type="checkbox" checked={value.visible} onChange={(e) => onChange({ ...value, visible: e.target.checked })} />
        Visible
      </label>
      <label className="check">
        <input type="checkbox" checked={value.color === null} onChange={(e) => onChange({ ...value, color: e.target.checked ? null : "#888888" })} />
        Model colour
      </label>
      {value.color !== null && <input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} />}
      <label>
        Transparency {Math.round(value.transparency * 100)}%
        <input type="range" min={0} max={1} step={0.05} value={value.transparency} onChange={(e) => onChange({ ...value, transparency: Number(e.target.value) })} />
      </label>
    </div>
  );
}

function ProfilesTab() {
  const { profiles, setProfiles, links } = useStore();
  const [currentId, setCurrentId] = useState(profiles[0]?.id);
  const current = profiles.find((p) => p.id === currentId) ?? profiles[0];
  const update = (p: AppearanceProfile) => setProfiles(profiles.map((x) => (x.id === p.id ? p : x)));
  const inUse = (id: string) => links.some((l) => l.profileId === id);

  return (
    <div className="stack">
      <section>
        <h4>Appearance profiles</h4>
        <div className="row wrap">
          {profiles.map((p) => (
            <button key={p.id} className={p.id === current?.id ? "active" : ""} onClick={() => setCurrentId(p.id)}>
              <span className="swatch" style={{ background: p.active.color ?? "#999" }} /> {p.name}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            onClick={() => {
              if (!current) return;
              const id = crypto.randomUUID();
              setProfiles([...profiles, cloneProfile(current, id, `${current.name} copy`)]);
              setCurrentId(id);
            }}
          >
            Duplicate
          </button>
          <button
            disabled={!current || profiles.length <= 1 || inUse(current.id)}
            title={current && inUse(current.id) ? "Profile is used by links" : ""}
            onClick={() => {
              const rest = profiles.filter((p) => p.id !== current!.id);
              setProfiles(rest);
              setCurrentId(rest[0]?.id);
            }}
          >
            Delete
          </button>
        </div>
      </section>
      {current && (
        <section>
          <label>
            Name
            <input value={current.name} onChange={(e) => update({ ...current, name: e.target.value })} />
          </label>
          <PhaseEditor label="Before task" value={current.before} onChange={(v) => update({ ...current, before: v })} />
          <PhaseEditor label="During task" value={current.active} onChange={(v) => update({ ...current, active: v })} />
          <PhaseEditor label="After task" value={current.after} onChange={(v) => update({ ...current, after: v })} />
          <label className="check">
            <input type="checkbox" checked={current.progressiveFade} onChange={(e) => update({ ...current, progressiveFade: e.target.checked })} />
            Fade in with task progress
          </label>
          <label>
            Growth during task
            <select value={current.growth ?? "none"} onChange={(e) => update({ ...current, growth: e.target.value as GrowthDirection })}>
              <option value="none">None (whole element)</option>
              <option value="bottom-up">Bottom up</option>
              <option value="top-down">Top down</option>
              <option value="west-east">West → east</option>
              <option value="east-west">East → west</option>
              <option value="south-north">South → north</option>
              <option value="north-south">North → south</option>
            </select>
          </label>
        </section>
      )}
    </div>
  );
}

function DisplayTab() {
  const { sim, setSim, profiles } = useStore();
  return (
    <div className="stack">
      <section>
        <h4>Dates to simulate</h4>
        <label className="check">
          <input type="radio" checked={sim.dateSource === "current"} onChange={() => setSim({ dateSource: "current" })} />
          Current schedule (actuals + forecast)
        </label>
        <label className="check">
          <input type="radio" checked={sim.dateSource === "baseline"} onChange={() => setSim({ dateSource: "baseline" })} />
          Baseline (P6 target dates)
        </label>
      </section>
      <section>
        <h4>Colour by</h4>
        <label className="check">
          <input type="radio" checked={sim.colorMode === "profile"} onChange={() => setSim({ colorMode: "profile" })} />
          Appearance profile
        </label>
        <label className="check">
          <input type="radio" checked={sim.colorMode === "status"} onChange={() => setSim({ colorMode: "status" })} />
          Activity status vs baseline
        </label>
      </section>
      <section>
        <h4>Unlinked elements</h4>
        {(["show", "ghost", "hide"] as const).map((u) => (
          <label className="check" key={u}>
            <input type="radio" checked={sim.unlinked === u} onChange={() => setSim({ unlinked: u })} />
            {u[0].toUpperCase() + u.slice(1)}
          </label>
        ))}
      </section>
      <section>
        <h4>Overlays</h4>
        <label className="check">
          <input type="checkbox" checked={sim.showPaths !== false} onChange={(e) => setSim({ showPaths: e.target.checked })} />
          Show equipment paths
        </label>
      </section>
      <section>
        <h4>Legend</h4>
        {sim.colorMode === "profile" ? (
          <ul className="legend">
            {profiles.map((p) => (
              <li key={p.id}>
                <span className="swatch" style={{ background: p.active.color ?? "#999" }} /> {p.name} (during task)
              </li>
            ))}
          </ul>
        ) : (
          <ul className="legend">
            {Object.entries(STATUS_COLORS).map(([k, c]) => (
              <li key={k}>
                <span className="swatch" style={{ background: c }} /> {k.replace("-", " ")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CheckTab() {
  const { schedule, elements, links, setLinks, selectElements, selectActivity, setSideTab, setStatus, lastUpdate, scheduleReport, setLeftTab } = useStore();
  const health = useMemo(() => (schedule ? linkHealth(schedule, elements, links) : null), [schedule, elements, links]);
  if (!schedule) return <p className="muted">Load a schedule to check links.</p>;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const shift = (d: number | null) => (d === null ? "" : d === 0 ? "0d" : `${d > 0 ? "+" : ""}${d}d`);

  const codeToId = new Map((schedule?.activities ?? []).map((a) => [a.code, a.id]));
  return (
    <div className="stack">
      {scheduleReport && (
        <section>
          <h4>Last scheduling run</h4>
          {scheduleReport.error ? (
            <p className="bad">{scheduleReport.error}</p>
          ) : (
            <p>
              Project finish <b>{fmtDate(scheduleReport.projectFinish)}</b>
              {scheduleReport.previousFinish !== null && scheduleReport.previousFinish !== scheduleReport.projectFinish && (
                <span className={scheduleReport.projectFinish > scheduleReport.previousFinish ? "bad" : "good"}>
                  {" "}
                  (was {fmtDate(scheduleReport.previousFinish)})
                </span>
              )}
              <br />
              {scheduleReport.criticalCount} critical activities · {scheduleReport.warnings.length} warning(s)
            </p>
          )}
          {scheduleReport.warnings.length > 0 && (
            <ul className="list">
              {scheduleReport.warnings.slice(0, 60).map((w) => {
                const code = w.split(":")[0];
                const id = codeToId.get(code);
                return (
                  <li key={w}>
                    {id ? (
                      <button className="link" onClick={() => { selectActivity(id); setLeftTab("activity"); }}>
                        {code}
                      </button>
                    ) : (
                      code
                    )}
                    {w.slice(code.length)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {lastUpdate && (
        <section>
          <h4>Last schedule update</h4>
          <p>
            Data date {fmtDate(lastUpdate.dataDateFrom)} → <b>{fmtDate(lastUpdate.dataDateTo)}</b>
            <br />
            Project finish{" "}
            <b className={(lastUpdate.finishShiftDays ?? 0) > 0 ? "bad" : (lastUpdate.finishShiftDays ?? 0) < 0 ? "good" : ""}>
              {lastUpdate.finishShiftDays ? shift(lastUpdate.finishShiftDays) : "unchanged"}
            </b>
            <br />
            {lastUpdate.changed.length} changed · {lastUpdate.added.length} added · {lastUpdate.removed.length} removed
            <br />
            Links kept: {lastUpdate.keptLinks}
            {lastUpdate.droppedLinks > 0 && <span className="bad"> · dropped: {lastUpdate.droppedLinks} (activities removed)</span>}
          </p>
          {lastUpdate.changed.length > 0 && (
            <table className="props">
              <tbody>
                <tr>
                  <td><b>Activity</b></td>
                  <td><b>Finish / status</b></td>
                </tr>
                {lastUpdate.changed.slice(0, 30).map((c) => (
                  <tr key={c.code}>
                    <td title={c.name}>{c.code}</td>
                    <td>
                      <span className={(c.finishShiftDays ?? 0) > 0 ? "bad" : (c.finishShiftDays ?? 0) < 0 ? "good" : ""}>{shift(c.finishShiftDays)}</span>{" "}
                      {c.statusFrom !== c.statusTo ? `${c.statusFrom} → ${c.statusTo}` : ""} {c.pctFrom !== c.pctTo ? `${c.pctFrom}→${c.pctTo}%` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lastUpdate.added.length > 0 && (
            <p>
              <b>New activities (need links):</b> {lastUpdate.added.map((a) => a.code).join(", ")}
            </p>
          )}
        </section>
      )}
      {health && (
        <>
          <section>
            <h4>Coverage</h4>
            <p>
              Work activities linked: <b>{pct(health.coverage.activities)}</b>
              <br />
              Model elements linked: <b>{elements.length ? pct(health.coverage.elements) : "no model"}</b>
            </p>
          </section>
          <section>
            <h4>Activities with nothing to show ({health.unlinkedActivities.length})</h4>
            {health.unlinkedActivities.length === 0 ? (
              <p className="good">Every work activity has linked elements.</p>
            ) : (
              <ul className="list">
                {health.unlinkedActivities.slice(0, 50).map((a) => (
                  <li key={a.id}>
                    <button className="link" onClick={() => { selectActivity(a.id); setSideTab("selection"); }}>{a.code}</button> {a.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>Elements never shown in the sequence ({health.unlinkedElements.length})</h4>
            {health.unlinkedElements.length > 0 && (
              <button onClick={() => { selectElements(new Set(health.unlinkedElements.map((e) => e.id))); setStatus(`Selected ${health.unlinkedElements.length} unlinked element(s).`); }}>
                Select them in 3D
              </button>
            )}
          </section>
          {health.duplicateInstalls.length > 0 && (
            <section>
              <h4>Installed by more than one activity ({health.duplicateInstalls.length})</h4>
              <p className="muted">Often a double count. Check whether one should be a different profile.</p>
              <ul className="list">
                {health.duplicateInstalls.slice(0, 30).map((d) => (
                  <li key={d.element.id}>
                    {d.element.name}: {d.activities.map((a) => a.code).join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(health.orphanActivityLinks.length > 0 || health.orphanElementLinks.length > 0) && (
            <section>
              <h4>Broken links</h4>
              <p>
                {health.orphanActivityLinks.length} to missing activities · {health.orphanElementLinks.length} to elements not in the loaded model
              </p>
              <button
                onClick={() => {
                  const bad = new Set([...health.orphanActivityLinks, ...health.orphanElementLinks]);
                  setLinks(links.filter((l) => !bad.has(l)));
                  setStatus(`Removed ${bad.size} broken link(s).`);
                }}
              >
                Remove broken links
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ToolsTab() {
  const st = useStore();
  const { selectedElements, selectedActivity, schedule, groups, segments, paths, pathDraft, baseElements, elements } = st;
  const sel = [...selectedElements];
  const [groupName, setGroupName] = useState("");
  const [axis, setAxis] = useState<"x" | "y" | "z">("x");
  const [parts, setParts] = useState(3);
  const [label, setLabel] = useState("Pour");
  const [pathName, setPathName] = useState("");
  const [orient, setOrient] = useState(false);
  const act = schedule?.activities.find((a) => a.id === selectedActivity);
  const baseIds = new Set(baseElements.map((e) => e.id));
  // Split works on whole elements; a selected segment means its parent.
  const parentsOf = (ids: string[]) => [...new Set(ids.map((id) => (baseIds.has(id) ? id : elements.find((e) => e.id === id)?.properties.ParentGlobalId ?? id)))];

  return (
    <div className="stack">
      <section>
        <h4>Groups ({groups.length})</h4>
        <p className="muted">Save a selection as a named group (a crane, a pour, a zone). Groups show up as a "Group" property for rules and selection.</p>
        <div className="row">
          <input placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <button
            disabled={!sel.length || !groupName.trim()}
            onClick={() => {
              st.setGroups([...groups, { id: crypto.randomUUID(), name: groupName.trim(), color: "#7c3aed", elementIds: sel }]);
              st.setStatus(`Group "${groupName.trim()}" saved with ${sel.length} element(s).`);
              setGroupName("");
            }}
          >
            Save selection
          </button>
        </div>
        <ul className="list">
          {groups.map((g) => (
            <li key={g.id}>
              <b>{g.name}</b> ({g.elementIds.length}){" "}
              <button className="link" onClick={() => st.selectElements(new Set(g.elementIds))}>select</button>
              <button className="link" disabled={!sel.length} onClick={() => st.setGroups(groups.map((x) => (x.id === g.id ? { ...x, elementIds: [...new Set([...x.elementIds, ...sel])] } : x)))}>
                add selection
              </button>
              <button className="link" onClick={() => st.setGroups(groups.filter((x) => x.id !== g.id))}>delete</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Split into pours / bays</h4>
        <p className="muted">Cut the selected element(s) into equal parts along an axis. Each part can then be linked to its own activity.</p>
        <div className="row">
          <select value={axis} onChange={(e) => setAxis(e.target.value as "x" | "y" | "z")}>
            <option value="x">Along X (west–east)</option>
            <option value="z">Along Z (south–north)</option>
            <option value="y">Along Y (height)</option>
          </select>
          <input type="number" min={2} max={50} value={parts} onChange={(e) => setParts(Number(e.target.value) || 2)} style={{ width: 56 }} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 70 }} title="Part name" />
        </div>
        <div className="row">
          <button
            disabled={!sel.length}
            onClick={() => {
              const targets = parentsOf(sel);
              const rest = segments.filter((s) => !targets.includes(s.parentId));
              const added = targets.flatMap((id) => splitElement(id, axis, parts, label));
              // Links on the element (or its earlier parts) move to every new part.
              const parentOfId = (id: string) => (targets.includes(id) ? id : segments.find((x) => x.id === id && targets.includes(x.parentId))?.parentId);
              const seen = new Set<string>();
              const linksNext = st.links.flatMap((l) => {
                const parent = parentOfId(l.elementId);
                if (!parent) return [l];
                return added
                  .filter((x) => x.parentId === parent)
                  .map((x) => ({ ...l, elementId: x.id }))
                  .filter((x) => {
                    const k = `${x.elementId}|${x.activityId}`;
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                  });
              });
              st.setSegments([...rest, ...added]);
              st.setLinks(linksNext);
              st.selectElements(new Set(added.map((s) => s.id)));
              st.setStatus(`Split ${targets.length} element(s) into ${parts} parts each. Link each part to its activity.`);
            }}
          >
            Split selection
          </button>
          <button
            disabled={!sel.length || !segments.some((s) => parentsOf(sel).includes(s.parentId))}
            onClick={() => {
              const targets = parentsOf(sel);
              const segIds = new Set(segments.filter((s) => targets.includes(s.parentId)).map((s) => s.id));
              // Parts' links go back to the whole element (deduplicated).
              const seen = new Set<string>();
              const parentOf = new Map(segments.map((x) => [x.id, x.parentId]));
              const linksNext = st.links
                .map((l) => (segIds.has(l.elementId) ? { ...l, elementId: parentOf.get(l.elementId)! } : l))
                .filter((l) => {
                  const k = `${l.elementId}|${l.activityId}`;
                  if (seen.has(k)) return false;
                  seen.add(k);
                  return true;
                });
              st.setSegments(segments.filter((s) => !targets.includes(s.parentId)));
              st.setLinks(linksNext);
              st.selectElements(new Set(targets));
            }}
          >
            Unsplit
          </button>
        </div>
        <p className="muted">{segments.length} part(s) in the model.</p>
      </section>

      <section>
        <h4>Equipment paths ({paths.length})</h4>
        <p className="muted">Move the selected elements (a crane, a delivery truck) along a path while an activity runs.</p>
        {!pathDraft ? (
          <>
            <p>
              {sel.length} element(s) · activity: {act ? <b>{act.code}</b> : <span className="muted">pick one in the Gantt</span>}
            </p>
            <div className="row">
              <input placeholder="Path name" value={pathName} onChange={(e) => setPathName(e.target.value)} />
            </div>
            <label className="check">
              <input type="checkbox" checked={orient} onChange={(e) => setOrient(e.target.checked)} /> Turn to face direction of travel
            </label>
            <button className="primary" disabled={!sel.length || !act} onClick={() => st.setPathDraft([])}>
              Draw path in 3D
            </button>
          </>
        ) : (
          <>
            <p>
              Click points in the 3D view: <b>{pathDraft.length}</b> placed.
            </p>
            <div className="row">
              <button
                className="primary"
                disabled={pathDraft.length < 2}
                onClick={() => {
                  st.setPaths([
                    ...paths,
                    { id: crypto.randomUUID(), name: pathName.trim() || `Path ${paths.length + 1}`, activityId: act!.id, elementIds: sel, points: pathDraft, orient },
                  ]);
                  st.setPathDraft(null);
                  setPathName("");
                  st.setStatus("Path saved. Play the timeline to see it move.");
                }}
              >
                Finish
              </button>
              <button disabled={!pathDraft.length} onClick={() => st.setPathDraft(pathDraft.slice(0, -1))}>
                Undo point
              </button>
              <button onClick={() => st.setPathDraft(null)}>Cancel</button>
            </div>
          </>
        )}
        <ul className="list">
          {paths.map((p) => {
            const a = schedule?.activities.find((x) => x.id === p.activityId);
            return (
              <li key={p.id}>
                <b>{p.name}</b> · {a?.code ?? "?"} · {p.elementIds.length} element(s), {p.points.length} points{" "}
                <button className="link" onClick={() => st.selectElements(new Set(p.elementIds))}>select</button>
                <button className="link" onClick={() => st.setPaths(paths.filter((x) => x.id !== p.id))}>delete</button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
