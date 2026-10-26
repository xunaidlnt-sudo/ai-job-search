// P6 Professional-style vertical toolbars: the Directory bar on the left
// (where to look) and the Command bar on the right (what to do), icon over
// label, top to bottom.

import {
  Calculator,
  ChartLine,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  DatabaseZap,
  FileChartColumn,
  FileOutput,
  FolderKanban,
  ListTree,
  MoveHorizontal,
  Network,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { addActivityAfterSelected, deleteSelectedActivity } from "./ActivityEditor";
import { ganttCommand } from "./Gantt";
import { useStore } from "./store";

/** P6's lower pane: activity details, or a usage profile. */
export type BottomView = "details" | "resource-usage" | "activity-usage";
export type DetailTab = "general" | "status" | "resources" | "predecessors" | "successors" | "codes";

interface RailItem {
  id: string;
  label: string;
  title: string;
  Icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function Rail({ side, items, label }: { side: "left" | "right"; items: (RailItem | "sep")[]; label: string }) {
  return (
    <nav className={`p6-rail p6-rail-${side}`} aria-label={label}>
      {items.map((it, i) =>
        it === "sep" ? (
          <span key={`sep${i}`} className="rail-sep" />
        ) : (
          <button key={it.id} className={it.active ? "on" : ""} title={it.title} onClick={it.onClick} disabled={it.disabled} aria-pressed={it.active}>
            <it.Icon size={20} strokeWidth={1.6} aria-hidden />
            <span>{it.label}</span>
          </button>
        ),
      )}
    </nav>
  );
}

/** Left: P6's Directory toolbar. */
export function DirectoryBar({
  bottom,
  setBottom,
  setDetailTab,
  onProjects,
  onReports,
  onTracking,
  onP6,
}: {
  bottom: BottomView;
  setBottom: (b: BottomView) => void;
  setDetailTab: (t: DetailTab) => void;
  onProjects: () => void;
  onReports: () => void;
  onTracking: () => void;
  onP6: () => void;
}) {
  const schedule = useStore((s) => s.schedule);
  const collapsed = useStore((s) => s.collapsedWbs);
  const setCollapsed = useStore((s) => s.setCollapsedWbs);
  const wbsView = !!schedule && schedule.wbs.length > 0 && collapsed.size >= schedule.wbs.length;
  return (
    <Rail
      side="left"
      label="Directory"
      items={[
        { id: "projects", label: "Projects", title: "Open projects from the database", Icon: FolderKanban, onClick: onProjects },
        {
          id: "wbs",
          label: "WBS",
          title: "Work breakdown structure: collapse to WBS bands",
          Icon: Network,
          active: wbsView,
          disabled: !schedule,
          onClick: () => schedule && setCollapsed(new Set(schedule.wbs.map((w) => w.id))),
        },
        {
          id: "activities",
          label: "Activities",
          title: "Activities: show every activity with its details",
          Icon: ListTree,
          active: !wbsView && bottom === "details",
          disabled: !schedule,
          onClick: () => {
            setCollapsed(new Set());
            setBottom("details");
          },
        },
        {
          id: "assignments",
          label: "Assignments",
          title: "Resource assignments of the selected activity",
          Icon: ClipboardList,
          disabled: !schedule,
          onClick: () => {
            setBottom("details");
            setDetailTab("resources");
          },
        },
        { id: "resources", label: "Resources", title: "Resource Usage Profile", Icon: Users, active: bottom === "resource-usage", disabled: !schedule, onClick: () => setBottom("resource-usage") },
        { id: "usage", label: "Activity Usage", title: "Activity Usage Profile: cost and earned value", Icon: ChartLine, active: bottom === "activity-usage", disabled: !schedule, onClick: () => setBottom("activity-usage") },
        "sep",
        { id: "reports", label: "Reports", title: "Reports and dashboards", Icon: FileChartColumn, onClick: onReports },
        { id: "tracking", label: "Tracking", title: "Tracking: project status dashboard", Icon: Calculator, onClick: onTracking },
        { id: "p6", label: "P6 Import", title: "Import a project from a P6 connection", Icon: DatabaseZap, onClick: onP6 },
      ]}
    />
  );
}

/** Right: P6's Command toolbar. */
export function CommandBar({ onSchedule, onSave, onExportXer, onFind }: { onSchedule: () => void; onSave: () => void; onExportXer: () => void; onFind: () => void }) {
  const schedule = useStore((s) => s.schedule);
  const selected = useStore((s) => s.selectedActivity);
  const setCollapsed = useStore((s) => s.setCollapsedWbs);
  const none = !schedule;
  return (
    <Rail
      side="right"
      label="Commands"
      items={[
        { id: "add", label: "Add", title: "Add an activity after the selected one (Ins)", Icon: Plus, onClick: addActivityAfterSelected, disabled: none },
        { id: "del", label: "Delete", title: "Delete the selected activity (Del)", Icon: Trash2, onClick: deleteSelectedActivity, disabled: !selected },
        "sep",
        { id: "f9", label: "Schedule", title: "Schedule (F9)", Icon: Calculator, onClick: onSchedule, disabled: none },
        { id: "save", label: "Commit", title: "Commit changes to the database (Ctrl+S)", Icon: Save, onClick: onSave, disabled: none },
        "sep",
        { id: "expand", label: "Expand All", title: "Expand all WBS bands", Icon: ChevronsUpDown, onClick: () => setCollapsed(new Set()), disabled: none },
        {
          id: "collapse",
          label: "Collapse All",
          title: "Collapse all WBS bands",
          Icon: ChevronsDownUp,
          onClick: () => schedule && setCollapsed(new Set(schedule.wbs.map((w) => w.id))),
          disabled: none,
        },
        { id: "zin", label: "Zoom In", title: "Zoom the timescale in", Icon: ZoomIn, onClick: () => ganttCommand("zoom-in"), disabled: none },
        { id: "zout", label: "Zoom Out", title: "Zoom the timescale out", Icon: ZoomOut, onClick: () => ganttCommand("zoom-out"), disabled: none },
        { id: "fit", label: "Fit", title: "Fit the whole project in the timescale", Icon: MoveHorizontal, onClick: () => ganttCommand("fit"), disabled: none },
        { id: "find", label: "Find", title: "Find activities (Ctrl+F)", Icon: Search, onClick: onFind, disabled: none },
        "sep",
        { id: "xer", label: "Export", title: "Export to P6 XER", Icon: FileOutput, onClick: onExportXer, disabled: none },
      ]}
    />
  );
}
