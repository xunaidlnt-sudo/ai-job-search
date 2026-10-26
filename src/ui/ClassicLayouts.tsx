// The P6 and MS Project layouts: no 3D view, laid out like the originals.
//  - P6: title bar, menu bar, toolbar, Directory bar (left), the Activities
//    window (layout/filter bar, activity table + Gantt, Activity Details
//    tabs or a usage profile underneath), Command bar (right), status bar.
//  - MS Project: title bar with quick-access buttons, ribbon tabs and groups,
//    Timeline, Gantt Chart view with its vertical view label, optional Task
//    Form (Details), status bar with view shortcuts and zoom.

import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Diamond,
  Download,
  FileInput,
  FileOutput,
  FolderOpen,
  Info,
  LayoutDashboard,
  ListPlus,
  Maximize2,
  Minus,
  Plus,
  Save,
  ScrollText,
  Search,
  Settings,
  TableProperties,
  Upload,
  Users,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useConfig } from "../backend/config";
import { monthShort } from "../core/dates";
import { scheduleRange } from "../core/simulation";
import { ActivityEditor, addActivityAfterSelected, deleteSelectedActivity, type EditorSection } from "./ActivityEditor";
import { CostPanel, ResourcePanel } from "./Analysis";
import { Gantt, ganttCommand } from "./Gantt";
import { ModeSwitch, ThemeButton } from "./ModeSwitch";
import { useTraining } from "./training/engine";
import { TrainingButton } from "./training/Training";
import { CommandBar, DirectoryBar, type BottomView, type DetailTab } from "./P6Rails";
import { fmtDate, useStore, type GanttFilterKind } from "./store";

export interface ClassicActions {
  projects: () => void;
  save: () => void;
  saveAsNew: () => void;
  importSchedule: () => void;
  importP6: () => void;
  pushP6: (() => void) | null;
  schedule: () => void;
  exportXer: () => void;
  exportCsv: () => void;
  openFile: () => void;
  saveFile: () => void;
  sample: (kind: "gis" | "rc") => void;
  dashboards: () => void;
  settings: (tab?: "interface" | "data" | "p6" | "email" | "users") => void;
  help: () => void;
  dbLabel: string;
}

const FILTERS: [GanttFilterKind, string][] = [
  ["all", "All Activities"],
  ["critical", "Critical"],
  ["not-started", "Not Started"],
  ["in-progress", "In Progress"],
  ["complete", "Completed"],
  ["late", "Late against Baseline"],
  ["milestones", "Milestones"],
];

// ---------------------------------------------------------------- menu bar

type MenuItem = { label: string; onClick?: () => void; disabled?: boolean; checked?: boolean; shortcut?: string } | "sep";

function MenuBar({ menus, className }: { menus: [string, MenuItem[]][]; className: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={className} ref={ref} role="menubar">
      {menus.map(([name, items], i) => (
        <div key={name} className="mb-item">
          <button className={open === i ? "open" : ""} role="menuitem" onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open !== null && setOpen(i)}>
            {name}
          </button>
          {open === i && (
            <div className="mb-drop" role="menu">
              {items.map((it, k) =>
                it === "sep" ? (
                  <hr key={k} />
                ) : (
                  <button
                    key={k}
                    role="menuitem"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.onClick?.();
                    }}
                  >
                    <span className="mb-check">{it.checked ? "✓" : ""}</span>
                    <span className="mb-label">{it.label}</span>
                    <span className="mb-key">{it.shortcut ?? ""}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const IconBtn = ({ Icon, title, onClick, disabled }: { Icon: LucideIcon; title: string; onClick: () => void; disabled?: boolean }) => (
  <button className="icon-btn" title={title} aria-label={title} onClick={onClick} disabled={disabled}>
    <Icon size={16} strokeWidth={1.7} aria-hidden />
  </button>
);

/** Ins adds an activity after the selected one, Del deletes it, Ctrl+F finds. */
function useClassicKeys(find: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        find();
      } else if (!typing && e.key === "Insert") {
        e.preventDefault();
        addActivityAfterSelected();
      } else if (!typing && e.key === "Delete" && useStore.getState().selectedActivity) {
        e.preventDefault();
        deleteSelectedActivity();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [find]);
}

const DETAIL_TABS: [DetailTab, string, EditorSection[]][] = [
  ["general", "General", ["general"]],
  ["status", "Status", ["status", "dates"]],
  ["resources", "Resources", ["resources"]],
  ["predecessors", "Predecessors", ["predecessors"]],
  ["successors", "Successors", ["successors"]],
  ["codes", "Codes", ["codes"]],
];

/**
 * Data date (MS Project: status date) as a date box. Moving it forward is the
 * first step of an update; the time of day is kept. Reschedule (F9) after.
 */
function DataDateInput({ label }: { label: string }) {
  const schedule = useStore((s) => s.schedule);
  const ref = useRef<HTMLInputElement>(null);
  const DAY = 86_400_000;
  const dd = schedule?.dataDate ?? null;
  const value = dd !== null ? new Date(dd).toISOString().slice(0, 10) : "";
  return (
    <span className="dd-edit" title={`${label}: progress is recorded up to this date. Click to change it, then reschedule (F9).`}>
      {label}:
      <button
        type="button"
        disabled={!schedule}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        {fmtDate(dd) || "—"}
        <CalendarDays size={12} aria-hidden />
      </button>
      <input
        ref={ref}
        type="date"
        className="dd-native"
        aria-label={label}
        value={value}
        disabled={!schedule}
        onChange={(e) => {
          const st = useStore.getState();
          if (!st.schedule || !e.target.value) return;
          const day = Date.parse(`${e.target.value}T00:00:00Z`);
          const time = st.schedule.dataDate !== null ? ((st.schedule.dataDate % DAY) + DAY) % DAY : 0;
          st.setSchedule({ ...st.schedule, dataDate: day + time }, { keepTime: true, dirty: true });
          st.setStatus(`${label} set to ${fmtDate(day + time)}. Press F9 to reschedule.`);
        }}
      />
    </span>
  );
}

function EmptySample({ a }: { a: ClassicActions }) {
  return (
    <div className="empty-sample">
      <p>No project open. Open one from the database, import an XER / XML file, or try a sample project:</p>
      <button className="primary" onClick={() => a.sample("gis")}>
        220 kV GIS substation (UAE)
      </button>
      <button className="link" onClick={() => a.sample("rc")}>
        or a small RC building
      </button>
      <p className="empty-train">
        New to planning or to Stratum?{" "}
        <button className="link" onClick={() => useTraining.getState().openCatalog(true)}>
          Start training mode
        </button>{" "}
        for guided, hands-on lessons.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- P6

export function P6Screen({ a, banners, status }: { a: ClassicActions; banners: ReactNode; status: ReactNode }) {
  const schedule = useStore((s) => s.schedule);
  const selected = useStore((s) => s.selectedActivity);
  const filter = useStore((s) => s.ganttFilter);
  const setFilter = useStore((s) => s.setGanttFilter);
  const tracking = useStore((s) => s.ganttTracking);
  const setTracking = useStore((s) => s.setGanttTracking);
  const setCollapsed = useStore((s) => s.setCollapsedWbs);
  const user = useConfig((s) => s.config.user);
  const [bottom, setBottom] = useState<BottomView>("details");
  const [tab, setTab] = useState<DetailTab>("general");
  const findRef = useRef<HTMLInputElement>(null);
  const act = schedule?.activities.find((x) => x.id === selected) ?? null;
  const none = !schedule;
  const find = useMemo(() => () => findRef.current?.focus(), []);
  useClassicKeys(find);

  const menus: [string, MenuItem[]][] = [
    [
      "File",
      [
        { label: "Open…", onClick: a.projects, shortcut: "Ctrl+O" },
        { label: "Commit Changes", onClick: a.save, disabled: none, shortcut: "Ctrl+S" },
        { label: "Save as New Project", onClick: a.saveAsNew, disabled: none },
        "sep",
        { label: "Import…", onClick: a.importSchedule },
        { label: "Import from P6 Connection…", onClick: a.importP6 },
        { label: "Export… (XER)", onClick: a.exportXer, disabled: none },
        { label: "Export to Excel (CSV)", onClick: a.exportCsv, disabled: none },
        "sep",
        { label: "Open Project File…", onClick: a.openFile },
        { label: "Save Project File", onClick: a.saveFile, disabled: none },
        "sep",
        { label: "Sample: 220 kV GIS Substation (UAE)", onClick: () => a.sample("gis") },
        { label: "Sample: RC Building", onClick: () => a.sample("rc") },
      ],
    ],
    [
      "Edit",
      [
        { label: "Add Activity", onClick: addActivityAfterSelected, disabled: none, shortcut: "Ins" },
        { label: "Delete Activity", onClick: deleteSelectedActivity, disabled: !selected, shortcut: "Del" },
        "sep",
        { label: "Find…", onClick: find, disabled: none, shortcut: "Ctrl+F" },
      ],
    ],
    [
      "View",
      [
        { label: "Show on Bottom: Activity Details", onClick: () => setBottom("details"), checked: bottom === "details" },
        { label: "Show on Bottom: Resource Usage Profile", onClick: () => setBottom("resource-usage"), checked: bottom === "resource-usage" },
        { label: "Show on Bottom: Activity Usage Profile", onClick: () => setBottom("activity-usage"), checked: bottom === "activity-usage" },
        "sep",
        { label: "Show Baseline Bars", onClick: () => setTracking(!tracking), checked: tracking },
        { label: "Expand All", onClick: () => setCollapsed(new Set()), disabled: none },
        { label: "Collapse All", onClick: () => schedule && setCollapsed(new Set(schedule.wbs.map((w) => w.id))), disabled: none },
        "sep",
        { label: "Zoom In", onClick: () => ganttCommand("zoom-in"), disabled: none },
        { label: "Zoom Out", onClick: () => ganttCommand("zoom-out"), disabled: none },
        { label: "Fit Timescale", onClick: () => ganttCommand("fit"), disabled: none },
      ],
    ],
    [
      "Project",
      [
        { label: "Schedule…", onClick: a.schedule, disabled: none, shortcut: "F9" },
        ...(a.pushP6 ? [{ label: "Send Progress to P6", onClick: a.pushP6 }] : []),
        "sep",
        { label: "Reports and Dashboards", onClick: a.dashboards },
      ],
    ],
    [
      "Enterprise",
      [
        { label: "Projects…", onClick: a.projects },
        { label: "P6 Connections…", onClick: () => a.settings("p6") },
      ],
    ],
    [
      "Tools",
      [
        { label: "Reports", onClick: a.dashboards },
        { label: "Scheduled Emails", onClick: a.dashboards },
      ],
    ],
    [
      "Admin",
      [
        { label: "Users…", onClick: () => a.settings("users") },
        { label: "Database…", onClick: () => a.settings("data") },
        { label: "Email (SMTP)…", onClick: () => a.settings("email") },
        "sep",
        { label: "Preferences…", onClick: () => a.settings("interface") },
      ],
    ],
    [
      "Help",
      [
        { label: "Training Mode…", onClick: () => useTraining.getState().openCatalog(true) },
        { label: "Getting Started", onClick: a.help, shortcut: "?" },
      ],
    ],
  ];

  return (
    <div className="classic p6-app">
      <div className="cl-titlebar">
        <img className="cl-logo logo-light" src="./stratum-logo.png" alt="Stratum 4D" />
        <img className="cl-logo logo-dark" src="./stratum-logo-dark.png" alt="" aria-hidden />
        <span className="cl-title">{schedule ? `Activities : ${schedule.projectCode} – ${schedule.projectName}` : "Activities"}</span>
        <span className="spacer" />
        <ModeSwitch />
        <TrainingButton className="tb cl-train" />
        <ThemeButton />
      </div>
      <MenuBar className="cl-menubar" menus={menus} />
      <div className="cl-toolbar">
        <IconBtn Icon={FolderOpen} title="Open project (Ctrl+O)" onClick={a.projects} />
        <IconBtn Icon={Save} title="Commit changes (Ctrl+S)" onClick={a.save} disabled={none} />
        <span className="tsep" />
        <IconBtn Icon={FileInput} title="Import XER / XML" onClick={a.importSchedule} />
        <IconBtn Icon={FileOutput} title="Export XER" onClick={a.exportXer} disabled={none} />
        {a.pushP6 && <IconBtn Icon={Upload} title="Send progress to P6" onClick={a.pushP6} />}
        <span className="tsep" />
        <IconBtn Icon={CalendarCheck} title="Schedule (F9)" onClick={a.schedule} disabled={none} />
        <IconBtn Icon={Search} title="Find (Ctrl+F)" onClick={find} disabled={none} />
        <span className="tsep" />
        <IconBtn Icon={LayoutDashboard} title="Reports and dashboards" onClick={a.dashboards} />
        <IconBtn Icon={Settings} title="Preferences" onClick={() => a.settings("interface")} />
        <IconBtn Icon={CircleHelp} title="Help" onClick={a.help} />
      </div>
      {banners}
      <div className="p6-body">
        <DirectoryBar
          bottom={bottom}
          setBottom={setBottom}
          setDetailTab={setTab}
          onProjects={a.projects}
          onReports={a.dashboards}
          onTracking={a.dashboards}
          onP6={a.importP6}
        />
        <div className="p6-window">
          <div className="p6-wintabs">
            <span className="p6-wintab active">Activities</span>
          </div>
          <div className="p6-layoutbar">
            <button className="p6-drop" onClick={() => setTracking(!tracking)} title="Switch between the Classic layout and the layout with baseline bars">
              Layout: {tracking ? "Classic Schedule Layout with Baseline" : "Classic Schedule Layout"} <ChevronDown size={12} aria-hidden />
            </button>
            <label className="p6-drop">
              Filter:
              <select value={filter.kind} onChange={(e) => setFilter({ kind: e.target.value as GanttFilterKind })}>
                {FILTERS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <span className="spacer" />
            <input ref={findRef} className="p6-find" placeholder="Find activity ID or name" value={filter.text} onChange={(e) => setFilter({ text: e.target.value })} />
          </div>
          <div className="p6-upper">{schedule ? <Gantt /> : <EmptySample a={a} />}</div>
          <div className="p6-lower">
            {bottom === "details" ? (
              <>
                <div className="p6-lowerhead">
                  <span>
                    Activity <b>{act?.code ?? "—"}</b>
                  </span>
                  <span className="p6-actname">{act?.name ?? "No activity selected"}</span>
                  <span className="spacer" />
                  <span>
                    Project <b>{schedule?.projectCode ?? "—"}</b>
                  </span>
                </div>
                <div className="p6-tabs" role="tablist">
                  {DETAIL_TABS.map(([id, label]) => (
                    <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="p6-lowerbody">
                  <ActivityEditor bare only={DETAIL_TABS.find((d) => d[0] === tab)![2]} />
                </div>
              </>
            ) : (
              <>
                <div className="p6-lowerhead">
                  <b>{bottom === "resource-usage" ? "Resource Usage Profile" : "Activity Usage Profile"}</b>
                </div>
                <div className="p6-lowerbody">{bottom === "resource-usage" ? <ResourcePanel /> : <CostPanel />}</div>
              </>
            )}
          </div>
        </div>
        <CommandBar onSchedule={a.schedule} onSave={a.save} onExportXer={a.exportXer} onFind={find} />
      </div>
      <div className="cl-statusbar p6-status">
        <span>Portfolio: All Projects</span>
        <span>Access Mode: Shared</span>
        <DataDateInput label="Data Date" />
        <span>Baseline: Project Baseline</span>
        <span>User: {user?.name ?? "Local user"}</span>
        <span>DB: {a.dbLabel}</span>
        <span className="spacer" />
        <span className="cl-msg">{status}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- MS Project

type RibbonTab = "file" | "task" | "resource" | "report" | "project" | "view";
type MspView = "gantt" | "tracking" | "resource-usage";

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group">
      <div className="rb-buttons">{children}</div>
      <div className="rb-label">{label}</div>
    </div>
  );
}
const Big = ({ Icon, label, onClick, disabled, active }: { Icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) => (
  <button className={`rb-big ${active ? "active" : ""}`} onClick={onClick} disabled={disabled}>
    <Icon size={24} strokeWidth={1.5} aria-hidden />
    <span>{label}</span>
  </button>
);
const Small = ({ label, onClick, disabled, active, Icon }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; Icon?: LucideIcon }) => (
  <button className={`rb-small ${active ? "active" : ""}`} onClick={onClick} disabled={disabled}>
    {Icon && <Icon size={14} strokeWidth={1.7} aria-hidden />}
    <span>{label}</span>
  </button>
);

/** MS Project's Timeline: the project span with month ticks, milestones and the status date. */
function MspTimeline() {
  const schedule = useStore((s) => s.schedule);
  const range = useMemo(() => (schedule ? scheduleRange(schedule) : null), [schedule]);
  if (!schedule || !range) return <div className="msp-tl empty-tl">Add tasks with dates to the timeline</div>;
  const span = range.finish - range.start || 1;
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - range.start) / span) * 100))}%`;
  const months: number[] = [];
  const s = new Date(range.start);
  for (let m = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1); m < range.finish; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) months.push(m);
  const step = Math.max(1, Math.ceil(months.length / 14));
  const miles = schedule.activities.filter((x) => (x.type === "milestone" || x.type === "finish-milestone") && x.start !== null);
  return (
    <div className="msp-tl">
      <div className="tl-ends">
        <span>
          Start
          <br />
          <b>{fmtDate(range.start)}</b>
        </span>
      </div>
      <div className="tl-track">
        <div className="tl-months">
          {months.map((m, i) =>
            i % step === 0 ? (
              <span key={m} style={{ left: pos(m) }}>
                {monthShort(new Date(m))} '{String(new Date(m).getUTCFullYear()).slice(2)}
              </span>
            ) : null,
          )}
        </div>
        <div className="tl-bar" />
        {schedule.dataDate !== null && (
          <div className="tl-today" style={{ left: pos(schedule.dataDate) }} title={`Status date ${fmtDate(schedule.dataDate)}`}>
            <span>Status date</span>
          </div>
        )}
        {miles.map((m, i) => (
          <div
            key={m.id}
            className={`tl-ms ${i % 2 ? "low" : ""} ${(m.start! - range.start) / span > 0.8 ? "end" : ""}`}
            style={{ left: pos(m.start!) }}
            title={m.name}
          >
            <i />
            <span>
              {m.name}
              <br />
              {fmtDate(m.start)}
            </span>
          </div>
        ))}
      </div>
      <div className="tl-ends right">
        <span>
          Finish
          <br />
          <b>{fmtDate(range.finish)}</b>
        </span>
      </div>
    </div>
  );
}

export function MspScreen({ a, banners, status }: { a: ClassicActions; banners: ReactNode; status: ReactNode }) {
  const schedule = useStore((s) => s.schedule);
  const selected = useStore((s) => s.selectedActivity);
  const updateActivity = useStore((s) => s.updateActivity);
  const setStatus = useStore((s) => s.setStatus);
  const setTracking = useStore((s) => s.setGanttTracking);
  const setFilter = useStore((s) => s.setGanttFilter);
  const filter = useStore((s) => s.ganttFilter);
  const [tab, setTab] = useState<RibbonTab>("task");
  const [fileOpen, setFileOpen] = useState(false);
  const [view, setView] = useState<MspView>("gantt");
  const [showTimeline, setShowTimeline] = useState(true);
  const [details, setDetails] = useState(false);
  const [zoom, setZoom] = useState(50);
  const findRef = useRef<HTMLInputElement>(null);
  const act = schedule?.activities.find((x) => x.id === selected) ?? null;
  const none = !schedule;
  const find = useMemo(() => () => findRef.current?.focus(), []);
  useClassicKeys(find);

  useEffect(() => setTracking(view === "tracking"), [view, setTracking]);
  useEffect(() => () => setTracking(false), [setTracking]);

  const setPct = (p: number) => {
    if (!act) return;
    const start = act.actualStart ?? (p > 0 ? act.start : null);
    updateActivity(act.id, {
      percentComplete: p,
      status: p >= 100 ? "complete" : p > 0 ? "in-progress" : "not-started",
      actualStart: p > 0 ? start : null,
      actualFinish: p >= 100 ? act.actualFinish ?? act.finish : null,
    });
    setStatus(`${act.code} set to ${p}% complete. Calculate the project (F9) to update dates.`);
  };
  const addMilestone = () => {
    addActivityAfterSelected();
    const st = useStore.getState();
    if (st.selectedActivity) st.updateActivity(st.selectedActivity, { type: "milestone", name: "New milestone", originalDurationHours: 0, remainingDurationHours: 0 });
  };

  const Body: Record<Exclude<RibbonTab, "file">, ReactNode> = {
    task: (
      <>
        <Group label="View">
          <Big Icon={BarChart3} label="Gantt Chart" onClick={() => setView("gantt")} active={view === "gantt"} />
        </Group>
        <Group label="Schedule">
          <div className="rb-grid">
            {[0, 25, 50, 75, 100].map((p) => (
              <button key={p} className="rb-pct" title={`Mark ${p}% complete`} disabled={!act} onClick={() => setPct(p)}>
                {p}%
              </button>
            ))}
          </div>
        </Group>
        <Group label="Insert">
          <Big Icon={ListPlus} label="Task" onClick={addActivityAfterSelected} disabled={none} />
          <Big Icon={Diamond} label="Milestone" onClick={addMilestone} disabled={none} />
        </Group>
        <Group label="Properties">
          <Big Icon={Info} label="Information" onClick={() => setDetails(true)} disabled={!act} />
          <Small label="Details" Icon={TableProperties} onClick={() => setDetails(!details)} active={details} />
          <Small label="Delete Task" Icon={Minus} onClick={deleteSelectedActivity} disabled={!act} />
        </Group>
        <Group label="Editing">
          <Small label="Scroll to Task" Icon={ScrollText} onClick={() => ganttCommand("scroll-to-selected")} disabled={!act} />
          <Small label="Find" Icon={Search} onClick={() => findRef.current?.focus()} disabled={none} />
        </Group>
      </>
    ),
    resource: (
      <>
        <Group label="View">
          <Big Icon={Users} label="Resource Usage" onClick={() => setView("resource-usage")} active={view === "resource-usage"} />
        </Group>
        <Group label="Assignments">
          <Big Icon={ListPlus} label="Assign Resources" onClick={() => setDetails(true)} disabled={!act} />
        </Group>
      </>
    ),
    report: (
      <>
        <Group label="View Reports">
          <Big Icon={LayoutDashboard} label="Dashboards" onClick={a.dashboards} />
        </Group>
        <Group label="Export">
          <Big Icon={Download} label="Visual Reports (CSV)" onClick={a.exportCsv} disabled={none} />
        </Group>
      </>
    ),
    project: (
      <>
        <Group label="Schedule">
          <Big Icon={CalendarCheck} label="Calculate Project" onClick={a.schedule} disabled={none} />
        </Group>
        <Group label="Status">
          <div className="rb-field">
            <DataDateInput label="Status Date" />
          </div>
        </Group>
        <Group label="Data">
          <Big Icon={FileInput} label="Import from P6" onClick={a.importP6} />
          {a.pushP6 && <Big Icon={Upload} label="Update P6" onClick={a.pushP6} />}
        </Group>
      </>
    ),
    view: (
      <>
        <Group label="Task Views">
          <Big Icon={BarChart3} label="Gantt Chart" onClick={() => setView("gantt")} active={view === "gantt"} />
          <Big Icon={BarChart3} label="Tracking Gantt" onClick={() => setView("tracking")} active={view === "tracking"} />
        </Group>
        <Group label="Resource Views">
          <Big Icon={Users} label="Resource Usage" onClick={() => setView("resource-usage")} active={view === "resource-usage"} />
        </Group>
        <Group label="Split View">
          <label className="rb-check">
            <input type="checkbox" checked={showTimeline} onChange={(e) => setShowTimeline(e.target.checked)} /> Timeline
          </label>
          <label className="rb-check">
            <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Details
          </label>
        </Group>
        <Group label="Zoom">
          <Small label="Zoom In" Icon={ZoomIn} onClick={() => ganttCommand("zoom-in")} disabled={none} />
          <Small label="Zoom Out" Icon={ZoomOut} onClick={() => ganttCommand("zoom-out")} disabled={none} />
          <Small label="Entire Project" Icon={Maximize2} onClick={() => ganttCommand("fit")} disabled={none} />
        </Group>
      </>
    ),
  };

  const fileItems: [string, () => void, boolean?][] = [
    ["Open", a.projects],
    ["Save", a.save, none],
    ["Save As New", a.saveAsNew, none],
    ["Import (XER / XML)", a.importSchedule],
    ["Import from P6", a.importP6],
    ["Export (XER)", a.exportXer, none],
    ["Export to Excel (CSV)", a.exportCsv, none],
    ["Open Project File", a.openFile],
    ["Save Project File", a.saveFile, none],
    ["Sample: 220 kV GIS Substation", () => a.sample("gis")],
    ["Sample: RC Building", () => a.sample("rc")],
    ["Options", () => a.settings("interface")],
  ];

  return (
    <div className="classic msp-app">
      <div className="cl-titlebar msp-titlebar">
        <span className="qat">
          <button title="Save (Ctrl+S)" onClick={a.save} disabled={none}>
            <Save size={14} aria-hidden />
          </button>
          <button title="Calculate project (F9)" onClick={a.schedule} disabled={none}>
            <CalendarCheck size={14} aria-hidden />
          </button>
        </span>
        <span className="cl-title center">{schedule ? `${schedule.projectCode} – Stratum 4D` : "Stratum 4D"}</span>
        <span className="msp-context">Gantt Chart Tools</span>
        <ModeSwitch />
        <TrainingButton className="tb cl-train" />
        <ThemeButton />
      </div>
      <div className="msp-tabrow" role="tablist">
        <button className="msp-filetab" onClick={() => setFileOpen(!fileOpen)}>
          File
        </button>
        {(["task", "resource", "report", "project", "view"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => (setTab(k), setFileOpen(false))}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
        <button onClick={a.help}>Help</button>
        <button className="msp-format">Format</button>
        <span className="spacer" />
        <div className="msp-tell">
          <Search size={13} aria-hidden />
          <input ref={findRef} placeholder="Tell me what you want to find" value={filter.text} onChange={(e) => setFilter({ text: e.target.value })} />
        </div>
      </div>
      {fileOpen && (
        <div className="msp-backstage" onMouseLeave={() => setFileOpen(false)}>
          {fileItems.map(([label, fn, dis]) => (
            <button
              key={label}
              disabled={dis}
              onClick={() => {
                setFileOpen(false);
                fn();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="msp-ribbon">{Body[tab === "file" ? "task" : tab]}</div>
      {banners}
      {showTimeline && view !== "resource-usage" && (
        <div className="msp-tlwrap">
          <div className="msp-vlabel">TIMELINE</div>
          <MspTimeline />
        </div>
      )}
      <div className="msp-mainview">
        <div className="msp-vlabel">{view === "resource-usage" ? "RESOURCE USAGE" : view === "tracking" ? "TRACKING GANTT" : "GANTT CHART"}</div>
        <div className="msp-viewbody">{!schedule ? <EmptySample a={a} /> : view === "resource-usage" ? <ResourcePanel /> : <Gantt />}</div>
      </div>
      {details && view !== "resource-usage" && (
        <div className="msp-taskform">
          <div className="msp-vlabel">TASK FORM</div>
          <div className="msp-formbody">
            <ActivityEditor bare only={["general", "status", "predecessors", "resources"]} />
          </div>
        </div>
      )}
      <div className="cl-statusbar msp-status">
        <span>Ready</span>
        <span>New Tasks : Auto Scheduled</span>
        <span className="cl-msg">{status}</span>
        <span className="spacer" />
        <button title="Gantt Chart" className={view === "gantt" ? "on" : ""} onClick={() => setView("gantt")}>
          <BarChart3 size={14} aria-hidden />
        </button>
        <button title="Resource Usage" className={view === "resource-usage" ? "on" : ""} onClick={() => setView("resource-usage")}>
          <Users size={14} aria-hidden />
        </button>
        <button title="Reports" onClick={a.dashboards}>
          <LayoutDashboard size={14} aria-hidden />
        </button>
        <button title="Zoom out" onClick={() => (setZoom((z) => Math.max(0, z - 10)), ganttCommand("zoom-out"))}>
          <Minus size={12} aria-hidden />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={zoom}
          aria-label="Zoom"
          onChange={(e) => {
            const v = Number(e.target.value);
            ganttCommand(v > zoom ? "zoom-in" : "zoom-out");
            setZoom(v);
          }}
        />
        <button title="Zoom in" onClick={() => (setZoom((z) => Math.min(100, z + 10)), ganttCommand("zoom-in"))}>
          <Plus size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}

