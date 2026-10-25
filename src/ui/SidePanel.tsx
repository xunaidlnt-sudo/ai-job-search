import { useMemo, useState } from "react";
import { activityFields, applyRules, elementPropertyValue, mergeLinks, propertyKeys, unlink } from "../core/linking";
import { cloneProfile, STATUS_COLORS } from "../core/profiles";
import type { AppearanceProfile, LinkMatch, LinkRule, PhaseAppearance } from "../core/types";
import { useStore } from "./store";

type Tab = "selection" | "rules" | "profiles" | "display";

export function SidePanel() {
  const [tab, setTab] = useState<Tab>("selection");
  return (
    <div className="side">
      <div className="tabs">
        {(["selection", "rules", "profiles", "display"] as Tab[]).map((t) => (
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

  return (
    <div className="stack">
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
